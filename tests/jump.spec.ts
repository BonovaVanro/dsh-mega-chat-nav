/**
 * 跳转编排单测（src/client/jump.ts）。
 *
 * 重点覆盖长会话的两类线上故障：
 *  1) 「加载了很多分页仍超时」——扩窗改走官方 loadThrough（200 条/页、单 promise
 *     推进到目标 seq），并且预算按「有无进展」判定，不再用固定墙钟打断仍在推进的加载；
 *  2) 「滚上去没多久就停、没到指定位置」——步进一律瞬时，最终落位校验重试。
 *
 * 环境为 node + 自建几何桩（不引入 jsdom）：元素只需 getBoundingClientRect，
 * 滚动容器只需 scrollTop/clientHeight/scrollBy。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { goTo, JUMP_FAILURE_KEY, REVEAL_GAP, type JumpFailureCode, type JumpPorts, type JumpSnapshot } from '../src/client/jump.ts'

interface FakeRow {
  key: string
  anchorSeq: number
  visibility?: string
}

interface Session {
  openState: string
  hasMore: boolean
  loadingOlder: boolean
  rows: FakeRow[]
  /** 已挂载到「DOM」的行 key（虚拟渲染窗口可小于数据窗口） */
  dom: Set<string>
  /** 权威窗口头（全部聊天行的最小锚点序号），由宿主读出 */
  windowHead: number | null
}

interface Harness {
  ports: JumpPorts
  session: Session
  state: {
    loadOlderCalls: number
    loadThroughCalls: number
    revealed: { key: string; mode: string }[]
    reports: { code: JumpFailureCode; fallback: boolean }[]
    loadingEvents: { loading: boolean }[]
    scrollTop: number
  }
  /** 让接下来的 N 次 loadOlder / loadThrough 静默空转（模拟官方在飞加载占用） */
  stallLoads: (times: number) => void
  /** 一次扩窗：prepend 指定条数的假行 */
  grow: (messages: number) => boolean
  /** 清空窗口（构造「尾部窗口」用） */
  resetWindow: () => void
  /** 在窗口尾部追加一行（真实挂载） */
  appendTail: (key: string, anchorSeq: number) => void
  /** 从 DOM 摘掉一行（数据仍在窗口内） */
  unmount: (key: string) => void
  /** 重新挂载一行（沿用其文档位置） */
  remount: (key: string) => void
  /** 某行当前的视口顶部坐标（未挂载返回 null） */
  viewportTop: (key: string) => number | null
  /** 当前滚动位置 */
  scrollTop: () => number
  /** 滚动上限（内容总高 - 视口高） */
  scrollFloor: () => number
  /** 把阅读位设为贴底（官方 at-bottom 跟随待命态） */
  scrollToBottom: () => void
  /** 把阅读位设为窗口顶部（构造初始阅读位） */
  jumpViewToStart: () => void
  /** 任意 prepend（不改变既有行的文档坐标口径，仅追加到窗口头之前） */
  prependRows: (rows: { key: string; anchorSeq: number }[]) => void
  /** 读/写权威窗口头 */
  windowHead: () => number | null
  setWindowHead: (head: number | null) => void
  /** 把整个版面在文档坐标上平移（模拟官方 prepend 后的阅读位补偿） */
  shiftDocument: (px: number) => void
  /** 某行的文档坐标（未挂载返回 null） */
  documentTop: (key: string) => number | null
  /** 某行已挂载的元素（未挂载返回 null） */
  elementOf: (key: string) => HTMLElement | null
  /** 滚动容器元素（测试里直接读写 scrollTop 用） */
  scrollportElement: () => HTMLElement
}

const CLIENT_HEIGHT = 800
/** 行挂载时的名义高度 */
const ROW_HEIGHT = 40

interface Box { top: number; bottom: number; left: number; right: number }

/** 视口坐标：文档坐标 - 滚动位置（与真实浏览器一致，落位校验全靠这个语义） */
function makeElement(position: { px: number }, scrollTop: () => number): HTMLElement {
  return {
    // 真实 DOM 元素恒为 true；落位逻辑用它判断「行是否已卸载」
    isConnected: true,
    getBoundingClientRect(): Box {
      const top = position.px - scrollTop()
      return { top, bottom: top + ROW_HEIGHT, left: 0, right: 600 }
    },
    scrollIntoView(): void {},
  } as unknown as HTMLElement
}

