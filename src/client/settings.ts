/**
 * Browser mirror of the plugin's own configuration section.
 *
 * 0.1.7 起读写入口从 `ctx.settingsScope.bind({namespace})` 改为
 * `ctx.configForms.get<T>(entryId)`：命名空间 = **profile entry id**（`ui-mega-chat-nav`），
 * 写入用**路径级 `mutate`**（宿主按 path merge，无「整对象读-改-写」竞争），
 * 且只有 `Config` 里标了 `volatile` 的字段可被实时写入。
 *
 * 配置选项（选项表/默认值/类型）集中在 src/shared/domain.ts，双半共享
 * （纯字面量零依赖，client bundle 不因此引入宿主包）。
 *
 * 设置面可能晚于本插件就绪，因此控制器先以默认值运行，待 {@link attach} 拿到表单后接管。
 *
 * @module dsh-mega-chat-nav/client/settings
 */

/**
 * 本控制器需要的最小表单面（结构型约束）。
 *
 * 刻意不 import `ConfigForm`：`@deepseek-ai/dsh-client-ui-settings/client` 是**宿主包**，
 * 客户端产物不应把它拉进依赖图（官方客户端 bundle 纯度门同样禁止跨插件值导入）；
 * 结构型声明还能让测试用假表单直接驱动控制器。
 */
export interface ConfigFormSnapshotLike<T> {
  /** `loading` 直到首次收到 section，`ready` 表示已有一份可用值 */
  status: 'loading' | 'ready' | 'unavailable'
  /** schema 解析后的 section；首次接收前为 undefined */
  value: T | undefined
  /** 用户层原始内容（字段「出现」即代表被显式覆盖） */
  user: unknown
  /** 写入围栏用的命名空间 revision */
  revision: number | undefined
  /** 宿主是否接受写入 */
  writable: boolean
}

/** 路径级写入操作（对齐 dsh-api-remotes 的 SettingsPathOpView，本地收窄免外部依赖）。 */
export type SettingsPathOp =
  | { op: 'set'; path: readonly string[]; value: unknown }
  | { op: 'unset'; path: readonly string[] }

