/**
 * Browser-half entry for the dsh-mega-chat-nav plugin.
 *
 * Registers one surface into the frame-wide floating layer (`shell.overlay`):
 * a vertical strip on the LEFT edge of the conversation column listing every
 * user question in the current session as a small button, one dot per turn.
 * Clicking a button scrolls the chat to that turn's first question.
 *
 * The dots are driven by the host-folded `msgNavMessages` session projection
 * (registered by the plugin's host half): the projection registry folds the
 * WHOLE event log without touching the chat's paged render window, the
 * projection cache persists it, and the standard carriers (history tail-page
 * baseline + session/projection push frames) keep it live. Live-window
 * questions not yet recorded by the projection are merged on top so a
 * just-sent question appears immediately.
 *
 * Failure policy: nothing here throws at apply time — an external plugin must
 * never take the GUI down.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the slots service Context merge (ctx.slots) — 0.1.2 线由拆分后的
// dsh-client-ui-renderer 提供（原 dsh-client-runtime 已停发）。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings shell's SlotMap merge ('settings.plugins.tab')
// and the ctx.settingsScope Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsScopeBinder } from '@deepseek-ai/dsh-client-ui-settings/client'

/** 0.1.2 线 client 上下文 = cordis Context（runtime 拆分后不再有 ClientContext 别名）。 */
type ClientContext = Context
import { RailDispatch } from './components/RailDispatch.tsx'
import { SettingsPage } from './components/settings/SettingsPage.tsx'
import { StandaloneSettings } from './components/settings/StandaloneSettings.tsx'
import { NavSettingsController } from './settings.ts'
import type { NavInjected, ObservableFace } from './components/shared/types.ts'
import { en, zh } from './locales.ts'
import { goTo, REVEAL_GAP, type JumpFailureCode, type JumpPorts, type JumpSnapshot } from './jump.ts'
import { getActiveSession, SessionBridge } from './session-bridge.tsx'

/** Locale namespace this plugin owns. */
const NS = 'mega-chat-nav'

/** Services required by this plugin.
 *  - slots / locale：官方服务（0.1.2 线 slots 由 ui-renderer 提供）；
 *  - sessions：api-session-controller 提供（binding/projections 契约不变）；
 *  - uiConversation：ui-conversation 提供——活窗口对话行快照源（chat target）。
 *    cordis Service 属性访问须在 inject 声明，否则抛 "cannot get property without inject"。 */
export const inject = ['slots', 'locale', 'sessions', 'uiConversation']

/** 会话服务最小面（rc 类型面不全，此处宽松化）。
 *  0.1.2 线：ctx.sessions 由 @deepseek-ai/dsh-api-session-controller 提供，
 *  binding()/list/projections 契约不变（hostFace().sessions 才是被移除的那个）。 */
interface SessionsFace {
  binding(sessionId: string): { session: SessionFace } | undefined
}

interface SessionSnapshotLike {
  openState?: string
  hasMore?: boolean
  loadingOlder?: boolean
  /** 新会话空态（尚无首轮对话）：导航条据此不显示；两版字段同名 */
  blank?: boolean
  chat?: { nodes?: { values(): Iterable<{ key?: string; anchorSeq?: number; visibility?: string; kind?: string; data?: unknown }> } }
}

interface SessionFace {
  getSnapshot(): SessionSnapshotLike
  loadOlder(): Promise<void>
  /** 官方跳转加载器：单次调用内连续扩窗（200 条/页）直到窗口覆盖 seq；
   *  重复调用会下压共享目标并返回在飞 promise（见 ISession.loadThrough 契约）。 */
  loadThrough(seq: number): Promise<void>
  subscribe(cb: () => void): () => void
  projections: { faceOf(key: string): { getSnapshot(): unknown; subscribe(cb: () => void): () => void } }
}

function sessionsOf(ctx: ClientContext): SessionsFace {
  return ctx.sessions as unknown as SessionsFace
}

/** 会话行最小面（结构型，非 SDK 绑定） */
interface ChatRowLike {
  key: string
  anchorSeq: number
  /** 锚点序号缺失时的兜底字段（pre-0.1.2 legacy 记录只有 seq） */
  seq?: number
  visibility?: string
  kind?: string
  /** 事件在会话层级中的位置（回合/步骤归属判定用，见 turnOf） */
  location?: unknown
  data?: unknown
}