function makeHarness(initial: Partial<Session> = {}): Harness {
  const session: Session = {
    openState: 'open',
    hasMore: true,
    loadingOlder: false,
    rows: [],
    dom: new Set<string>(),
    windowHead: null,
    ...initial,
  }
  for (const row of session.rows) session.dom.add(row.key)

  const state: Harness['state'] = {
    loadOlderCalls: 0,
    loadThroughCalls: 0,
    revealed: [],
    reports: [],
    loadingEvents: [],
    scrollTop: 0,
  }

  let stalls = 0
  const stallLoads = (times: number): void => { stalls = times }

  /** 已挂载元素的「文档坐标」与元素对象 */
  const mounted = new Map<string, { el: HTMLElement; position: { px: number } }>()
  /** 下一批 prepend 的行在文档中的起始坐标基准 */
  let nextTop = 0

  /**
   * 滚动容器：视口坐标原点固定在 0（容器自身不随内容移动，只有内容随 scrollTop 移动）。
   * 行元素的视口位置 = 文档坐标 - scrollTop（见 makeElement）。
   */
  const contentHeight = (): number => {
    let max = 0
    for (const [, entry] of mounted) max = Math.max(max, entry.position.px + ROW_HEIGHT)
    return max
  }
  const scrollport = {
    clientHeight: CLIENT_HEIGHT,
    scrollTop: 0,
    /** 与真实容器一致：内容总高（判定「是否贴底」要用它） */
    get scrollHeight(): number { return contentHeight() },
    scrollBy({ top }: { top: number }) { this.scrollTop += top },
    getBoundingClientRect(): Box {
      return { top: 0, bottom: CLIENT_HEIGHT, left: 0, right: 600 }
    },
  }

  /** 元素 → key 反查（reveal 端口记录用） */
  const elementKeys = new WeakMap<HTMLElement, string>()

  const mount = (key: string, top: number): HTMLElement => {
    const position = { px: top }
    const el = makeElement(position, () => scrollport.scrollTop)
    mounted.set(key, { el, position })
    elementKeys.set(el, key)
    session.dom.add(key)
    return el
  }

  /** 在窗口最前插入 n 行：已有内容整体下推 n*ROW_HEIGHT（真实 prepend 语义） */
  const prependMounted = (fresh: FakeRow[]): void => {
    const shift = fresh.length * ROW_HEIGHT
    for (const [, entry] of mounted) entry.position.px += shift
    let top = 0
    for (const row of fresh) { mount(row.key, top); top += ROW_HEIGHT }
    // 滚动位置随内容下推（等价的滚动锚定结果）
    scrollport.scrollTop = Math.round(scrollport.scrollTop + shift)
    nextTop = shift
  }

  const smallest = (): number | null => {
    if (session.rows.length === 0) return null
    return session.rows.reduce((min, row) => Math.min(min, row.anchorSeq), Number.POSITIVE_INFINITY)
  }

  /** 一次性 prepend（官方 prepend 是一批消息，不是一条） */
  const grow = (messages: number): boolean => {
    const before = smallest()
    if (session.rows.length === 0) {
      for (let seq = 1; seq <= messages; seq++) {
        const row = { key: 'k' + seq, anchorSeq: seq }
        session.rows.push(row)
        mount(row.key, nextTop)
        nextTop += ROW_HEIGHT
      }
      return true
    }
    const head = session.rows[0].anchorSeq
    const base = Math.max(1, head - messages)
    const fresh: FakeRow[] = []
    for (let seq = head - 1; seq >= base; seq--) fresh.push({ key: 'k' + seq, anchorSeq: seq })
    fresh.reverse()
    session.rows = [...fresh, ...session.rows]
    prependMounted(fresh)
    const after = smallest()
    return after !== null && (before === null || after < before)
  }

  const ports: JumpPorts = {
    snap: (): JumpSnapshot => ({
      openState: session.openState,
      hasMore: session.hasMore,
      loadingOlder: session.loadingOlder,
      rows: session.rows,
      head: session.windowHead,
      loadedRows: session.rows.length,
    }),
    loadMore: async () => {
      state.loadOlderCalls += 1
      if (stalls > 0) { stalls -= 1; return }
      if (!grow(50)) session.hasMore = false
    },
    loadThrough: async (seq: number) => {
      state.loadThroughCalls += 1
      if (stalls > 0) { stalls -= 1; return }
      while (session.hasMore) {
        const before = smallest()
        if (before !== null && before <= seq) break
        if (!grow(200)) { session.hasMore = false; break }
      }
    },
    active: () => true,
    locate: (key) => mounted.get(key)?.el ?? null,
    inView: (row) => {
      const top = row.getBoundingClientRect().top
      return top + ROW_HEIGHT > 0 && top < CLIENT_HEIGHT
    },
    // 真实端口的行为：落位（这里按瞬时实现）+ 触发一次确认高亮（测试可覆写）
    settle: (row) => {
      state.revealed.push({ key: elementKeys.get(row) ?? '', mode: 'reveal' })
      const key = elementKeys.get(row) ?? ''
      const entry = mounted.get(key)
      if (entry !== undefined) {
        scrollport.scrollTop = Math.max(0, Math.round(scrollport.scrollTop + entry.el.getBoundingClientRect().top - REVEAL_GAP))
      }
    },
    scrollport: () => scrollport as unknown as HTMLElement,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    pause: () => new Promise((resolve) => setTimeout(resolve, 16)),
    report: (code, fallback) => { state.reports.push({ code, fallback: fallback === true }) },
    onLoading: (loading) => {
      state.loadingEvents.push({ loading })
      // 同时走真实事件通道：覆盖消费端读 detail 的路径
      emitPluginEvent('mega-chat-nav:jump-loading', { loading })
    },
  }

  const resetWindow = (): void => {
    session.rows = []
    session.dom.clear()
    mounted.clear()
    nextTop = 0
  }
  /**
   * 在内容末尾追加一行（真实 append 语义）：既有行的文档坐标不动，
   * 阅读位也不动——官方只在自己的跟随逻辑里才回底。
   */
  const appendTail = (key: string, anchorSeq: number): void => {
    session.rows.push({ key, anchorSeq })
    let tail = 0
    for (const [, entry] of mounted) tail = Math.max(tail, entry.position.px + ROW_HEIGHT)
    mount(key, tail)
  }
  const unmount = (key: string): void => {
    session.dom.delete(key)
    mounted.delete(key)
  }
  const remount = (key: string): void => {
    const entry = session.rows.find((row) => row.key === key)
    if (entry === undefined) return
    // 挂到当前视口下方之外（阅读位不变）
    mount(key, scrollport.scrollTop + CLIENT_HEIGHT + ROW_HEIGHT)
  }

  const viewportTop = (key: string): number | null =>
    mounted.get(key)?.el.getBoundingClientRect().top ?? null
  const scrollFloor = (): number => Math.max(0, contentHeight() - CLIENT_HEIGHT)
  const scrollToBottom = (): void => { scrollport.scrollTop = scrollFloor() }
  const jumpViewToStart = (): void => { scrollport.scrollTop = 0 }
  const prependRows = (fresh: { key: string; anchorSeq: number }[]): void => {
    session.rows = [...fresh, ...session.rows]
    prependMounted(fresh)
  }

  return {
    ports, session, state, stallLoads, grow, resetWindow, appendTail, unmount, remount,
    viewportTop,
    scrollTop: () => scrollport.scrollTop,
    scrollFloor,
    scrollToBottom,
    jumpViewToStart,
    prependRows,
    windowHead: () => session.windowHead,
    setWindowHead: (head: number | null) => { session.windowHead = head },
    shiftDocument: (px: number) => {
      for (const [, entry] of mounted) entry.position.px += px
    },
    documentTop: (key: string) => mounted.get(key)?.position.px ?? null,
    elementOf: (key: string) => mounted.get(key)?.el ?? null,
    scrollportElement: () => scrollport as unknown as HTMLElement,
  }
}

