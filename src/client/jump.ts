// 跳转编排（client 装配层自研）：定位目标行——按方向分流（向下滚动 / 向上补历史），
// 等待渲染并滚动；失败回退。结果码与词条绑定（jump-failed 事件契约）。
//
// 关键语义：chat.nodes 是「已加载窗口」，官方聊天列表**不做视口虚拟化**
// （ChatNodeList 直接 map 整个 order），所以「DOM 里能找到该行」等价于「历史已覆盖
// 该行」；反之「已加载但滚出视口」是常态，由落位步骤解决，不得当成需要继续加载。
//
// 三条实测结论（细节见对应实现处）：
//  1) 扩窗走官方 `loadThrough`（200 条/页、单 promise 内推进到目标 seq），
//     而不是逐页 `loadOlder`（50 条/页 + 每页轮询）——见 loadPayload；
//  2) 预算按「有无进展」判定（idleTimeoutMs + 回退通道页数上限），窗口头被别人
//     推进也算进展，不用固定墙钟打断仍在推进的加载——见 loadPayload；
//  3) 定位步进一律瞬时；最终落位由 settle 端口按用户设置执行，动画 promise
//     resolve 即代表停稳，编排层立即校验并要求「连续两次对上」——见 settleOnRow。

/** 跳转循环所需的会话快照面 */
export interface JumpSnapshot {
  openState: string
  hasMore: boolean
  loadingOlder: boolean
  /** 提问行（方向判定与回退落位用） */
  rows: Iterable<{ key: string; anchorSeq: number; visibility?: string }>
}

/** 一次载荷结束的原因（仅编排层内部使用） */
type StopReason = 'target' | 'exhausted' | 'idle' | 'pages' | 'timeout' | 'inactive'

interface ProbeResult {
  /** 目标行已在 DOM（非虚拟列表下等价于「已加载」） */
  stop?: StopReason
  /** 窗口最小锚点序号（进展度量；窗口内无提问行时为 null） */
  min: number | null
  /** 窗口已无更早历史 */
  hasMore: boolean
  /** 正文正在加载（含官方自己的跳转加载） */
  loading: boolean
}

/** 外部端口：会话读写、DOM 行查找、滚动与时钟（由浏览器半装配） */
export interface JumpPorts {
  snap: () => JumpSnapshot | undefined
  /** 逐页扩窗（50 条/页）；loadThrough 缺席时的回退通道 */
  loadMore: () => Promise<void>
  /** 官方跳转加载器：单次调用内连续扩窗（200 条/页）直到窗口覆盖 seq；
   *  缺席时退回 loadMore 逐页循环 */
  loadThrough?: (seq: number) => Promise<void>
  active: () => boolean
  locate: (key: string) => HTMLElement | null
  /** 行是否已进入滚动视口（可选；缺省视为已可见） */
  inView?: (row: HTMLElement) => boolean
  /**
   * 用户可见的最终落位 + 确认高亮的触发点（端口收到一次落位请求即闪一次目标气泡）。
   *
   * mode='instant'：一次到位（同步）。
   * mode='smooth'：由端口执行**自己驱动**的平滑动画，并返回一个在动画结束（或被
   * 取消）时 resolve 的 promise——编排层据此等到真正停稳再校验。
   */
  settle: (row: HTMLElement, mode: 'smooth' | 'instant') => void | Promise<void>
  /** 会话滚动容器（步进滚动与落位都按 scrollTop 触发；装配层恒提供） */
  scrollport: () => HTMLElement
  now: () => number
  sleep: (ms: number) => Promise<void>
  /** 让出一帧（可选；长会话一次扩窗渲染数百行，轮询期间交给浏览器绘制） */
  pause?: () => Promise<void>
  /** 该次跳转是否已被取代（用户又点了别的节点）；返回 true 时立即中止 */
  cancelled?: () => boolean
  report?: (code: JumpFailureCode, fallback?: boolean) => void
  /**
   * 扩窗加载状态，驱动「加载中…」提示（不带计数回显：官方 loader 的页数不对外
   * 暴露、窗口头也可能读不到，显示一个不会变的数字只会误导）。
   * 长加载期间编排层会周期性重发 loading=true，消费端的自动收起计时因此持续续期。
   */
  onLoading?: (loading: boolean) => void
}