interface RowPayload {
  content?: readonly { type?: string; text?: string }[]
  seq?: number
  time?: number
}

/** 提问行 kind */
const QUESTION_KINDS = ['user', 'steering']

/** 消息首文本块；缺省空串 */
function firstTextBlock(content: readonly { type?: string; text?: string }[] | undefined): string {
  const block = content?.find((part) => typeof part?.text === 'string')
  return block?.text ?? ''
}

/**
 * 从节点窗口提取提问行（kind 过滤 + 无回合归属过滤 + 首文本 + 按 anchorSeq 排序）。
 *
 * 「无回合归属」= 该行明确落在 turn 0（回合号只会被 turn/start 推进）：这类提问
 * 之后没有任何回合真正开始（发出即被打断之类），轨道不该为它建节点——口径对齐官方
 * turnOutline。取不到回合证据时（turnOf 返回 null）**保守保留**，避免新版字段形态
 * 变化导致整批提问从轨道消失。
 */
function extractQuestionRows(nodes: Iterable<ChatRowLike>): { key: string; anchorSeq: number; seq: number; time: number; text: string }[] {
  return [...nodes]
    .filter((node) => QUESTION_KINDS.includes(node.kind ?? ''))
    .filter((node) => turnOf(node) !== 0)
    .map((node) => {
      const payload = (typeof node.data === 'object' && node.data !== null ? node.data : {}) as RowPayload
      return {
        key: node.key,
        anchorSeq: node.anchorSeq,
        seq: payload.seq ?? -1,
        time: payload.time ?? 0,
        text: firstTextBlock(payload.content),
      }
    })
    .sort((a, b) => a.anchorSeq - b.anchorSeq)
}


/** Single-instance guard: a duplicated client injection must not mount twice. */
declare global {
  // eslint-disable-next-line no-var
  var __dshMegaChatNavApplied: boolean | undefined
}

function claimApply(): boolean {
  if (globalThis.__dshMegaChatNavApplied === true) return false
  globalThis.__dshMegaChatNavApplied = true
  return true
}

function releaseApply(): void {
  globalThis.__dshMegaChatNavApplied = undefined
}

/** 每次跳转的世代号（按会话）：新跳转令上一次的循环在下一次检查时自我中止，
 *  避免「连点两个节点 → 两个循环同时滚动 + 同时扩窗」的互相打架。 */
const jumpEpochs = new Map<string, number>()

/** 对话滚动容器（虚拟渲染与官方跟随逻辑的宿主） */
function scrollportOf(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-conversation-scroll]')
}

/** 行是否落在滚动容器视口内 */
function inViewportOf(port: HTMLElement | null, row: HTMLElement): boolean {
  if (port === null) return true
  const rect = row.getBoundingClientRect()
  const view = port.getBoundingClientRect()
  return rect.bottom > view.top && rect.top < view.bottom
}

/** 目标行顶部与视口顶的间距（正值 = 目标在视口顶之下） */
function rowOffset(port: HTMLElement, row: HTMLElement): number {
  return row.getBoundingClientRect().top - port.getBoundingClientRect().top
}

/** 平滑落位动画参数：时长下限 / 上限（毫秒）与速度（px/ms） */
const SMOOTH_MIN_MS = 220
const SMOOTH_MAX_MS = 1200
const SMOOTH_PX_PER_MS = 7

/**
 * 自己驱动的平滑滚动：逐帧写**绝对**位置，整体单调，直到落到目标。
 *
 * 为什么不用原生 `scrollTo({behavior:'smooth'})`：
 *  - 长距离时原生动画时长有上限，上万像素会在几百毫秒里"糊"过去，观感接近瞬移
 *    （实测 12650px 的跳转就有这个抱怨）；
 *  - 中途官方会按阅读锚点补偿 scrollTop（实测日志里 44297 → 43804 → 31154），
 *    原生动画与它互相打断，于是出现「先冲过头再退回」。
 * 逐帧绝对插值天然免疫这两点：补偿造成的偏差在下一帧就被覆盖，轨迹不会掉头。
 *
 * @param port - 滚动容器
 * @param goal - 目标绝对 scrollTop
 * @returns 动画结束（或被取消）时 resolve
 */
