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
import { goTo, type JumpFailureCode, type JumpPorts, type JumpSnapshot } from './jump.ts'

/** Locale namespace this plugin owns. */
const NS = 'mega-chat-nav'

/** Services required by this plugin.
 *  - slots / locale：官方服务（0.1.2 线 slots 由 ui-renderer 提供）；
 *  - sessions：api-session-controller 提供（binding/list/projections 契约不变）；
 *  - uiConversation：ui-conversation 提供——活窗口对话行快照源（chat target）。
 *    cordis Service 属性访问须在 inject 声明，否则抛 "cannot get property without inject"。 */
export const inject = ['slots', 'locale', 'sessions', 'uiConversation']

/** 会话服务最小面（rc 类型面不全，此处宽松化）。
 *  0.1.2 线：ctx.sessions 由 @deepseek-ai/dsh-api-session-controller 提供，
 *  binding()/list/projections 契约不变（hostFace().sessions 才是被移除的那个）。 */
interface SessionsFace {
  binding(sessionId: string): { session: SessionFace } | undefined
  list: { subscribe(cb: () => void): () => void }
}

interface SessionSnapshotLike {
  openState?: string
  hasMore?: boolean
  loadingOlder?: boolean
  chat?: { nodes?: { values(): Iterable<{ key?: string; anchorSeq?: number; visibility?: string; kind?: string; data?: unknown }> } }
}