export type JumpFailureCode = 'VIEW_INACTIVE' | 'TARGET_HIDDEN' | 'NOT_FOUND' | 'TIMEOUT'

/**
 * 结果码 → 词条键。必须显式映射：结果码是 SCREAMING_SNAKE（'VIEW_INACTIVE'），
 * 词条键是点分（'jump.inactive'），直接用结果码查词条永远查不到——
 * 旧实现因此在 UI 层把**所有**失败都渲染成「加载历史超时」（用户报告里的
 * 「老是提示加载超时」有一部分就是这么来的）。
 */
export const JUMP_FAILURE_KEY: Record<JumpFailureCode, string> = {
  VIEW_INACTIVE: 'jump.inactive',
  TARGET_HIDDEN: 'jump.hidden',
  NOT_FOUND: 'jump.notfound',
  TIMEOUT: 'jump.timeout',
}

interface JumpResult {
  ok: boolean
  code?: JumpFailureCode
  fallback?: boolean
}

interface JumpOptions {
  /** 无进展（窗口最小 seq 未前移）多久判定超时 */
  idleTimeoutMs?: number
  /** 墙钟硬上限（兜底；正常路径由 idleTimeoutMs 触发） */
  totalTimeoutMs?: number
  /** loadMore 回退通道的最大页数 */
  maxPages?: number
  rowWaitMs?: number
  pollMs?: number
}

const BUDGET = {
  // 无进展 12s：单页（50 条 + 客户端折叠 + 渲染）远超此时长即视为卡死
  idleTimeoutMs: 12_000,
  // 硬上限 10 分钟：长会话从尾部翻到第 1 轮可能有数百页
  totalTimeoutMs: 600_000,
  maxPages: 400,
  rowWaitMs: 3_000,
  pollMs: 60,
}

/** 一次定位步进的视口比例与上限步数（步进本身已是 80% 视口，最多 60 步 ≈ 48 屏） */
const LOCATE_STEP_RATIO = 0.8
const LOCATE_MAX_STEPS = 60
/** 每步的额外等待（毫秒）。真实浏览器里 pause 已经让出一帧，无需再等——
 *  旧实现每步 120ms（40% 视口），40 步就是 4.8s，纯属白等。 */
const LOCATE_STEP_MS = 0
/** 落位校验：目标行顶部与视口顶的目标间距（端口侧落位与编排侧校验共用同一值），
 *  以及允许偏差 */
export const REVEAL_GAP = 12
const REVEAL_TOLERANCE = 8
const REVEAL_TRIES = 3
/** 连续多少次载荷零进展即判定卡死（每次间隔 250ms） */
const MAX_STALE_LOADS = 40
/** 长加载期间重发 loading 的间隔（续期消费端的自动收起计时） */
const LOADING_REFRESH_MS = 2_000
/** 「加载中…」最短可见时长（避免快加载时一闪而过） */
const LOADING_MIN_VISIBLE_MS = 400
/** 落位前等待版面静止的上限（等官方 prepend 阅读位补偿落地） */
const LAYOUT_STABLE_WAIT_MS = 800
/** 落位校验采样间隔：立即开始、每 60ms 复采一次 */
const VERIFY_SAMPLE_MS = 60
/** 判定"稳了"前必须保持对齐的最短时长（挡晚一拍的阅读位补偿） */
const VERIFY_HOLD_MS = 120

/** 行是否为可渲染锚点行 */
function isVisibleRow(row: { visibility?: string }): boolean {
  return row.visibility !== 'hidden'
}

/** 快照中是否已含目标行 */
function hasTarget(rows: Iterable<{ key: string; visibility?: string }>, key: string): boolean {
  for (const row of rows) {
    if (isVisibleRow(row) && row.key === key) return true
  }
  return false
}

/** 渲染窗口的锚点序号极值；空窗口返回 null */
function seqRange(rows: Iterable<{ anchorSeq: number }>): { min: number; max: number } | null {
  let min: number | null = null
  let max: number | null = null
  for (const row of rows) {
    if (min === null || row.anchorSeq < min) min = row.anchorSeq
    if (max === null || row.anchorSeq > max) max = row.anchorSeq
  }
  return min === null || max === null ? null : { min, max }
}