function animateScrollTop(port: HTMLElement, goal: number): Promise<void> {
  const from = port.scrollTop
  const distance = goal - from
  const total = Math.abs(distance)
  if (total < 2) {
    port.scrollTop = goal
    return Promise.resolve()
  }
  const duration = Math.min(SMOOTH_MAX_MS, Math.max(SMOOTH_MIN_MS, Math.round(total / SMOOTH_PX_PER_MS)))
  const startAt = Date.now()
  const reduce = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduce) {
    port.scrollTop = goal
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    const frame = (): void => {
      const t = Math.min(1, (Date.now() - startAt) / duration)
      // easeInOutCubic：起步与收尾都软，中段快
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      port.scrollTop = Math.round(from + distance * eased)
      if (t >= 1) {
        port.scrollTop = goal
        resolve()
        return
      }
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
}

/** 气泡 → 该气泡在飞的闪烁定时器（重复跳转同一节点时先撤销上一轮） */
const flashTimers = new WeakMap<HTMLElement, number[]>()
/** 气泡 → 闪烁前的真实原色。必须在清定时器/改色**之前**记录：
 *  否则闪烁中途重复跳同一节点会把主题色误当成原色，气泡永久染色。 */
const flashOriginals = new WeakMap<HTMLElement, string>()

/** 跳转确认高亮：目标气泡进入视口后闪两轮主题色 */
function flashTarget(row: HTMLElement): void {
  const bubble = row.querySelector<HTMLElement>('[class*="bubble"]')
    ?? row.querySelector<HTMLElement>('[class*="messageBody"], [class*="bubbleBody"]')
  if (bubble === null) return
  const original = flashOriginals.get(bubble) ?? bubble.style.background
  flashOriginals.set(bubble, original)
  for (const timer of flashTimers.get(bubble) ?? []) window.clearTimeout(timer)
  const themeBg = 'color-mix(in srgb, var(--dsw-alias-brand-primary) 38%, transparent)'
  bubble.style.transition = 'background 350ms ease'
  const paint = (on: boolean): void => { bubble.style.background = on ? themeBg : original }
  const timers: number[] = []
  flashTimers.set(bubble, timers)
  // 轮询等待气泡可见（进入滚动容器视口）；1.2s 兜底后也执行
  let tries = 0
  const check = (): void => {
    if (inViewportOf(scrollportOf(), bubble) || tries > 12) {
      paint(true)
      timers.push(window.setTimeout(() => paint(false), 400))
      timers.push(window.setTimeout(() => paint(true), 800))
      timers.push(window.setTimeout(() => {
        paint(false)
        bubble.style.transition = ''
        flashTimers.delete(bubble)
        flashOriginals.delete(bubble)
      }, 1200))
      return
    }
    tries += 1
    timers.push(window.setTimeout(check, 100))
  }
  check()
}

/**
 * 在已渲染的聊天行中按锚点查找目标行。
 * - 只认**可见**行（对齐官方 anchorElement 的 `:not([hidden])`）：隐藏行的矩形退化，
 *   拿它落位会写出一串垃圾 scrollTop；
 * - 先精确匹配 data-chat-anchor-key；未命中再按「包含」兜底（key 为完整锚点串）；
 * - seq: 前缀的兜底 key 取最后一个匹配（防误命中前一行）。
 */
function locateRow(key: string): HTMLElement | null {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-chat-anchor-key]:not([hidden])'))
  for (const row of rows) {
    if (row.dataset.chatAnchorKey === key) return row
  }
  for (const row of rows) {
    const candidate = row.dataset.chatAnchorKey
    if (candidate !== undefined && candidate.includes(key)) return row
  }
  if (key.startsWith('seq:')) {
    const seq = key.slice(4)
    let found: HTMLElement | null = null
    for (const row of rows) {
      const candidate = row.dataset.chatAnchorKey
      if (candidate !== undefined && candidate.includes(seq)) found = row
    }
    if (found !== null) return found
  }
  return null
}