/**
 * 让「窗口只包含比 startSeq 更新的行」——目标落在更早历史里。
 * 行必须真正挂到几何桩上，locate() 才可能命中。
 */
function tailWindow(h: Harness, messages: number, startSeq: number): void {
  tailRows(h, Array.from({ length: messages }, (_, i) => ({ key: 'k' + (startSeq + i), anchorSeq: startSeq + i })))
}

/** 用任意行序列构造初始窗口（用于提问行稀疏的真实会话形态） */
function tailRows(h: Harness, rows: { key: string; anchorSeq: number }[]): void {
  h.resetWindow()
  for (const row of rows) h.appendTail(row.key, row.anchorSeq)
  // 阅读位停在窗口顶部（尾部窗口的默认阅读位）
  h.jumpViewToStart()
}

/**
 * 跑完一次跳转：先推进假时钟再 await —— 编排内部全用定时器轮询/落位，
 * 只 await 不推进会与假时钟互等（真实浏览器里由事件循环自然推进）。
 */
async function runJump(
  ports: JumpPorts,
  key: string,
  options: Parameters<typeof goTo>[2],
  mode: 'smooth' | 'instant',
  targetSeq?: number,
  currentSeq?: number,
  advanceMs = 60_000,
): Promise<Awaited<ReturnType<typeof goTo>>> {
  const promise = goTo(ports, key, options, mode, targetSeq, currentSeq)
  let settled = false
  void promise.then(() => { settled = true }, () => { settled = true })
  // 分片推进：每片之后让出一轮微任务，链式 await 才有机会挂上下一批定时器。
  // 跳转已结束就停止推进，避免假时钟跑到未来、污染测试里的时间断言。
  const chunk = 50
  for (let elapsed = 0; elapsed < advanceMs && !settled; elapsed += chunk) {
    await vi.advanceTimersByTimeAsync(chunk)
    await Promise.resolve()
  }
  await promise
  // 跳转结束后再吞掉尾部定时器（"加载中…"的最短可见时长、心跳收尾等），
  // 这样对 loading 事件的断言看到的是最终状态
  await vi.advanceTimersByTimeAsync(1_000)
  return promise
}

/**
 * node 环境没有 DOM：测试用最小 window 事件通道观察宿主发出的 jump-loading 事件。
 * 用 node 原生 Event + 挂 detail 字段，避免为测试引入 jsdom。
 */