/** 当前窗口最小锚点序号；空窗口返回 null */
function smallestSeq(rows: Iterable<{ anchorSeq: number }>): number | null {
  const range = seqRange(rows)
  return range === null ? null : range.min
}

/** 回退目标：排除指定 key 的最近可渲染行（取最新锚点序号） */
function retreatTo(
  rows: Iterable<{ key: string; anchorSeq: number; visibility?: string }>,
  excludeKey: string,
): { key: string; anchorSeq: number } | null {
  let best: { key: string; anchorSeq: number } | null = null
  for (const row of rows) {
    if (row.visibility === 'hidden') continue
    if (row.key === excludeKey) continue
    if (best === null || row.anchorSeq > best.anchorSeq) best = { key: row.key, anchorSeq: row.anchorSeq }
  }
  return best
}

/** 让出一帧；无 rAF 环境退化为一次微任务 */
function yieldFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve()
  return new Promise((resolve) => { requestAnimationFrame(() => resolve()) })
}

/** 单步滚动距离：视口 80%（长会话页多，大步进摊薄步数），下限 240px */
function stepDistance(port: HTMLElement): number {
  return Math.max(240, Math.round(port.clientHeight * LOCATE_STEP_RATIO))
}

/**
 * 定位步进（瞬时）。
 *
 * 步进必须瞬时：smooth 动画期间 scrollTop 停在起点，既会把「尚未开始动画」误判成
 * 「已到边界」（旧实现 <2px 判据即栽在这里），也会被官方 ChatView 的 prepend 补偿
 * 与贴底跟随打断（表现为「滚上去没多久就停了」）。
 */
async function locateStep(ports: JumpPorts, port: HTMLElement, dir: 1 | -1): Promise<boolean> {
  const before = port.scrollTop
  port.scrollBy({ top: dir * stepDistance(port), behavior: 'instant' })
  await (ports.pause?.() ?? yieldFrame())
  await ports.sleep(LOCATE_STEP_MS)   // 默认 0：让出一帧已足够，保留只为将来可调
  return Math.abs(port.scrollTop - before) >= 1
}

/**
 * 滚动定位：按方向逐屏瞬时滚动直至目标行挂载并进入视口（或到达滚动边界）。
 * 行已挂载、只是停在视口外时，这里负责把它带回视口。
 */
async function scrollLocate(ports: JumpPorts, key: string, dir: 1 | -1): Promise<HTMLElement | null> {
  const port = ports.scrollport()
  if (port === null) return null
  for (let i = 0; i < LOCATE_MAX_STEPS; i++) {
    if (ports.cancelled?.() === true) return null
    const row = ports.locate(key)
    if (row !== null && (ports.inView?.(row) ?? true)) return row
    const moved = await locateStep(ports, port, dir)
    // 步进可能刚把目标带进视口（locate 只看是否挂载，是否可见由 inView 判定）
    const after = ports.locate(key)
    if (after !== null && (ports.inView?.(after) ?? true)) return after
    if (!moved) break   // 已到滚动边界
  }
  return null
}

/**
 * 最终落位：把目标行顶对齐视口顶（留 REVEAL_GAP 间距）并校验，未到位则重测重滚。
 * 偏移量每次重新测量——官方 ChatView 在 prepend 后会按阅读锚点补偿 scrollTop，
 * 陈旧的行矩形会让落位差出一整段。
 *
 * 返回值仅表示「是否对齐/是否需要中止」（取消或行已卸载时为 false）；
 * 当前调用方不区分二者，一律按「已尽力落位」继续，因此不参与结果码判定。
 */