/** Map the session snapshot to the jump-loop port surface. */
function jumpPortsFor(ctx: ClientContext, sessionId: string): JumpPorts {
  const sessions = sessionsOf(ctx)
  const epoch = (jumpEpochs.get(sessionId) ?? 0) + 1
  jumpEpochs.set(sessionId, epoch)
  /** 本次跳转已闪烁过的行（定位步进不重复触发高亮） */
  const flashed = new WeakSet<HTMLElement>()
  return {
    snap: () => {
      const binding = sessions.binding(sessionId)
      const snap = binding?.session.getSnapshot()
      if (snap === undefined) return undefined
      return {
        openState: snap.openState ?? '',
        hasMore: snap.hasMore ?? false,
        loadingOlder: snap.loadingOlder ?? false,
        rows: chatRowsOf(ctx, sessionId) as unknown as JumpSnapshot['rows'],
      }
    },
    loadMore: async () => {
      const binding = sessions.binding(sessionId)
      if (binding === undefined) throw new Error('session unavailable')
      await binding.session.loadOlder()
    },
    // 官方跳转加载器：200 条/页 + 单 promise 内推进到目标 seq。
    // 逐页 loadOlder（50 条/页）在长会话里要翻 4 倍页数，是「加载很久仍超时」的主因。
    // 旧快照（0.1.2 线及更早）没有该 API：这里显式缺席，由编排层降级回 loadOlder 通道
    // （与 0.1.2 分支共用本文件时也不会因属性缺失抛 TypeError）。
    loadThrough: typeof (sessions.binding(sessionId)?.session as { loadThrough?: unknown } | undefined)?.loadThrough === 'function'
      ? async (seq: number) => {
        const binding = sessions.binding(sessionId)
        if (binding === undefined) throw new Error('session unavailable')
        await binding.session.loadThrough(seq)
      }
      : undefined,
    cancelled: () => jumpEpochs.get(sessionId) !== epoch,
    // active 判定：对话流存在 **且** 当前视图仍是发起跳转时的那个会话——
    // 会话切换后旧跳转不得再驱动新会话的 DOM
    active: () => document.querySelector('[data-chat-flow]') !== null
      && (sessions.binding(sessionId) !== undefined),
    locate: (key: string) => locateRow(key),
    inView: (row) => inViewportOf(scrollportOf(), row),
    /**
     * 滚动落位（同步原语，最终落位由编排层的 settleOnRow 校验重试）。
     *
     * 一律走「瞬时赋值 scrollTop」：官方 ChatView 的贴底跟随判定是「距底 25px 内」，
     * 旧的 2px 微调根本脱离不了该区间，随后的 prepend 补偿就把滚动拉了回去
     * （现象：向上滚了一点就停住、到不了目标）。瞬时大跨度位移一次性脱离该区间，
     * 同时不会被 smooth 动画中途打断（smooth 期间 scrollTop 停在起点，
     * 既会误判「已到边界」，也会让校验读到过期位置）。
     *
     * locate 只做定位，不触发确认高亮；reveal 触发一次确认高亮（每行每次跳转一次）。
     */
    /**
     * 最终落位 + 确认高亮。
     *
     * 平滑模式用自己的逐帧动画（`animateScrollTop`）而不是原生
     * `scrollTo({behavior:'smooth'})`：长距离时后者时长封顶、几百毫秒糊过上万像素，
     * 且会被官方的阅读位补偿中途打断（表现为"先冲过头再退回"）。逐帧写绝对插值则
     * 整体单调，补偿的偏差下一帧即被覆盖。返回的 promise 在动画结束时 resolve，
     * 编排层据此立即校验。
     */
    settle: (row, mode) => {
      const port = scrollportOf()
      const behavior = mode === 'smooth' ? 'smooth' : 'instant'
      if (port === null) {
        row.scrollIntoView({ behavior: behavior === 'smooth' ? 'smooth' : 'instant', block: 'start' })
        return
      }
      const top = Math.max(0, Math.round(port.scrollTop + rowOffset(port, row) - REVEAL_GAP))
      // 落位即触发一次确认高亮（每行每次跳转一次）
      if (!flashed.has(row)) {
        flashed.add(row)
        flashTarget(row)
      }
      if (behavior === 'instant') {
        // 直接写 scrollTop 即为瞬时（容器样式产物里没有 scroll-behavior:smooth）
        port.scrollTop = top
        return
      }
      return animateScrollTop(port, top)
    },
    scrollport: () => scrollportOf() as HTMLElement,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
    /** 让出一帧：一次扩窗会新增数百行，实时轮询期间交给浏览器绘制 */
    pause: () => new Promise((resolve) => {
      if (typeof requestAnimationFrame !== 'function') { resolve(); return }
      requestAnimationFrame(() => resolve())
    }),
  }
}