/** 一个命名空间的表单面（`ctx.configForms.get(entryId)` 的返回值）。 */
export interface ConfigFormLike<T> {
  getSnapshot(): ConfigFormSnapshotLike<T>
  subscribe(listener: () => void): () => void
  /** 原子提交一组路径操作；true = 宿主接受，false = 被拒或跳过（传输失败则 reject）。 */
  mutate(ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<boolean>
}

import {
  ALIGN_OPTIONS,
  BAND_OPTIONS,
  CARD_ITEM_OPTIONS,
  CARD_OPTIONS,
  DEFAULT_ALIGN,
  DEFAULT_BAND,
  DEFAULT_CARD_COUNT,
  DEFAULT_CARD_ITEMS,
  DEFAULT_MARK_TONE,
  DEFAULT_PAGING,
  DEFAULT_SCROLL,
  DEFAULT_SEARCH_SCOPES,
  DEFAULT_SHOW,
  DEFAULT_STYLE,
  MARK_TONE_OPTIONS,
  SCROLL_OPTIONS,
  SEARCH_SCOPE_OPTIONS,
  SHOW_OPTIONS,
  STYLE_OPTIONS,
} from '../shared/domain.ts'
import type {
  BandHeight,
  CardCount,
  CardItem,
  MarkTone,
  NavStyle,
  RailAlign,
  ScrollMode,
  SearchScope,
  ShowMode,
} from '../shared/domain.ts'

// 共享领域定义（选项表/默认值/类型）转发给既有导入方，保持本模块公开面不变
export * from '../shared/domain.ts'

/** 条带高度档位 → 像素（minimal/codex 共用基础几何；deepseek 行高 30px 自成一档）
 *  - minimal / codex：compact 140 / standard 210 / tall 280
 *  - deepseek：compact 160 / standard 220 / tall 280 */
export const BAND_HEIGHT_PX: Record<NavStyle, Record<BandHeight, number>> = {
  minimal: { compact: 144, standard: 204, tall: 274 },
  codex: { compact: 140, standard: 210, tall: 280 },
  deepseek: { compact: 160, standard: 220, tall: 280 },
  harness: { compact: 140, standard: 210, tall: 280 },
}

/** 风格能力：各风格声明自己的可选能力（组件与设置面据此取舍） */
export interface StyleCapabilities {
  /** 悬停悬浮卡片（级联预览）——deepseek 面板自带消息预览，不需要 */
  hoverCards: boolean
  /** ▲/▼ 翻页标志（deepseek 面板内滚动，不需要显式翻页按钮） */
  paging: boolean
}

/** 风格 → 能力表 */
export const STYLE_CAPABILITIES: Record<NavStyle, StyleCapabilities> = {
  minimal: { hoverCards: true, paging: true },
  codex: { hoverCards: true, paging: true },
  deepseek: { hoverCards: false, paging: false },
  harness: { hoverCards: true, paging: true },
}

/** 导航栏偏移（px）范围与默认值 */
export const RAIL_OFFSET_MIN = 0
export const RAIL_OFFSET_MAX = 32
export const DEFAULT_RAIL_OFFSET = 8

/** Narrow a raw section value to the anchor field. */
function isRailAlign(value: unknown): value is RailAlign {
  return (ALIGN_OPTIONS as readonly unknown[]).includes(value)
}

/** Narrow a raw section value to the style field. */
function isNavStyle(value: unknown): value is NavStyle {
  return (STYLE_OPTIONS as readonly unknown[]).includes(value)
}

/** 兼容旧 boolean 配置：true → show，false → hide；新值走枚举校验 */
function coerceShowMode(value: unknown): ShowMode {
  if (typeof value === 'boolean') return value ? 'show' : 'hide'
  return isShowMode(value) ? value : DEFAULT_SHOW
}

/** 翻页标记显示模式转换（默认按风格：minimal show / codex hide） */
function coercePagingMode(value: unknown, fallback: ShowMode): ShowMode {
  if (typeof value === 'boolean') return value ? 'show' : 'hide'
  return isShowMode(value) ? value : fallback
}

function isShowMode(value: unknown): value is ShowMode {
  return (SHOW_OPTIONS as readonly unknown[]).includes(value)
}

function isCardCount(value: unknown): value is CardCount {
  return (CARD_OPTIONS as readonly unknown[]).includes(value)
}

function isBandHeight(value: unknown): value is BandHeight {
  return (BAND_OPTIONS as readonly unknown[]).includes(value)
}

function isSearchScopes(value: unknown): value is SearchScope[] {
  return Array.isArray(value)
    && value.every((s) => (SEARCH_SCOPE_OPTIONS as readonly unknown[]).includes(s))
}

function isCardItems(value: unknown): value is CardItem[] {
  return Array.isArray(value)
    && value.every((item) => (CARD_ITEM_OPTIONS as readonly unknown[]).includes(item))
}

function isMarkTone(value: unknown): value is MarkTone {
  return (MARK_TONE_OPTIONS as readonly unknown[]).includes(value)
}

function isScrollMode(value: unknown): value is ScrollMode {
  return (SCROLL_OPTIONS as readonly unknown[]).includes(value)
}

/**
 * 乐观写穿缓存键：宿主写入 = 写盘 + 全量 reconcile（实测约 1.5s），
 * 在这段时间里刷新页面会打断写入而丢配置。把「尚未被宿主确认」的意图写到 localStorage，
 * 刷新后先按它显示、并自动重提交宿主，宿主确认后再摘下。
 */
const OPTIMISTIC_CACHE_KEY = 'dsh-mega-chat-nav.optimistic.v1'

/**
 * 字段写入防抖窗口（ms）：快速连点只发一次宿主写、携带最终值。
 * 400 与 mega-settings 取值一致——足够合并人手连点，又不会让正常单击显得迟滞。
 */
const SETTINGS_WRITE_DEBOUNCE_MS = 400

/** 未确认写入：字段路径（如 `general.align`、`styles.codex.cardCount`）→ 期望值 */
type PendingWrites = Record<string, unknown>

function readPendingCache(): PendingWrites {
  try {
    const raw = localStorage.getItem(OPTIMISTIC_CACHE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as PendingWrites)
      : {}
  } catch {
    return {}
  }
}

function writePendingCache(pending: PendingWrites): void {
  try {
    if (Object.keys(pending).length === 0) localStorage.removeItem(OPTIMISTIC_CACHE_KEY)
    else localStorage.setItem(OPTIMISTIC_CACHE_KEY, JSON.stringify(pending))
  } catch {
    /* localStorage 不可用时忽略：写穿只是增强，不影响功能 */
  }
}

/** 把路径段编码成缓存键（段内不含分隔符，故可用 . 连接） */
function pathKey(path: readonly string[]): string {
  return path.join('.')
}

/** 按路径深读（任一层缺失即 undefined） */
function readPath(root: unknown, path: readonly string[]): unknown {
  let current: unknown = root
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** 值相等（对象/数组按 JSON 比较；用于判断宿主是否已确认某次写入） */
function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

/** 单风格 wire 段（每风格独立；字段同 host schema） */
interface StyleWireSection {
  bandHeight?: unknown
  cardCount?: unknown
  cardItems?: unknown
  markTone?: unknown
  showPaging?: unknown
}

/** Wire section this plugin owns (the Host schema's fields). */
export interface NavSettingsSection {
  general?: {
    style?: unknown
    align?: unknown
    scrollBehavior?: unknown
    showCount?: unknown
    showSearch?: unknown
    showQuickSettings?: unknown
    showFavorites?: unknown
    searchScopes?: unknown
    railOffset?: unknown
  }
  styles?: Partial<Record<NavStyle, StyleWireSection>>
}

/** Snapshot consumed by the strip and the settings rows. */
export interface NavSettingsState {
  /** Last accepted style. */
  style: NavStyle
  /** Last accepted anchor edge (default while the scope is absent/loading). */
  align: RailAlign
  /** Last accepted band height tier. */
  bandHeight: BandHeight
  /** Last accepted jump scroll mode. */
  scrollBehavior: ScrollMode
  /** Turn-count badge display mode. */
  showCount: ShowMode
  /** Search button display mode. */
  showSearch: ShowMode
  /** Quick settings gear display mode. */
  showQuickSettings: ShowMode
  /** Favorite filter button display mode. */
  showFavorites: ShowMode
  /** 翻页标记显示模式（show=常显 / peek=浮现 / hide=隐藏） */
  showPaging: ShowMode
  /** 搜索内容范围（多选；用户必选） */
  searchScopes: SearchScope[]
  /** 导航栏偏移距离（px，随左右对齐自适应） */
  railOffset: number
  /** Hover cascade card count. */
  cardCount: CardCount
  /** 悬浮卡内容块（多选：轮次 / 用时 / 收藏） */
  cardItems: CardItem[]
  /** 刻度色调（codex 刻度轨；minimal 忽略） */
  markTone: MarkTone
  /**
   * 是否已有用户修改（含尚未被宿主确认的写入）。
   *
   * 读取时计算（见 {@link NavSettingsController.getSnapshot}），**不参与快照 diff**：
   * 它随宿主确认而翻转，放进状态会制造"没有可见变化"的假通知。
   */
  overridden?: boolean
}

/** Reactive handle over the plugin's durable settings section. */
export class NavSettingsController {
  private scope: ConfigFormLike<NavSettingsSection> | undefined
  /**
   * 尚未被宿主确认的写入（路径 → 期望值）。刷新后从 localStorage 恢复并重放，
   * 宿主快照追平后逐条摘下——宿主写慢也不丢配置。
   */
  private pending: PendingWrites = {}
  /**
   * 本会话内发生过用户动作（setter 调用）。
   *
   * 为什么需要它：`commit` 在 `writePath` 之前执行（setStyle 依赖 commit 后的风格），
   * 那一刻 pending 还没记上；若只看 pending/宿主 user 段，刚点的那一下会显示"未修改"。
   * 宿主确认（pending 清空）时归位。
   */
  private touched = false
  /**
   * 每个字段路径的「未落定写入」计数：>0 表示该路径还有防抖等待或请求在途的宿主写入。
   *
   * 为什么必须有它：宿主每次写入都会回推镜像；若写入未落定就按"宿主值 == 意图"摘下覆盖，
   * 快速连点期间会先摘后又被中间值顶回，UI 便跟着 true/false 缓慢翻转（mega-settings 实测修复）。
   */
  private readonly dirtyGen = new Map<string, number>()
  /** 每个字段路径的防抖定时器：快速连点合并为一次宿主写入（避免宿主逐个回放整串 T→F→T→F） */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly listeners = new Set<() => void>()
  private unsubscribe: () => void = () => {}
  private state: NavSettingsState = {
    style: DEFAULT_STYLE,
    align: DEFAULT_ALIGN,
    bandHeight: DEFAULT_BAND,
    scrollBehavior: DEFAULT_SCROLL,
    showCount: DEFAULT_SHOW,
    showSearch: DEFAULT_SHOW,
    showQuickSettings: DEFAULT_SHOW,
    showFavorites: DEFAULT_SHOW,
    showPaging: DEFAULT_PAGING.minimal,
    searchScopes: [...DEFAULT_SEARCH_SCOPES],
    railOffset: DEFAULT_RAIL_OFFSET,
    cardCount: DEFAULT_CARD_COUNT[DEFAULT_STYLE],
    cardItems: [...DEFAULT_CARD_ITEMS],
    markTone: DEFAULT_MARK_TONE,
  }

  /**
   * 接管本插件的配置表单（0.1.7：`ctx.configForms.get(entryId)`）。首次 attach 生效，之后为 no-op。
   *
   * 传入的是 `ctx.configForms.get<NavSettingsSection>(entryId)` 本身（= {@link ConfigFormLike}）。
   */
  attach(source: ConfigFormLike<NavSettingsSection>): void {
    if (this.scope !== undefined) return
    this.scope = source
    // 恢复上次未确认的写入（可能被快速刷新打断）：先按它显示，再重提交宿主
    this.pending = readPendingCache()
    this.replayPending()
    this.state = this.derive(this.scope.getSnapshot())
    this.unsubscribe = this.scope.subscribe(() => {
      if (this.scope === undefined) return
      // 宿主快照变了：先摘掉已确认的 pending，再据此推导（否则会一直压着旧意图）
      this.reconcilePending()
      const next = this.derive(this.scope.getSnapshot())
      if (next.style === this.state.style
        && next.align === this.state.align && next.bandHeight === this.state.bandHeight
        && next.cardCount === this.state.cardCount
        && next.scrollBehavior === this.state.scrollBehavior
        && next.showCount === this.state.showCount
        && next.showSearch === this.state.showSearch
        && next.showQuickSettings === this.state.showQuickSettings) return
      this.state = next
      for (const listener of this.listeners) listener()
    })
  }

  /** 当前生效风格的 styles.<style> 段（快照内读取，供逐风格独立取值） */
  private styleSection(snapshot: ConfigFormSnapshotLike<NavSettingsSection>, style: NavStyle): StyleWireSection | undefined {
    return snapshot.value?.styles?.[style]
  }

  private derive(snapshot: ConfigFormSnapshotLike<NavSettingsSection>): NavSettingsState {
    const general = snapshot.value?.general
    const ready = snapshot.status === 'ready'
    // 未确认写入叠加：路径级读值（pending 优先）。宿主写慢时刷新页面，
    // 快照还没追平，这里让用户看到自己的意图而不是被回退。
    const pick = (path: readonly string[], hostValue: unknown): unknown => {
      const key = pathKey(path)
      return key in this.pending ? this.pending[key] : hostValue
    }
    const style = ready && isNavStyle(pick(['general', 'style'], general?.style))
      ? pick(['general', 'style'], general?.style) as NavStyle
      : DEFAULT_STYLE
    const active = this.styleSection(snapshot, style)
    const generalPick = (field: string): unknown => pick(['general', field], (general as Record<string, unknown> | undefined)?.[field])
    const stylePick = (field: string): unknown => pick(['styles', style, field], (active as Record<string, unknown> | undefined)?.[field])
    return {
      style,
      align: ready && isRailAlign(generalPick('align')) ? generalPick('align') as RailAlign : DEFAULT_ALIGN,
      bandHeight: ready && isBandHeight(stylePick('bandHeight')) ? stylePick('bandHeight') as BandHeight : DEFAULT_BAND,
      cardCount: ready && isCardCount(stylePick('cardCount')) ? stylePick('cardCount') as CardCount : DEFAULT_CARD_COUNT[style],
      cardItems: ready && isCardItems(stylePick('cardItems')) ? stylePick('cardItems') as CardItem[] : [...DEFAULT_CARD_ITEMS],
      markTone: ready && isMarkTone(stylePick('markTone')) ? stylePick('markTone') as MarkTone : DEFAULT_MARK_TONE,
      scrollBehavior: ready && isScrollMode(generalPick('scrollBehavior')) ? generalPick('scrollBehavior') as ScrollMode : DEFAULT_SCROLL,
      showCount: ready ? coerceShowMode(generalPick('showCount')) : DEFAULT_SHOW,
      showSearch: ready ? coerceShowMode(generalPick('showSearch')) : DEFAULT_SHOW,
      showQuickSettings: ready ? coerceShowMode(generalPick('showQuickSettings')) : DEFAULT_SHOW,
      showFavorites: ready ? coerceShowMode(generalPick('showFavorites')) : DEFAULT_SHOW,
      showPaging: ready ? coercePagingMode(stylePick('showPaging'), DEFAULT_PAGING[style]) : DEFAULT_PAGING[style],
      searchScopes: ready && isSearchScopes(generalPick('searchScopes')) ? generalPick('searchScopes') as SearchScope[] : [...DEFAULT_SEARCH_SCOPES],
      railOffset: ready && typeof generalPick('railOffset') === 'number'
        && (generalPick('railOffset') as number) >= 0 && (generalPick('railOffset') as number) <= 32
        ? Math.round(generalPick('railOffset') as number)
        : DEFAULT_RAIL_OFFSET,
    }
  }

  /** Release the scope subscription. */
  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.unsubscribe()
    this.listeners.clear()
  }

  /**
   * 乐观提交：更新状态并立即通知（UI 即时反映）。
   *
   * 这里**重算 overridden**：调用方是从旧状态展开的（`{ ...this.state, align }`），
   * 照抄会滞后一拍——用户刚改的那一下设置页仍显示"未修改"，要等宿主快照回来才对。
   * 判定含 pending：本地已改但宿主未确认也算已修改。
   */
  private commit(next: NavSettingsState): void {
    this.touched = true
    this.state = next
    for (const listener of this.listeners) listener()
  }

  /**
   * 是否有用户层修改（宿主 user 段存在，或本进程还有未确认的写入）。
   *
   * 取**真实来源**而不是照抄旧 state：宿主写入要 ~1.5s reconcile，
   * 用户刚点的那一下还没进快照——只看快照会让设置页显示"未修改"。
   */
  private isOverridden(): boolean {
    if (this.touched) return true
    const user = this.scope?.getSnapshot().user as NavSettingsSection | undefined
    if (user !== undefined && (user.general !== undefined || user.styles !== undefined)) return true
    return Object.keys(this.pending).length > 0
  }

  /** @returns the current state (stable reference until the next change). */
  getSnapshot(): NavSettingsState {
    return { ...this.state, overridden: this.isOverridden() }
  }

  /** Observe state replacements; returns the disposer. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * 写回宿主（0.1.7 路径级写入）。
   *
   * 用 `mutate([{op:'set', path, value}])` 而不是整段写回：宿主按 path **merge**，
   * 天然没有「整对象读-改-写」的竞争窗口（多开关快速连点不会互相覆盖）。
   * 调用方已先做**乐观提交**（本地状态即时生效），此处只负责回写与失败告警；
   * 宿主接受后镜像会推来新快照，derive 会把它折回本控制器状态。
   *
   * 注：只有 `Config` 里标了 `volatile` 的字段可被实时写入（整对象已标）。
   */
  private writePath(ops: readonly SettingsPathOp[]): void {
    const form = this.scope
    if (form === undefined || ops.length === 0) return
    const snapshot = form.getSnapshot()
    if (!snapshot.writable) return
    // 先本地记下意图（写穿 localStorage）：宿主写盘 + reconcile 约 1.5s，
    // 期间刷新会丢——恢复时由 replayPending 重新提交
    const paths: string[] = []
    for (const op of ops) {
      if (op.op === 'set') {
        const key = pathKey(op.path)
        this.pending[key] = op.value
        paths.push(key)
      }
    }
    writePendingCache(this.pending)
    for (const key of paths) this.scheduleWrite(key)
  }

  /**
   * 防抖调度一次字段写入：把快速连点**合并成一次**宿主写入，携带最终值。
   *
   * 两层配合才正确（缺一不可，与 mega-settings 的修法一致）：
   *  1. 本函数——防抖合并，避免宿主串行回放整串中间值（每次写入约 1.5s）；
   *  2. {@link dirtyGen}——写入未落定期间 reconcile 不摘该字段覆盖，
   *     否则会被先落定的中间值顶回，UI 出现 true/false 缓慢翻转。
   *
   * @param key - 字段路径（如 `general.align` / `styles.codex.cardCount`）
   */
  private scheduleWrite(key: string): void {
    const form = this.scope
    if (form === undefined) return
    this.dirtyGen.set(key, (this.dirtyGen.get(key) ?? 0) + 1)
    const old = this.timers.get(key)
    if (old !== undefined) clearTimeout(old)
    const timer = setTimeout(() => {
      this.timers.delete(key)
      // 发的是**此刻**的最终意图：防抖窗口内的后续点击已覆盖 pending
      this.sendWrite(key)
    }, SETTINGS_WRITE_DEBOUNCE_MS)
    this.timers.set(key, timer)
  }

  /**
   * 摘除已被宿主确认的 pending：宿主快照里该路径的值与意图一致，即视为落盘完成。
   * 不一致的（仍在 reconcile 途中）保留，等下一次快照到达再判。
   */
  private reconcilePending(): void {
    const form = this.scope
    if (form === undefined) return
    const value = form.getSnapshot().value
    let changed = false
    for (const key of Object.keys(this.pending)) {
      // 该字段还有防抖等待或在途写入：保留覆盖，等它落定（否则会被中间值顶回）
      if ((this.dirtyGen.get(key) ?? 0) > 0) continue
      if (sameValue(readPath(value, key.split('.')), this.pending[key])) {
        delete this.pending[key]
        changed = true
      }
    }
    if (changed) {
      writePendingCache(this.pending)
      // 最后一次未确认写入已被宿主接受：本会话的"刚改"标记归位
      if (Object.keys(this.pending).length === 0) this.touched = false
    }
  }

  /**
   * 重放上次未确认的写入（刷新打断的残留）：按路径重新提交宿主。
   * 宿主确认后由 {@link reconcilePending} 摘下并清缓存。
   */
  private replayPending(): void {
    const form = this.scope
    if (form === undefined) return
    const keys = Object.keys(this.pending)
    if (keys.length === 0) return
    if (!form.getSnapshot().writable) return
    // 逐字段调度（各自防抖合并）：刷新打断的残留重新提交宿主
    for (const key of keys) this.scheduleWrite(key)
  }

  /**
   * 立即把待发的字段写入发出去（跳过防抖等待）。
   *
   * 供测试与"用户离开页面/立即需要落盘"的场景使用：生产路径靠 400ms 防抖自然触发。
   */
  flushWrites(): void {
    for (const [key, timer] of [...this.timers]) {
      clearTimeout(timer)
      this.timers.delete(key)
      this.sendWrite(key)
    }
  }

  /** 真正发出一次字段写入（防抖到期或 flush 时调用）；落定后递减 dirty 计数并尝试摘覆盖。 */
  private sendWrite(key: string): void {
    const form = this.scope
    if (form === undefined) return
    const value = this.pending[key]
    if (value === undefined) return
    const revision = form.getSnapshot().revision
    const settle = (): void => {
      const n = this.dirtyGen.get(key) ?? 0
      if (n <= 1) this.dirtyGen.delete(key)
      else this.dirtyGen.set(key, n - 1)
      this.reconcilePending()
    }
    void form.mutate([{ op: 'set', path: key.split('.'), value }], revision).then(
      (accepted) => {
        settle()
        if (!accepted) console.warn('[mega-chat-nav] settings write refused by host')
      },
      (e: unknown) => {
        settle()
        console.error('[mega-chat-nav] settings write failed:', e)
      },
    )
  }

  /** 单字段路径写（general 段） */
  private writeGeneral(field: string, value: unknown): void {
    this.writePath([{ op: 'set', path: ['general', field], value }])
  }

  /** 单字段路径写（**当前风格**的 styles.<style> 段；绝不染指其他风格段） */
  private writeStyle(field: string, value: unknown): void {
    this.writePath([{ op: 'set', path: ['styles', this.state.style, field], value }])
  }

  /** Route the user's anchor-edge choice to the Host document. */
  setAlign(align: RailAlign): void {
    if (this.scope === undefined) return
    this.commit({ ...this.state, align })
    this.writeGeneral('align', align)
  }

  /** Route the user's style choice to the Host document（切换后随即载入该风格自己的独立配置） */
  setStyle(style: NavStyle): void {
    if (this.scope === undefined) return
    const snapshot = this.scope.getSnapshot()
    const next = this.derive({ ...snapshot, value: { ...snapshot.value, general: { ...snapshot.value?.general, style } } })
    this.commit({ ...next, overridden: this.state.overridden })
    this.writeGeneral('style', style)
  }

  /** Route the user's band-height choice to the Host document（写入当前风格的独立段） */
  setBandHeight(band: BandHeight): void {
    if (this.scope === undefined) return
    this.commit({ ...this.state, bandHeight: band })
    this.writeStyle('bandHeight', band)
  }

  /** Route the user's scroll-mode choice to the Host document. */
  setScrollMode(mode: ScrollMode): void {
    if (this.scope === undefined) return
    this.commit({ ...this.state, scrollBehavior: mode })
    this.writeGeneral('scrollBehavior', mode)
  }

  /** Route the user's count-badge display mode to the Host document. */
  setShowCount(mode: ShowMode): void {
    if (this.scope === undefined) return
    this.commit({ ...this.state, showCount: mode })
    this.writeGeneral('showCount', mode)
  }

  /** Route the user's search-button display mode to the Host document. */
  setShowSearch(mode: ShowMode): void {
    if (this.scope === undefined) return
    this.commit({ ...this.state, showSearch: mode })
    this.writeGeneral('showSearch', mode)
  }

  /** Route the user's quick-settings display mode to the Host document. */
  setShowQuickSettings(mode: ShowMode): void {
    if (this.scope === undefined) return
    this.commit({ ...this.state, showQuickSettings: mode })
    this.writeGeneral('showQuickSettings', mode)
  }

  /** Route the user's favorite-button display mode to the Host document. */
  setShowFavorites(mode: ShowMode): void {
    if (this.scope === undefined) return
    this.commit({ ...this.state, showFavorites: mode })
    this.writeGeneral('showFavorites', mode)
  }

  /** Route the user's paging-marker display mode to the Host document（写入当前风格独立段） */
  setShowPaging(mode: ShowMode): void {
    if (this.scope === undefined) return
    this.commit({ ...this.state, showPaging: mode })
    this.writeStyle('showPaging', mode)
  }

  /** Route the user's search-scope selection to the Host document（用户必选，强制保留且置于首位） */
  setSearchScopes(scopes: SearchScope[]): void {
    if (this.scope === undefined) return
    const normalized = ['user' as SearchScope, ...scopes.filter((s) => s !== 'user')]
    this.commit({ ...this.state, searchScopes: normalized })
    this.writeGeneral('searchScopes', normalized)
  }

  /** Route the user's rail-offset choice to the Host document（0-32px 取整钳制） */
  setRailOffset(offset: number): void {
    if (this.scope === undefined) return
    const clamped = Math.max(RAIL_OFFSET_MIN, Math.min(RAIL_OFFSET_MAX, Math.round(offset)))
    this.commit({ ...this.state, railOffset: clamped })
    this.writeGeneral('railOffset', clamped)
  }

  /** Route the user's cascade-card count to the Host document（写入当前风格的独立段） */
  setCardCount(count: CardCount): void {
    if (this.scope === undefined) return
    this.commit({ ...this.state, cardCount: count })
    this.writeStyle('cardCount', count)
  }

  /** Route the user's card-content selection to the Host document（写入当前风格的独立段） */
  setCardItems(items: CardItem[]): void {
    if (this.scope === undefined) return
    this.commit({ ...this.state, cardItems: items })
    this.writeStyle('cardItems', items)
  }

  /** Route the user's mark-tone choice to the Host document（codex 刻度色调；写入当前风格段） */
  setMarkTone(tone: MarkTone): void {
    if (this.scope === undefined) return
    this.commit({ ...this.state, markTone: tone })
    this.writeStyle('markTone', tone)
  }
}