async function settleOnRow(ports: JumpPorts, row: HTMLElement, final: 'smooth' | 'instant'): Promise<boolean> {
  const cancelled = (): boolean => ports.cancelled?.() === true
  /** 行的实时视口偏移；行已卸载时返回 null（矩形退化，写出去就是垃圾 scrollTop） */
  const measure = (): { port: HTMLElement; offset: () => number } | null => {
    if (!row.isConnected) return null
    const port = ports.scrollport()
    return { port, offset: () => row.getBoundingClientRect().top - port.getBoundingClientRect().top }
  }
  /**
   * 校验落位是否到位。
   *
   * **立即开始校验**（平滑模式下端口返回的 promise 已代表动画跑完、瞬时模式写
   * scrollTop 是同步的，都不该再固定等一轮），但**要连续两次采样都对上才算稳**：
   * 官方随后的阅读位补偿可能正好晚一拍到达，只看一眼会被"暂时对齐"骗过，
   * 补偿落地后位置又偏了（这正是上一版多等一轮意外挡住的那种情况）。
   */
  const offsetOk = (frame: { offset: () => number }): boolean =>
    Math.abs(frame.offset() - REVEAL_GAP) <= REVEAL_TOLERANCE
  const waitAligned = async (frame: { offset: () => number }, mode: 'smooth' | 'instant'): Promise<boolean> => {
    const patience = mode === 'smooth' ? 480 : 200
    let confirmed = 0
    for (let waited = 0; waited <= patience; waited += VERIFY_SAMPLE_MS) {
      if (cancelled()) return false
      if (offsetOk(frame)) {
        confirmed += 1
        // 连续两次对上、且已经过 VERIFY_HOLD_MS：晚一拍的官方阅读位补偿会在这个
        // 窗口内落地，避免被"暂时对齐"骗过（整体代价只有百毫秒级）
        if (confirmed >= 2 && waited >= VERIFY_HOLD_MS) return true
      } else {
        confirmed = 0
      }
      await ports.sleep(VERIFY_SAMPLE_MS)
    }
    return false
  }
  /**
   * 等版面静止再落位。
   *
   * 扩窗（尤其 loadThrough 一次载入几百条）之后，官方 ChatView 会在 layout effect 里
   * 按阅读锚点补偿 scrollTop——那一下发生在「prepend 落地」与「下一次提交」之间。
   * 若我们在补偿之前就发出平滑滚动，目标位置是照旧布局算的，动画播到一半版面又整体
   * 位移，于是表现为「先冲过一屏、再回退到正确位置」。这里先等行位置连续两次采样不变，
   * 再发落位动画；稳定等待有上限，超时照常落位（不会卡住）。
   */
  const waitStable = async (): Promise<boolean> => {
    let previous: number | null = null
    for (let waited = 0; waited <= LAYOUT_STABLE_WAIT_MS; waited += 80) {
      if (cancelled() || !row.isConnected) return false
      const doc = row.getBoundingClientRect().top + ports.scrollport().scrollTop
      if (previous !== null && Math.abs(doc - previous) < 1) return true
      previous = doc
      await ports.sleep(80)
    }
    return !cancelled() && row.isConnected
  }
  if (!(await waitStable())) return false
  for (let attempt = 0; attempt < REVEAL_TRIES; attempt++) {
    if (cancelled()) return false   // 已被新跳转取代：不再抢滚动
    const frame = measure()
    if (frame === null) return false
    // 平滑模式由端口自己驱动的动画完成（await 到停稳），瞬时模式同步生效
    await ports.settle(row, final)
    if (await waitAligned(frame, final)) {
      return true
    }
  }
  if (cancelled()) return false
  const frame = measure()
  if (frame === null) return false
  // 末次兜底：直接瞬时对齐（放弃动画方式），保证「到达指定位置」优先于观感
  frame.port.scrollTop = Math.round(frame.port.scrollTop + frame.offset() - REVEAL_GAP)
  return true
}

/**
 * 等待某行进入 DOM（预算内轮询）；视图失活或被取代返回 null。
 *
 * **不要求进入视口**：官方聊天列表不是视口虚拟化的（整窗 map），行一旦挂载就是
 * 最终位置，滚动由 settleOnRow 负责。旧实现在这里要求 inView，导致「已加载但滚出
 * 视口」这个最常见的情形白等满 rowWaitMs 才轮到滚动。
 */