function emitPluginEvent(type: string, detail: unknown): void {
  const event = new Event(type) as Event & { detail: unknown }
  Object.assign(event, { detail })
  ;(window as unknown as EventTarget).dispatchEvent(event)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16))
  vi.stubGlobal('window', new EventTarget())
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('goTo: 已在窗口内的目标', () => {
  it('挂载完成即瞬时落位，不触发任何扩窗', async () => {
    const h = makeHarness()
    tailWindow(h, 20, 100)
    const result = await runJump(h.ports, 'k105', {}, 'smooth', 105, 110)
    expect(result).toEqual({ ok: true })
    expect(h.state.loadOlderCalls).toBe(0)
    expect(h.state.loadThroughCalls).toBe(0)
    // 落位后目标顶对齐视口顶 + REVEAL_GAP
    expect(h.viewportTop('k105')).toBe(REVEAL_GAP)
    // 确认高亮只在落位后触发一次（'reveal' 模式），定位过程不闪
    expect(h.state.revealed.filter((r) => r.mode === 'reveal').map((r) => r.key)).toEqual(['k105'])
  })

  it('目标在窗口内但未挂载：等到挂载后再落位，不扩窗', async () => {
    const h = makeHarness()
    tailWindow(h, 20, 100)
    h.unmount('k105')
    setTimeout(() => h.remount('k105'), 300)
    const result = await runJump(h.ports, 'k105', {}, 'smooth', 105, 110)
    expect(result).toEqual({ ok: true })
    expect(h.state.loadThroughCalls).toBe(0)
  })

  it('目标始终不挂载（气泡被隐藏）→ 等待后回退到相邻行', async () => {
    const h = makeHarness()
    tailWindow(h, 20, 100)
    h.unmount('k105')
    const result = await runJump(h.ports, 'k105', { rowWaitMs: 200, pollMs: 20 }, 'instant', 105, 110)
    // 回退成功 = 跳转成功（有折扣）：已落到相邻行，不能再报「超时」吓用户
    expect(result.ok).toBe(true)
    expect(result.code).toBe('TARGET_HIDDEN')
    expect(result.fallback).toBe(true)
    expect(h.state.reports.at(-1)).toEqual({ code: 'TARGET_HIDDEN', fallback: true })
  })
})

describe('goTo: 目标更早（向上补历史）', () => {
  it('走官方 loadThrough 单次载入（200 条批），不用逐页 loadOlder', { timeout: 30_000 }, async () => {
    const h = makeHarness()
    tailWindow(h, 300, 800)
    const result = await runJump(h.ports, 'k120', {}, 'instant', 120, 1000)
    expect(result).toEqual({ ok: true })
    expect(h.state.loadThroughCalls).toBe(1)
    expect(h.state.loadOlderCalls).toBe(0)
    expect(h.session.rows[0].anchorSeq).toBeLessThanOrEqual(120)
    expect(h.state.loadingEvents[0]).toEqual({ loading: true })
    expect(h.state.loadingEvents.at(-1)).toEqual({ loading: false })
  })

  it('长会话连续多批：只要仍在推进就不判超时（旧实现固定 30s 必超时）', { timeout: 30_000 }, async () => {
    const h = makeHarness()
    tailWindow(h, 300, 2000)
    // 每批只前进 100 条且耗时 2s：到目标需十几批、远超 30s
    h.ports.loadThrough = async (seq: number) => {
      h.state.loadThroughCalls += 1
      h.grow(100)
      if (h.session.rows[0].anchorSeq > seq) await new Promise((r) => setTimeout(r, 2000))
    }
    const result = await runJump(h.ports, 'k120', {}, 'instant', 120, 3000, 200_000)
    expect(result).toEqual({ ok: true })
    expect(h.state.loadThroughCalls).toBeGreaterThan(10)
  })

  it('官方加载器不可用时退回逐页 loadOlder，并在窗口前移后命中', { timeout: 30_000 }, async () => {
    const h = makeHarness()
    tailWindow(h, 300, 800)
    const ports = { ...h.ports, loadThrough: undefined }
    const result = await runJump(ports, 'k120', {}, 'instant', 120, 1000, 200_000)
    expect(result).toEqual({ ok: true })
    expect(h.state.loadOlderCalls).toBeGreaterThan(0)
    expect(h.session.rows[0].anchorSeq).toBeLessThanOrEqual(120)
  })

  it('载荷持续零进展 → 无进展超时（不无限空转）', { timeout: 30_000 }, async () => {
    const h = makeHarness()
    tailWindow(h, 300, 800)
    h.stallLoads(1000)
    const result = await runJump(h.ports, 'k120', { idleTimeoutMs: 500 }, 'instant', 120, 1000, 200_000)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('TIMEOUT')
    expect(h.state.reports.at(-1)?.code).toBe('TIMEOUT')
  })

  it('历史已到底（hasMore=false）→ NOT_FOUND，不再空转', async () => {
    const h = makeHarness()
    tailWindow(h, 300, 800)
    h.session.hasMore = false
    const result = await runJump(h.ports, 'k120', {}, 'instant', 120, 1000)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NOT_FOUND')
    expect(h.state.loadThroughCalls).toBe(0)
  })
})