interface SessionFace {
  getSnapshot(): SessionSnapshotLike
  loadOlder(): Promise<void>
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
  visibility?: string
  kind?: string
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

/** 从节点窗口提取提问行（kind 过滤 + 首文本 + 按 anchorSeq 排序） */
function extractQuestionRows(nodes: Iterable<ChatRowLike>): { key: string; anchorSeq: number; seq: number; time: number; text: string }[] {
  return [...nodes]
    .filter((node) => QUESTION_KINDS.includes(node.kind ?? ''))
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

/** Map the session snapshot to the jump-loop port surface. */
function jumpPortsFor(ctx: ClientContext, sessionId: string): JumpPorts {
  const sessions = sessionsOf(ctx)
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
    active: () => document.querySelector('[data-chat-flow]') !== null,
    locate: (key: string) => {
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-chat-anchor-key]'))
      for (const row of rows) {
        if (row.dataset.chatAnchorKey === key) return row
      }
      // 包含兜底（key 为完整锚点串，唯一命中）
      for (const row of rows) {
        const k = row.dataset.chatAnchorKey
        if (k !== undefined && k.includes(key)) return row
      }
      // seq 兜底：取最后一个匹配（防误命中前一行）
      if (key.startsWith('seq:')) {
        const n = key.slice(4)
        let found: HTMLElement | null = null
        for (const row of rows) {
          const k = row.dataset.chatAnchorKey
          if (k !== undefined && k.includes(n)) found = row
        }
        if (found !== null) return found
      }
      return null
    },
    reveal: (row, mode) => {
      // 目标行顶部与视口顶留 12px 间距（不贴顶，视觉更舒适）
      const scrollToRow = (): void => {
        const port = document.querySelector<HTMLElement>('[data-conversation-scroll]')
        if (port !== null) {
          const rowTop = row.getBoundingClientRect().top - port.getBoundingClientRect().top + port.scrollTop
          port.scrollTo({ top: rowTop - 12, behavior: mode })
        } else {
          row.scrollIntoView({ behavior: mode, block: 'start' })
        }
      }
      scrollToRow()
      // 正文在 loadOlder prepend 落地后可能自动滚回底部（跟随滚动）：
      // 校验式重滚——仅当目标行明显偏离视口顶（被正文回滚/未到位）才重滚，
      // 用户主动滚动阅读时不干预
      const ensure = (): void => {
        const port = document.querySelector<HTMLElement>('[data-conversation-scroll]')
        if (port === null) return
        const rowRect = row.getBoundingClientRect()
        const portRect = port.getBoundingClientRect()
        const offset = rowRect.top - portRect.top
        if (offset < -60 || offset > 120) scrollToRow()
      }
      window.setTimeout(ensure, 300)
      window.setTimeout(ensure, 800)
      // 跳转确认高亮：监听目标气泡**进入视口（可见）**后才开始闪烁；
      // 背景经 transition 平滑渐变（非突兀切换），主题色两轮缓慢变化
      const bubble = row.querySelector<HTMLElement>('[class*="bubble"]')
        ?? row.querySelector<HTMLElement>('[class*="messageBody"], [class*="bubbleBody"]')
      if (bubble !== null) {
        const original = bubble.style.background
        const themeBg = 'color-mix(in srgb, var(--dsw-alias-brand-primary) 38%, transparent)'
        bubble.style.transition = 'background 350ms ease'
        const paint = (on: boolean): void => {
          bubble.style.background = on ? themeBg : original
        }
        // 轮询等待气泡可见（进入滚动容器视口）；4s 兜底后也执行
        const waitVisible = (): Promise<void> => new Promise((resolve) => {
          const port = document.querySelector<HTMLElement>('[data-conversation-scroll]')
          let tries = 0
          const check = (): void => {
            const r = bubble.getBoundingClientRect()
            const portTop = port !== null ? port.getBoundingClientRect().top : 0
            const portBottom = port !== null ? port.getBoundingClientRect().bottom : window.innerHeight
            if ((r.bottom > portTop && r.top < portBottom) || tries > 40) resolve()
            else {
              tries += 1
              window.setTimeout(check, 100)
            }
          }
          check()
        })
        void waitVisible().then(() => {
          // 两轮切换共约 1.5s：渐变到主题色 → 渐变回 → 再切 → 再回
          paint(true)
          window.setTimeout(() => paint(false), 400)
          window.setTimeout(() => paint(true), 800)
          window.setTimeout(() => paint(false), 1200)
          window.setTimeout(() => { bubble.style.transition = '' }, 1500)
        })
      }
    },
    scrollport: () => document.querySelector<HTMLElement>('[data-conversation-scroll]'),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
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
 * 当前会话窗口内的聊天行（0.1.2 线：ui-conversation chat target；0.1.1 线：
 * session 快照 chat.nodes——防御性保留，0.1.2 分支实际走前者）。
 */
function chatRowsOf(ctx: ClientContext, sessionId: string): ChatRowLike[] {
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
          const kind = node.kind
          if (kind !== 'user' && kind !== 'steering') continue
          rows.push({
            key: typeof node.key === 'string' ? node.key : 'seq:' + (node.seq ?? 0),
            anchorSeq: typeof node.anchorSeq === 'number' ? node.anchorSeq : (node.seq ?? 0),
            visibility: typeof node.visibility === 'string' ? node.visibility : undefined,
            kind,
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
    subscribeList: (cb) => sessions.list.subscribe(cb),
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
    navLoadedTurns: (sessionId) => {
      const chat = chatFaceOf(ctx, sessionId)
      const items = chat?.getSnapshot?.()?.navigation?.items?.() ?? []
      return new Set(items.map((item) => item.turn))
    },
    subscribeNavLoadedTurns: (sessionId, cb) => {
      const chat = chatFaceOf(ctx, sessionId)
      if (chat === undefined) return () => {}
      return chat.subscribe(cb)
    },
    jump: (sessionId, key, seq, currentSeq) => {
      const ports = jumpPortsFor(ctx, sessionId)
      ports.report = (code: JumpFailureCode) => {
        // Surface the failure through the component via a DOM event the
        // strip listens for; simplest reliable cross-boundary channel here.
        window.dispatchEvent(new CustomEvent('mega-chat-nav:jump-failed', { detail: code }))
      }
      ports.onLoading = (loading: boolean, pages: number) => {
        window.dispatchEvent(new CustomEvent('mega-chat-nav:jump-loading', { detail: { loading, pages } }))
      }
      void goTo(ports, key, {}, settings.getSnapshot().scrollBehavior, seq, currentSeq)
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