/**
 * 0.1.2 线对话 chat 快照最小面（结构型，非 SDK 绑定）。
 * 0.1.1 的 SessionSnapshot.chat（聊天行）在 0.1.2 线被移除：会话快照不再携带
 * 可见行数据，改由 ui-conversation 的 per-session chat target 快照提供——
 * ctx.uiConversation.binding(sessionId).target('chat')。
 * 缺包 / 未就绪 / 结构不符时一律优雅降级为空，不影响投影主路径。
 */
/** 0.1.2 线聊天行源的最小结构面（view node / legacy record 两者字段并集） */
interface ChatRowSourceLike {
  key?: unknown
  anchorSeq?: unknown
  visibility?: unknown
  kind?: unknown
  seq?: number
  location?: unknown
  data?: unknown
}

interface ChatSnapshotLike {
  /** 0.1.2 线 chat target 快照（ui-chat ChatSnapshot 结构面）：nodes 为逐 key 行存储 */
  nodes?: { values(): readonly unknown[] }
  /** 兼容旧字段的 legacy 行数组（ConversationNode 记录；无 key，用 seq 兜底） */
  legacy?: { nodes?: readonly unknown[] }
  /** 已加载回合导航索引（官方 turn rail 用；窗口外回合 → unloaded） */
  navigation?: { items(): readonly { turn: number }[] }
}

interface UiConversationLike {
  binding(sessionId: string): {
    target(name: string): {
      getSnapshot(): ChatSnapshotLike | undefined
      subscribe(cb: () => void): () => void
    }
  } | undefined
}

/** 0.1.2 线 chat target 最小面；结构缺失 / 抛错时返回 undefined（降级投影主路径）。
 *  uiConversation 已在 inject 声明（cordis 服务属性访问需 inject；官方 ui-chat 同款）。 */
function chatFaceOf(ctx: ClientContext, sessionId: string): {
  getSnapshot(): ChatSnapshotLike | undefined
  subscribe(cb: () => void): () => void
} | undefined {
  const ui = (ctx as unknown as { uiConversation?: UiConversationLike }).uiConversation
  if (ui === undefined) return undefined
  try {
    return ui.binding(sessionId)?.target('chat')
  } catch {
    return undefined
  }
}

/**
 * 当前会话窗口内的**全部**聊天行（不做 kind 过滤）。
 * 0.1.2 线走 ui-conversation chat target；0.1.1 线回退 session 快照 chat.nodes。
 */
function allChatRows(ctx: ClientContext, sessionId: string): ChatRowLike[] {
  const chat = chatFaceOf(ctx, sessionId)
  if (chat !== undefined) {
    try {
      const snap = chat.getSnapshot()
      if (snap !== undefined) {
        // 0.1.2 线 chat 快照的 nodes（ChatNodeStore）与 legacy.nodes 是同一批
        // 节点的两个视图——只取一个源，避免每行重复（view node 的 key 与投影
        // anchorKey 一致可被 buildMarkers 去重；legacy 的 seq 兜底 key 去重不了）。
        const viewNodes = (snap.nodes?.values?.() ?? []) as readonly ChatRowSourceLike[]
        const sourceNodes = viewNodes.length > 0
          ? viewNodes
          : ((snap.legacy?.nodes ?? []) as readonly ChatRowSourceLike[])
        const rows: ChatRowLike[] = []
        for (const node of sourceNodes) {
          rows.push({
            key: typeof node.key === 'string' ? node.key : 'seq:' + (node.seq ?? 0),
            anchorSeq: typeof node.anchorSeq === 'number' ? node.anchorSeq : (node.seq ?? 0),
            seq: typeof node.seq === 'number' ? node.seq : undefined,
            visibility: typeof node.visibility === 'string' ? node.visibility : undefined,
            kind: typeof node.kind === 'string' ? node.kind : undefined,
            // 必须带上 location：回合归属判定依赖它（漏搬会让「已加载回合」恒为空集）
            location: node.location,
            // view node：data 为 UserMessageNode 记录；legacy node：节点自身即记录
            data: (typeof node.data === 'object' && node.data !== null ? node.data : node) as RowPayload,
          })
        }
        return rows
      }
    } catch {
      /* 降级 */
    }
  }
  const snap = sessionsOf(ctx).binding(sessionId)?.session.getSnapshot()
  if (snap === undefined || snap.chat?.nodes === undefined) return []
  return [...(snap.chat.nodes.values() as unknown as Iterable<ChatRowLike>)]
}