describe('goTo: 目标在下方', () => {
  it('只向下瞬时定位，绝不触发扩窗', { timeout: 30_000 }, async () => {
    const h = makeHarness()
    tailWindow(h, 20, 100)
    const result = await runJump(h.ports, 'k300', {}, 'instant', 300, 105)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('TARGET_HIDDEN')
    expect(h.state.loadOlderCalls).toBe(0)
    expect(h.state.loadThroughCalls).toBe(0)
  })
})
describe('goTo: 并发与他人加载（S3）', () => {
  it('已有普通加载占着忙标志时改用 loadThrough 重定向，而不是干等超时', { timeout: 30_000 }, async () => {
    const h = makeHarness()
    tailWindow(h, 300, 800)
    h.session.loadingOlder = true          // 正文自己在加载
    setTimeout(() => { h.session.loadingOlder = false }, 1000)
    const result = await runJump(h.ports, 'k120', { idleTimeoutMs: 500 }, 'instant', 120, 1000, 30_000)
    expect(result).toEqual({ ok: true })
    // 关键：没有因为「别人在加载」就放弃调用官方加载器
    expect(h.state.loadThroughCalls).toBeGreaterThan(0)
  })

  it('窗口头被别人的加载推进也算进展，不计入无进展', { timeout: 30_000 }, async () => {
    const h = makeHarness()
    tailWindow(h, 300, 800)
    h.session.loadingOlder = true
    // 每 200ms 由「别人」推进 100 条，直到覆盖目标
    const timer = setInterval(() => {
      if (!h.grow(100)) { clearInterval(timer); h.session.hasMore = false }
      if (h.session.rows[0].anchorSeq <= 120) { clearInterval(timer); h.session.loadingOlder = false }
    }, 200)
    // 关掉官方加载器通道，强制走「别人推进 + loadMore 回退」路径
    const ports = { ...h.ports, loadThrough: undefined }
    const result = await runJump(ports, 'k120', { idleWindowMs: 0 } as never, 'instant', 120, 1000, 120_000)
    clearInterval(timer)
    expect(result).toEqual({ ok: true })
  })

  it('已被取代的跳转不再落位，也不触发高亮', { timeout: 30_000 }, async () => {
    const h = makeHarness()
    tailWindow(h, 300, 800)
    // 多批慢加载，制造出可被取代的中间检查点
    h.ports.loadThrough = async () => {
      h.state.loadThroughCalls += 1
      h.grow(100)
      await new Promise((r) => setTimeout(r, 400))
    }
    let cancelled = false
    const ports = { ...h.ports, cancelled: () => cancelled }
    const promise = goTo(ports, 'k120', {}, 'instant', 120, 1000)
    await vi.advanceTimersByTimeAsync(1000)
    cancelled = true                     // 模拟用户又点了别的节点
    await vi.advanceTimersByTimeAsync(60_000)
    const result = await promise
    expect(result.ok).toBe(false)
    expect(result.code).toBe('VIEW_INACTIVE')
    expect(h.state.revealed).toEqual([])
  })
})

describe('goTo: 加载提示（S2）', () => {
  it('长加载期间周期性续期提示，结束时收起', { timeout: 30_000 }, async () => {
    const h = makeHarness()
    tailWindow(h, 300, 2000)
    h.ports.loadThrough = async (seq: number) => {
      h.state.loadThroughCalls += 1
      h.grow(100)
      await new Promise((r) => setTimeout(r, 400))
    }
    const result = await runJump(h.ports, 'k120', {}, 'instant', 120, 3000, 200_000)
    expect(result).toEqual({ ok: true })
    const starts = h.state.loadingEvents.filter((e) => e.loading)
    // 消费端有「N 秒无事件即收起」的兜底：长加载必须持续续期，否则提示会中途消失
    // （每个事件之间的假时钟间隔必须小于该兜底窗口）
    expect(starts.length).toBeGreaterThan(3)
    expect(h.state.loadingEvents.at(-1)).toEqual({ loading: false })
  })
})

describe('goTo: 结果码与词条映射（R12）', () => {
  it('四个结果码都映射到点分词条键，不再全部退化成「超时」', () => {
    expect(JUMP_FAILURE_KEY.VIEW_INACTIVE).toBe('jump.inactive')
    expect(JUMP_FAILURE_KEY.TARGET_HIDDEN).toBe('jump.hidden')
    expect(JUMP_FAILURE_KEY.NOT_FOUND).toBe('jump.notfound')
    expect(JUMP_FAILURE_KEY.TIMEOUT).toBe('jump.timeout')
  })
})
describe('goTo: 贴底跳转（官方 25px 跟随区间）', () => {
  it('落位位移足够脱离贴底区间；目标位于文末时也保持可见', { timeout: 30_000 }, async () => {
    const h = makeHarness()
    tailWindow(h, 40, 100)
    // 阅读位贴底：官方 at-bottom 跟随处于待命状态
    h.scrollToBottom()
    const result = await runJump(h.ports, 'k104', {}, 'instant', 104, 138, 30_000)
    expect(result.ok).toBe(true)
    const landed = h.scrollTop()
    const floor = h.scrollFloor()
    // 落位把目标顶对齐视口顶 + REVEAL_GAP（位移远大于官方 25px 判定带）
    expect(h.viewportTop('k104')).toBe(REVEAL_GAP)
    // 距底必须已经离开 25px 跟随区间，否则后续 prepend/追加会把视图重新拉回底部
    expect(floor - landed).toBeGreaterThan(25)
  })
})