async function waitForRow(ports: JumpPorts, rowKey: string, rowWaitMs: number, stepMs: number): Promise<HTMLElement | null> {
  for (let waited = 0; waited <= rowWaitMs; waited += stepMs) {
    if (!ports.active() || ports.cancelled?.() === true) return null
    const row = ports.locate(rowKey)
    if (row !== null) return row
    await ports.sleep(stepMs)
  }
  return null
}

/**
 * 跳转到 key 对应行：
 *   - 目标已在渲染窗口 → 等待 DOM 并落位；
 *   - 目标在下方（targetSeq > 当前阅读位）→ 向下瞬时定位，绝不加载；
 *   - 目标更早 → 扩窗（优先官方 loadThrough 单次载入，否则逐页 loadOlder）直至命中；
 *   - 全部失败 → 回退最近可渲染行。
 *
 * 扩窗循环的终止条件全部交给「载荷」：只有无进展、页数上限、无更早历史、
 * 或载荷定位到目标时才结束——不再用固定墙钟打断仍在推进的长加载。
 */
export async function goTo(
  ports: JumpPorts,
  key: string,
  options: JumpOptions = {},
  mode: 'smooth' | 'instant' = 'smooth',
  targetSeq?: number,
  currentSeq?: number,
): Promise<JumpResult> {
  const budget = { ...BUDGET, ...options }
  const fail = (code: JumpFailureCode, fallback = false): JumpResult => {
    ports.report?.(code, fallback)
    return fallback ? { ok: false, code, fallback: true } : { ok: false, code }
  }
  const gone = (): boolean => !ports.active() || ports.cancelled?.() === true

  if (gone()) return fail('VIEW_INACTIVE')

  const deadline = ports.now() + budget.totalTimeoutMs
  /** 提示显示起点：加载很快时也保证「加载中…」可见，不至于一闪而过 */
  let shownAt = 0
  /** 提示心跳开关（长加载期间周期性续期消费端的兜底计时） */
  let heartbeat = false
  /** 无进展计时的起点（每次窗口真正前移即重置） */
  let lastProgressAt = ports.now()
  /** 已观察到的最小窗口头（进展基线） */
  let lastHead = Number.MAX_SAFE_INTEGER
  /** 已发起的扩窗次数（页数上限判定用） */
  let rounds = 0
  let loadingNotified = false
  /**
   * 加载提示。只发「开始 / 结束」两个状态，不带任何计数回显——页数无法如实取得
   * （官方 loadThrough 的页数不对外暴露、窗口头也可能读不到），显示一个不动的数字
   * 只会误导。
   *
   * 长加载期间由**独立心跳**周期性重发 loading=true（不依赖循环节奏）：消费端有
   * 「N 秒无事件即自动收起」的兜底；若只在循环里发事件，单次 loadThrough 内部翻很多页
   * 时会隔很久才发一次，提示就会在中途消失。
   */
  const notifyLoading = (): void => {
    if (loadingNotified) return
    loadingNotified = true
    shownAt = ports.now()
    ports.onLoading?.(true)
    heartbeat = true
    void (async () => {
      while (heartbeat) {
        await ports.sleep(LOADING_REFRESH_MS)
        if (!heartbeat) return
        ports.onLoading?.(true)
      }
    })()
  }
  const notifyIdle = (): void => {
    if (!loadingNotified) return   // 没有对外宣告过加载：不补发任何事件
    loadingNotified = false
    heartbeat = false
    const shown = shownAt === 0 ? 0 : ports.now() - shownAt
    shownAt = 0
    // 快加载也让它停留一下：否则「加载中…」会一闪而过（甚至看不见）
    if (shown < LOADING_MIN_VISIBLE_MS) {
      void ports.sleep(LOADING_MIN_VISIBLE_MS - shown).then(() => ports.onLoading?.(false))
      return
    }
    ports.onLoading?.(false)
  }

  /** 落位（确认高亮由 settle 端口在落位时触发） */
  const land = async (row: HTMLElement): Promise<void> => {
    await settleOnRow(ports, row, mode)
  }

  /** 目标已在渲染窗口 → 等到 DOM 挂载并落位（不加载） */
  const settleExisting = async (): Promise<JumpResult | null> => {
    notifyIdle()
    const row = await waitForRow(ports, key, budget.rowWaitMs, budget.pollMs)
    if (row === null) return null
    await land(row)
    return { ok: true }
  }

  /**
   * 读一次快照的可判定面。
   * 注意：0.1.5-rc.2 的聊天列表**不是视口虚拟化**的（ChatNodeList 直接 map 整个
   * order），所以「locate 命中」等价于「已加载」——不存在「数据在窗口内但 DOM 未挂载」。
   * 「已加载但滚出视口」由进入视口那一步解决，不需要等。
   */
  const readProbe = (): ProbeResult | null => {
    const snap = ports.snap()
    if (snap === undefined) return null
    const rows = snap.rows
    const located = ports.locate(key)
    return {
      stop: located !== null || hasTarget(rows, key) ? 'target' : undefined,
      min: smallestSeq(rows),
      hasMore: snap.hasMore === true,
      loading: snap.loadingOlder === true,
    }
  }

  /**
   * 一次扩窗载荷：内部循环直到「目标命中 / 无更早历史 / 无进展 / 页数上限 / 硬超时」。
   * 每次窗口最小 seq 真正前移都重置无进展计时——长会话只要还在推进就不会被超时打断。
   */
  /**
   * 一次扩窗载荷：内部循环直到「目标命中 / 无更早历史 / 无进展 / 页数上限 / 硬超时」。
   *
   * 关键点：
   *  - **已有加载在飞时照样调 loadThrough**——官方契约是「在飞的跳转加载会下压共享
   *    目标并返回同一个 promise」（重定向），只有「普通 loadOlder 占着忙标志」才会
   *    直接 resolve 空转。干等不调用会白烧无进展计时并误报超时。
   *  - 进展以「窗口头前移」为准，而不是「有没有提问行」——一个只含助手/工具行的
   *    尾部窗口（超长回合正在跑）也算已建立的窗口，同样要发起加载。
   *  - 页数上限只对回退通道（loadMore）成立：loadThrough 自带内部推进，外部无法计数。
   */
  const loadPayload = async (): Promise<StopReason> => {
    /** 连续零进展的载荷次数（与无进展计时共同兜底） */
    let stale = 0
    /** 一次观测是否构成「进展」：窗口最小锚点序号前移 */
    const progressed = (probe: ProbeResult): boolean => {
      if (probe.min === null || probe.min >= lastHead) return false
      lastHead = probe.min
      return true
    }
    const canThrough = ports.loadThrough !== undefined
      && targetSeq !== undefined && Number.isFinite(targetSeq) && targetSeq >= 0
    for (;;) {
      if (gone()) return 'inactive'
      const probe = readProbe()
      if (probe === null) return 'inactive'
      if (probe.stop !== undefined) return probe.stop
      if (ports.now() > deadline) return 'timeout'
      if (probe.hasMore !== true) return 'exhausted'

      // 进展判定：窗口头前移 **或** 已物化行数增加（后者永远可观测）
      if (progressed(probe)) { lastProgressAt = ports.now(); stale = 0 }
      notifyLoading()

      if (canThrough) {
        // 官方跳转加载器：单次调用连续扩窗（200 条/页）直到窗口覆盖目标 seq；
        // 已有在飞加载时它会把共享目标下压到 min(seq) 并返回同一个 promise（重定向），
        // 所以「别人正在加载」也照调不误——干等只会白烧无进展计时。
        rounds += 1
        await ports.loadThrough!(targetSeq!)
        await (ports.pause?.() ?? yieldFrame())
      } else if (probe.loading === true) {
        // 回退通道下正文正在加载：loadOlder 会静默空转，等它结束再试
        if (ports.now() - lastProgressAt > budget.idleTimeoutMs) return 'idle'
        await ports.sleep(budget.pollMs)
        continue
      } else {
        if (rounds >= budget.maxPages) return 'pages'
        rounds += 1
        await ports.loadMore()
        // 回退通道：loadOlder resolve 早于数据落地，等窗口头前移或行数增加
        for (let waited = 0; waited <= 2_000; waited += budget.pollMs) {
          const s2 = readProbe()
          if (s2 === null) return 'inactive'
          if (s2.min !== null && (probe.min === null || s2.min < probe.min)) break
          await ports.sleep(budget.pollMs)
        }
      }

      const after = readProbe()
      if (after === null) return 'inactive'
      if (progressed(after)) {
        lastProgressAt = ports.now()
        stale = 0
      } else {
        stale += 1
        if (stale >= MAX_STALE_LOADS) return 'idle'
        // 载荷零进展（被官方普通加载占用 / 组件尚未提交）：短等后重判
        await ports.sleep(250)
        if (ports.now() - lastProgressAt > budget.idleTimeoutMs) return 'idle'
      }
    }
  }

  // 阶段一：确保目标进入渲染窗口
  const initial = readProbe()
  if (initial === null) { notifyIdle(); return fail('VIEW_INACTIVE') }

  if (initial.stop !== 'target') {
    const range = seqRange(ports.snap()?.rows ?? [])
    const below = targetSeq !== undefined && (currentSeq !== undefined
      ? targetSeq > currentSeq
      : range !== null && targetSeq > range.max)
    if (below) {
      // 明确在下方：向下瞬时定位，绝不加载
      const found = await scrollLocate(ports, key, 1)
      if (found !== null) {
        notifyIdle()
        await land(found)
        return { ok: true }
      }
      notifyIdle()
      return fail('TARGET_HIDDEN')
    }

    // 目标可能已加载但停留在视口上方未渲染：先向上一轮瞬时定位（仅在距离不远时，
    // 避免长会话为一次跳转白白滚过整段历史）
    if (initial.loading !== true) {
      const closeEnough = targetSeq === undefined || range === null || targetSeq >= range.min - 40
      if (closeEnough) {
        const up = await scrollLocate(ports, key, -1)
        if (up !== null) {
          notifyIdle()
          await land(up)
          return { ok: true }
        }
      }
    }

    if (ports.snap()?.openState !== 'open') {
      // 会话仍在打开：等它进入 open（不计入无进展）
      const openDeadline = ports.now() + budget.idleTimeoutMs
      for (;;) {
        const state = ports.snap()?.openState
        if (state === 'open') break
        if (gone()) { notifyIdle(); return fail('VIEW_INACTIVE') }
        if (state === 'error' || ports.now() > openDeadline) {
          notifyIdle()
          return fail('VIEW_INACTIVE')
        }
        await ports.sleep(budget.pollMs)
      }
    }

    const stop = await loadPayload()
    if (stop === 'idle' || stop === 'timeout' || stop === 'pages') {
      // 预算耗尽：先尽力落位到已加载窗口内的目标（部分加载也优于停在原地）
      const landed = await settleExisting()
      if (landed !== null) return landed
      notifyIdle()
      return fail(stop === 'pages' ? 'NOT_FOUND' : 'TIMEOUT')
    }
    if (stop === 'exhausted') {
      const landed = await settleExisting()
      if (landed !== null) return landed
      notifyIdle()
      return fail('NOT_FOUND')
    }
    if (stop === 'inactive') { notifyIdle(); return fail('VIEW_INACTIVE') }
  }

  notifyIdle()

  // 阶段二：等到行挂载后落位（数据已覆盖目标时行必然在 DOM 里，这里只是兜底轮询）
  const row = await waitForRow(ports, key, budget.rowWaitMs, budget.pollMs)
  if (row !== null) {
    await land(row)
    return { ok: true }
  }

  // 回退：最近的可渲染行（排除目标自身）；被取代时不再落位
  if (gone()) return fail('VIEW_INACTIVE')
  const fallback = retreatTo(ports.snap()?.rows ?? [], key)
  if (fallback !== null) {
    const fbRow = await waitForRow(ports, fallback.key, budget.rowWaitMs, budget.pollMs)
    if (fbRow !== null) {
      // 已经落到可用内容上：这是一次「成功但有折扣」的跳转。
      // 旧实现同时返回 ok=false 并弹「加载历史超时」错误提示，与眼前已完成的
      // 滚动互相矛盾（用户看到的正是这种「明明跳过去了还报超时」）。
      await land(fbRow)
      ports.report?.('TARGET_HIDDEN', true)
      return { ok: true, code: 'TARGET_HIDDEN', fallback: true }
    }
  }
  return fail('TARGET_HIDDEN', false)
}