/**
 * 行所属回合号。
 * 主路径与官方 locationCoordinates 同构：location.turn.turn；
 * 兜底用节点载荷自带的 turn（助手/工具行都带），避免字段形态差异导致全部丢失。
 */
function turnOf(node: { location?: unknown; data?: unknown }): number | null {
  const location = node.location
  if (typeof location === 'object' && location !== null) {
    const nested = (location as { turn?: { turn?: unknown } }).turn
    if (typeof nested?.turn === 'number') return nested.turn
  }
  const payload = node.data
  if (typeof payload === 'object' && payload !== null) {
    const turn = (payload as { turn?: unknown }).turn
    if (typeof turn === 'number') return turn
  }
  return null
}

/** 判定输入行（结构型；标记来自聊天视图/旧快照的并集） */
export interface LoadedTurnRow {
  visibility?: string
  kind?: string
  location?: unknown
  data?: unknown
}

/**
 * 已加载回合判定（纯函数，便于单测）。
 *
 * 语义：导航点代表**该轮的用户提问**，所以「已加载」= 该提问的气泡在当前窗口里
 * 真实存在，即该回合有**可见的提问行**（kind === 'user'）。
 *
 * 为什么不用官方那条「该回合存在可见节点」：官方判据允许「助手/工具行在窗口内、
 * 用户气泡还在窗口外」的**半截回合**算已加载；那种回合的点画成短横线，用户点下去
 * 却找不到自己的提问。
 *
 * @param indexed - 官方索引给出的回合号（navigation.items()）
 * @param rows - 当前窗口里的聊天行
 * @returns 已加载回合集合
 *
 * 回退纪律（两次线上回归换来的）：
 *  - 若窗口里**任何**提问行都取不到（字段口径不符、或该会话确实没有用户消息记录），
 *    保持索引原样——绝不退化成「所有轮次都是未加载」；
 *  - 若索引本身为空（旧快照没有 navigation），则按可见提问行直接重建，
 *    此时没有可信的枚举口径可用。
 */
export function loadedTurnsOf(indexed: Iterable<number>, rows: Iterable<LoadedTurnRow>): Set<number> {
  const turns = new Set(indexed)
  const visibleQuestions = new Set<number>()
  let questionsSeen = 0
  for (const row of rows) {
    if (row.kind !== 'user' || row.visibility === 'hidden') continue
    const turn = turnOf(row)
    if (turn === null) continue
    questionsSeen += 1
    visibleQuestions.add(turn)
  }
  if (questionsSeen === 0) return turns          // 无提问行证据：保持索引原样
  if (turns.size === 0) return visibleQuestions  // 无索引可依：按提问行重建
  return visibleQuestions
}

/** 窗口内的提问行（提问 kind 过滤；标记与跳转锚点用） */
function chatRowsOf(ctx: ClientContext, sessionId: string): ChatRowLike[] {
  return allChatRows(ctx, sessionId).filter((row) => QUESTION_KINDS.includes(row.kind ?? ''))
}

/**
 * The session's `msgNavMessages` projection face (getSnapshot + subscribe).
 * Undefined when the session is not bound or the host unit is not registered
 * (e.g. a headless composition) — the strip then shows live-window dots only.
 */
function navProjectionOf(ctx: ClientContext, sessionId: string): ObservableFace | undefined {
  const face = sessionsOf(ctx).binding(sessionId)?.session.projections.faceOf('msgNavMessages')
  if (face === undefined) return undefined
  return {
    getSnapshot: () => face.getSnapshot(),
    subscribe: (listener) => face.subscribe(listener),
  }
}