describe('goTo: 扩窗后追加内容不破坏落位（官方 prepend 锚点补偿）', () => {
  it('落位后追加内容不会让视图回到底部', { timeout: 30_000 }, async () => {
    const h = makeHarness()
    tailWindow(h, 300, 800)
    const result = await runJump(h.ports, 'k140', {}, 'instant', 140, 1000, 120_000)
    expect(result.ok).toBe(true)
    const before = h.viewportTop('k140')
    h.appendTail('k1200', 1200)   // 阅读位置不变；官方只在自己的跟随逻辑里回底
    expect(h.viewportTop('k140')).toBe(before)
  })
})
describe('goTo: 提问行稀疏的会话（实测形态）', () => {
  it('提示按轮次持续续期，不受提问行稀疏影响', { timeout: 30_000 }, async () => {
    const h = makeHarness()
    // 实测会话：2104 个事件、只有 4 个提问（序号 19/1797/1904/1989）；
    // 这段历史里**没有提问行**——窗口最小锚点序号长期不动。
    tailRows(h, [{ key: 'k1989', anchorSeq: 1989 }, { key: 'k1990', anchorSeq: 1990 }])
    const target = 1797
    h.setWindowHead(1989)
    h.ports.loadThrough = async (seq: number) => {
      h.state.loadThroughCalls += 1
      await new Promise((r) => setTimeout(r, 2500))   // 单页往返：让加载持续十几秒
      const head = h.windowHead()
      if (head === null || head <= seq) return
      const next = Math.max(seq, head - 200)
      h.setWindowHead(next)
      h.prependRows([{ key: 'a' + next, anchorSeq: next }])
      if (next <= target) h.prependRows([{ key: 'k' + target, anchorSeq: target }])
    }

    const seen: { at: number; loading: boolean }[] = []
    const onEvent = (event: Event): void => {
      seen.push({ at: Date.now(), loading: (event as Event & { detail?: { loading?: boolean } }).detail?.loading === true })
    }
    window.addEventListener('mega-chat-nav:jump-loading', onEvent)
    // 加载持续十几秒（每轮 2.5s），远超消费端兜底窗口
    const result = await runJump(h.ports, 'k1797', {}, 'instant', 1797, 2104, 120_000)
    window.removeEventListener('mega-chat-nav:jump-loading', onEvent)

    expect(result.ok).toBe(true)
    // 提示必须持续续期：相邻两次 loading=true 的间隔小于消费端 10s 兜底窗口，
    // 否则长加载中途提示会被自动收起（旧实现在这里只有一个事件）
    const marks = seen.filter((e) => e.loading).map((e) => e.at)
    expect(marks.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < marks.length; i++) expect(marks[i] - marks[i - 1]).toBeLessThan(10_000)
    expect(seen.at(-1)?.loading).toBe(false)
  })
})
describe('goTo: 落位动画（settle 端口）', () => {
  it('平滑落位：动画结束时才判定，不被动画中途位置误判', { timeout: 30_000 }, async () => {
    const h = makeHarness()
    tailWindow(h, 20, 100)
    const target = h.elementOf('k105')!
    let settleCalls = 0
    // 模拟端口：按设置走「平滑」——scrollTop 分 10 帧逼近目标
    h.ports.settle = (row) => {
      settleCalls += 1
      expect(row).toBe(target)
      const port = h.scrollportElement()
      const goal = Math.max(0, Math.round(port.scrollTop + row.getBoundingClientRect().top - REVEAL_GAP))
      const step = (port.scrollTop + (goal - port.scrollTop) * 0.2)
      port.scrollTop = Math.abs(goal - step) < 2 ? goal : Math.round(step)
      if (port.scrollTop !== goal) setTimeout(() => h.ports.settle?.(row), 40)
    }
    const result = await runJump(h.ports, 'k105', {}, 'smooth', 105, 110, 30_000)
    expect(result).toEqual({ ok: true })
    expect(settleCalls).toBeGreaterThan(0)
    expect(h.viewportTop('k105')).toBe(REVEAL_GAP)
  })

  it('平滑落位未到位时重试，最终仍到达目标', { timeout: 30_000 }, async () => {
    const h = makeHarness()
    tailWindow(h, 20, 100)
    let settleCalls = 0
    // 前两次「平滑」完全不动（模拟被打断），第三次才真正落位
    h.ports.settle = (row) => {
      settleCalls += 1
      if (settleCalls < 3) return
      const port = h.scrollportElement()
      port.scrollTop = Math.round(port.scrollTop + row.getBoundingClientRect().top - REVEAL_GAP)
    }
    const result = await runJump(h.ports, 'k105', {}, 'smooth', 105, 110, 30_000)
    expect(result).toEqual({ ok: true })
    expect(settleCalls).toBeGreaterThanOrEqual(3)
    expect(h.viewportTop('k105')).toBe(REVEAL_GAP)
  })
})
const CLIENT_HEIGHT_FOR_TEST = 800