function createInject(ctx: ClientContext, settings: NavSettingsController): NavInjected {
  const sessions = sessionsOf(ctx)
  return {
    readQuestions: (sessionId) => extractQuestionRows(chatRowsOf(ctx, sessionId)),
    subscribeContent: (sessionId, cb) => {
      // 会话生命周期变更 + 0.1.2 线对话行变更（chat target）双订阅；
      // 任一变化都触发内容重读（投影主路径 + 活窗口兜底）
      const binding = sessions.binding(sessionId)
      const chat = chatFaceOf(ctx, sessionId)
      const subs: (() => void)[] = []
      if (binding !== undefined) subs.push(binding.session.subscribe(cb))
      if (chat !== undefined) subs.push(chat.subscribe(cb))
      if (subs.length === 0) return () => {}
      return () => { for (const off of subs) off() }
    },
    questionProjection: (sessionId) => navProjectionOf(ctx, sessionId),
    activeSession: { read: getActiveSession },
    // 新会话空态判定：读会话快照的 blank（rc.2 与 alpha.2 字段同名）。
    // 取代旧的列表快照 summary.blank——官方已把视图选择移出列表状态。
    // 快照缺席（会话未打开 / 未就绪）按「非空」处理：此时桥接尚未上报，
    // 导航条本就不可见，不应把它误判成空态
    readBlank: (sessionId) => sessionsOf(ctx).binding(sessionId)?.session.getSnapshot()?.blank === true,
    // blank 的订阅：会话快照变化即回调。新会话发出首轮后必须由它把导航条唤出——
    // 只在渲染时读一次会漏掉这次变化（表现为「新会话不显示，重进会话才出现」）
    subscribeBlank: (sessionId, cb) => sessionsOf(ctx).binding(sessionId)?.session.subscribe(cb) ?? (() => {}),
    // 已加载回合：判定规则见 loadedTurnsOf（该回合的提问行是否在当前窗口可见）

    navLoadedTurns: (sessionId) => {
      const chat = chatFaceOf(ctx, sessionId)
      const items = chat?.getSnapshot?.()?.navigation?.items?.() ?? []
      return loadedTurnsOf(items.map((item) => item.turn), allChatRows(ctx, sessionId))
    },
    subscribeNavLoadedTurns: (sessionId, cb) => {
      const chat = chatFaceOf(ctx, sessionId)
      if (chat === undefined) return () => {}
      return chat.subscribe(cb)
    },
    jump: (sessionId, key, seq, currentSeq) => {
      // 末次落位的动画方式在跳转**发起时**固定：跳转途中改设置不影响在飞的跳转
      const mode = settings.getSnapshot().scrollBehavior
      const ports = jumpPortsFor(ctx, sessionId)
      ports.report = (code: JumpFailureCode) => {
        // Surface the failure through the component via a DOM event the
        // strip listens for; simplest reliable cross-boundary channel here.
        window.dispatchEvent(new CustomEvent('mega-chat-nav:jump-failed', { detail: code }))
      }
      ports.onLoading = (loading: boolean) => {
        window.dispatchEvent(new CustomEvent('mega-chat-nav:jump-loading', { detail: { loading } }))
      }
      // 端口在会话切换等边界会抛（'session unavailable'）：转成与内部失败一致的
      // 事件，避免静默消失（用户至少能看到失败提示）
      void goTo(ports, key, {}, mode, seq, currentSeq)
        .catch(() => {
          ports.report?.('VIEW_INACTIVE')
        })
    },
    style: () => settings.getSnapshot().style,
    setStyle: (style) => settings.setStyle(style),
    align: () => settings.getSnapshot().align,
    subscribeSettings: (cb) => settings.subscribe(cb),
    setAlign: (align) => settings.setAlign(align),
    bandHeight: () => settings.getSnapshot().bandHeight,
    setBandHeight: (band) => settings.setBandHeight(band),
    scrollBehavior: () => settings.getSnapshot().scrollBehavior,
    setScrollMode: (mode) => settings.setScrollMode(mode),
    showCount: () => settings.getSnapshot().showCount,
    setShowCount: (mode) => settings.setShowCount(mode),
    showSearch: () => settings.getSnapshot().showSearch,
    setShowSearch: (mode) => settings.setShowSearch(mode),
    showQuickSettings: () => settings.getSnapshot().showQuickSettings,
    setShowQuickSettings: (mode) => settings.setShowQuickSettings(mode),
    showFavorites: () => settings.getSnapshot().showFavorites,
    setShowFavorites: (mode) => settings.setShowFavorites(mode),
    showPaging: () => settings.getSnapshot().showPaging,
    setShowPaging: (mode) => settings.setShowPaging(mode),
    searchScopes: () => settings.getSnapshot().searchScopes,
    setSearchScopes: (scopes) => settings.setSearchScopes(scopes),
    railOffset: () => settings.getSnapshot().railOffset,
    setRailOffset: (offset) => settings.setRailOffset(offset),
    cardCount: () => settings.getSnapshot().cardCount,
    setCardCount: (count) => settings.setCardCount(count),
    cardItems: () => settings.getSnapshot().cardItems,
    setCardItems: (items) => settings.setCardItems(items),
    markTone: () => settings.getSnapshot().markTone,
    setMarkTone: (tone) => settings.setMarkTone(tone),
  }
}