describe('goTo: 平滑落位不超调', () => {
  it('落位只朝目标单向移动，不出现「先冲过头再回退」', { timeout: 30_000 }, async () => {
    const h = makeHarness()
    tailWindow(h, 40, 100)
    // 阅读位贴底：旧实现会先上移一屏再滚回来（超调）
    h.scrollToBottom()
    const port = h.scrollportElement()
    const seen: number[] = []
    let running = false
    h.ports.settle = (row) => {
      const goal = Math.max(0, Math.round(port.scrollTop + row.getBoundingClientRect().top - REVEAL_GAP))
      seen.push(goal)
      if (running) return
      running = true
      // 逐帧逼近（模拟平滑动画），总位移不超过 |goal - 起点|
      const from = port.scrollTop
      let frame = 0
      const tick = (): void => {
        frame += 1
        const t = Math.min(1, frame / 8)
        port.scrollTop = Math.round(from + (goal - from) * t)
        if (t < 1) setTimeout(tick, 40)
        else running = false
      }
      tick()
    }
    const result = await runJump(h.ports, 'k128', {}, 'smooth', 128, 138, 30_000)
    expect(result).toEqual({ ok: true })
    // 目标行距视口顶 = REVEAL_GAP（文末会贴底，此时至少保证目标可见）
    const top = h.viewportTop('k128')!
    expect(top).toBeLessThanOrEqual(CLIENT_HEIGHT_FOR_TEST)
    expect(top).toBeGreaterThanOrEqual(-40)
    // 关键：settle 请求的目标位置不能低于起始位置（旧实现会先上移一屏 → 目标值跳高）
    if (seen.length > 1) {
      for (let i = 1; i < seen.length; i++) {
        // 允许小幅修正，但不允许「先大幅远离目标再回来」的掉头
        expect(Math.abs(seen[i] - seen[i - 1])).toBeLessThan(200)
      }
    }
  })
})
describe('goTo: 扩窗补偿落地后再落位（不超调）', () => {
  it('官方 prepend 阅读位补偿迟到时，落位等它稳定后才发滚动', { timeout: 30_000 }, async () => {
    const h = makeHarness()
    tailWindow(h, 300, 800)
    const target = 'k128'
    const port = h.scrollportElement()
    // 模拟官方 loadThrough 的 prepend 补偿：约 200ms 后把整窗内容下推 4000px
    const originalLoadThrough = h.ports.loadThrough!
    // 补偿发生在落位动画开始之后（真实时序：稳定等待窗口内），只在第一次扩窗后触发
    let shifted = false
    h.ports.loadThrough = async (seq: number) => {
      await originalLoadThrough(seq)
      if (!shifted) {
        shifted = true
        setTimeout(() => h.shiftDocument(4000), 150)
      }
    }
    // 记录每次 settle 请求时目标行的文档位置：必须已经稳定
    const docsAtSettle: number[] = []
    h.ports.settle = (row) => {
      docsAtSettle.push(Math.round(row.getBoundingClientRect().top + port.scrollTop))
      port.scrollTop = Math.max(0, Math.round(port.scrollTop + row.getBoundingClientRect().top - REVEAL_GAP))
    }
    const result = await runJump(h.ports, target, {}, 'instant', 128, 1000, 120_000)
    expect(result.ok).toBe(true)
    // 落位请求发生时，版面已经稳定：末次请求的文档位置 == 实际文档位置
    const row = h.elementOf(target)!
    const docNow = Math.round(row.getBoundingClientRect().top + port.scrollTop)
    expect(Math.abs(docsAtSettle.at(-1)! - docNow)).toBeLessThan(2)
  })
})
describe('goTo: 长距离落位（自己驱动的平滑，无瞬移、无掉头）', () => {
  it('很远的目的一次性平滑滚过去：轨迹单调、不掉头、不跳', { timeout: 30_000 }, async () => {
    const h = makeHarness()
    tailWindow(h, 300, 100)
    const port = h.scrollportElement()
    h.scrollToBottom()
    const from = port.scrollTop
    const targetKey = 'k110'
    const targetDoc = h.documentTop(targetKey)!
    expect(targetDoc).toBeLessThan(from - 4000)   // 长距离场景

    const samples: number[] = []
    let settled = false
    // 端口自己驱动动画：这里如实模拟（逐帧逼近 + 结束时 resolve）
    h.ports.settle = async (row, mode) => {
      const goal = Math.max(0, Math.round(port.scrollTop + row.getBoundingClientRect().top - REVEAL_GAP))
      if (mode === 'instant') { port.scrollTop = goal; settled = true; return }
      const start = port.scrollTop
      const steps = 12
      for (let i = 1; i <= steps; i++) {
        await new Promise((r) => setTimeout(r, 20))
        port.scrollTop = Math.round(start + (goal - start) * (i / steps))
        samples.push(port.scrollTop)
      }
      port.scrollTop = goal
      settled = true
    }

    const started = Date.now()
    const result = await runJump(h.ports, targetKey, {}, 'smooth', 110, 400, 60_000)
    void started
    expect(result.ok).toBe(true)
    expect(settled).toBe(true)
    expect(h.viewportTop(targetKey)).toBe(REVEAL_GAP)

    // 轨迹单调：全程朝目标方向推进，不允许出现「先冲过头再退回」的掉头
    const goal = Math.max(0, Math.round(targetDoc - REVEAL_GAP))
    const direction = Math.sign(goal - from)
    expect(direction).toBe(-1)
    for (let i = 1; i < samples.length; i++) {
      const step = samples[i] - samples[i - 1]
      expect(Math.sign(step)).not.toBe(-direction)   // 不许反向（掉头即超调）
    }
    // 是"滚动"而不是"瞬移"：必须由多帧组成（单帧内完成 = 瞬移）
    expect(samples.length).toBeGreaterThanOrEqual(8)
  })

  it('近距离落位：直接平滑，无额外位移', { timeout: 30_000 }, async () => {
    const h = makeHarness()
    tailWindow(h, 40, 100)
    const port = h.scrollportElement()
    port.scrollTop = 300
    const modes: string[] = []
    h.ports.settle = (row, mode) => {
      modes.push(mode)
      port.scrollTop = Math.max(0, Math.round(port.scrollTop + row.getBoundingClientRect().top - REVEAL_GAP))
    }
    const result = await runJump(h.ports, 'k109', {}, 'smooth', 109, 120, 30_000)
    expect(result.ok).toBe(true)
    expect(modes[0]).toBe('smooth')
  })

  it('用户设为瞬时：全程瞬时，不做平滑动画', { timeout: 30_000 }, async () => {
    const h = makeHarness()
    tailWindow(h, 300, 100)
    const port = h.scrollportElement()
    h.scrollToBottom()
    const modes: string[] = []
    h.ports.settle = (row, mode) => {
      modes.push(mode)
      port.scrollTop = Math.max(0, Math.round(port.scrollTop + row.getBoundingClientRect().top - REVEAL_GAP))
    }
    await runJump(h.ports, 'k110', {}, 'instant', 110, 400, 60_000)
    expect(modes.every((mode) => mode === 'instant')).toBe(true)
  })
})
describe('goTo: 落位校验的时机与稳定性', () => {
  it('动画结束后立即校验：下一个采样点到来前已经测过一次偏移', { timeout: 30_000 }, async () => {
    const h = makeHarness()
    tailWindow(h, 40, 100)
    const port = h.scrollportElement()
    port.scrollTop = 300

    let settleEnd = 0
    let firstSleepAfterSettle: number | null = null
    let measuredBeforeNextSleep = false
    const target = h.elementOf('k109')!
    const rect = target.getBoundingClientRect.bind(target)
    ;(target as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () => {
      // 动画结束之后、下一次 sleep 之前发生的测量 = "立即校验"
      if (settleEnd > 0 && firstSleepAfterSettle === null) measuredBeforeNextSleep = true
      return rect()
    }
    const originalSleep = h.ports.sleep
    h.ports.sleep = (ms) => {
      if (settleEnd > 0 && firstSleepAfterSettle === null) firstSleepAfterSettle = Date.now()
      return originalSleep(ms)
    }
    h.ports.settle = async (row, mode) => {
      void mode
      await new Promise((r) => setTimeout(r, 120))   // 模拟动画耗时
      port.scrollTop = Math.max(0, Math.round(port.scrollTop + row.getBoundingClientRect().top - REVEAL_GAP))
      settleEnd = Date.now()
    }

    const promise = goTo(h.ports, 'k109', {}, 'smooth', 109, 120)
    for (let i = 0; i < 200; i++) { await vi.advanceTimersByTimeAsync(50); await Promise.resolve() }
    await promise

    expect(settleEnd).toBeGreaterThan(0)
    expect(h.viewportTop('k109')).toBe(REVEAL_GAP)
    // 旧行为是"先固定 sleep 一轮再测" → 这里会是 false
    expect(measuredBeforeNextSleep).toBe(true)
  })

  it('落位后被身后的补偿挪走 → 校验发现并要求重试（连续两次对上才算稳）', { timeout: 30_000 }, async () => {
    const h = makeHarness()
    tailWindow(h, 40, 100)
    const port = h.scrollportElement()
    port.scrollTop = 300
    let settleCalls = 0
    h.ports.settle = (row, mode) => {
      void mode
      settleCalls += 1
      port.scrollTop = Math.max(0, Math.round(port.scrollTop + row.getBoundingClientRect().top - REVEAL_GAP))
      if (settleCalls === 1) {
        // 第一次落位后 100ms，官方补偿把位置挪走 500px（模拟实测里的迟到补偿）
        setTimeout(() => { port.scrollTop += 500 }, 100)
      }
    }
    const result = await runJump(h.ports, 'k109', {}, 'smooth', 109, 120, 30_000)
    expect(result.ok).toBe(true)
    // 必须重试并最终对齐，而不是被"暂时对齐"骗过
    expect(settleCalls).toBeGreaterThanOrEqual(2)
    expect(h.viewportTop('k109')).toBe(REVEAL_GAP)
  })
})