/**
 * Register the mega-chat-nav surface.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  if (!claimApply()) return
  ctx.effect(() => releaseApply, 'mega-chat-nav: apply claim')

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'mega-chat-nav: dictionaries')
  const t = ctx.locale.bind(NS)

  const settings = new NavSettingsController()
  const injected = createInject(ctx, settings)

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'mega-chat-nav',
    order: 900,
    locale: NS,
    inject: () => ({ injected }),
  }, RailDispatch))

  // 会话作用域桥接：把「当前会话」接到根作用域的浮层导航条。
  // 0.1.6-alpha.2 起 SessionListState 不再带 current（官方把视图选择移出会话服务），
  // 根作用域无法再自行判定活动会话；这里按官方 TurnNavigator 的思路——在会话作用域
  // 挂一个无渲染条目上报 sessionId。conversation.input.overlay 是 list + session 作用域，
  // 三版（0.1.5-rc.2 / 0.1.6-alpha.1 / alpha.2）都存在且都被渲染，返回 null 不占位。
  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay',
    id: 'mega-chat-nav:session-bridge',
    order: 900,
    inject: () => ({ activeSession: { read: getActiveSession } }),
  }, SessionBridge))

  // mega-settings 成员契约：元信息 seat + 页面 seat（宿主缺席 → 静默等待 → 自足）
  ctx.slots.inject('mega.settings.member', () => ctx.slots.register({
    name: 'mega.settings.member',
    id: 'mega-chat-nav',
    order: 10,
    label: () => t('label'),
    inject: () => ({ description: () => t('desc'), version: PKG_VERSION }),
  }, ListRow))

  ctx.slots.inject('mega.settings.member.page', () => ctx.slots.register({
    name: 'mega.settings.member.page',
    key: 'mega-chat-nav',
    order: 10,
    label: () => t('label'),
    locale: NS,
    inject: () => ({ injected }),
  }, SettingsPage))

  // 插件页配置入口：仅当未被 mega-settings 收纳时注册（收纳后注销，避免重复入口）。
  // mega-settings 可能晚于本插件加载——用 inject 等待官方 settings.plugins.tab 声明（0.1.2 线
  // 声明时机不保证早于本插件），并订阅 member 条目，宿主出现即注销。
  {
    let tabDispose: (() => void) | null = null
    const ensurePluginsTab = (): void => {
      const hosted = (ctx.slots.entries?.('mega.settings.member')?.length ?? 0) > 0
      if (hosted) {
        tabDispose?.()
        tabDispose = null
      } else if (tabDispose === null) {
        // 0.1.2 线：settings.plugins.tab 由官方 ui-settings-plugins 在自身 apply 时声明，
        // 可能晚于本插件——改用 inject 等待声明（声明存在则同步注册），
        // 避免对未声明槽位直接 register 触发 load-time 校验失败。
        tabDispose = ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
          name: 'settings.plugins.tab',
          id: 'mega-chat-nav',
          order: 100,
          label: () => t('label'),
          locale: NS,
          inject: () => ({ injected, slots: ctx.slots }),
        }, StandaloneSettings))
      }
    }
    ensurePluginsTab()
    const offMember = ctx.slots.subscribe?.('mega.settings.member', ensurePluginsTab)
    ctx.effect(() => () => {
      tabDispose?.()
      tabDispose = null
      offMember?.()
    }, 'mega-chat-nav: plugins tab ledger')
  }

  // 设置控制器挂载：settingsScope 服务就绪后绑定 scope（未就绪时配置读写走默认值降级）
  ctx.inject(['settingsScope'], (scopeCtx) => {
    settings.attach(scopeCtx.get('settingsScope') as SettingsScopeBinder)
  })
}

/** 成员列表行占位（元信息 seat 用；宿主自绘列表时不渲染） */
function ListRow(): null {
  return null
}

/** 构建注入的包版本常量（见 scripts/build-client.mjs） */
declare const PKG_VERSION: string
