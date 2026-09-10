/**
 * Browser mirror of the `mega-chat-nav` settings namespace: reads the rail
 * settings from the settings scope (`ctx.settingsScope.bind`) and routes the
 * user's choices back through the host bridge (POST /mega-chat-nav/settings).
 *
 * 配置选项（选项表/默认值/类型）集中在 src/shared/domain.ts，双半共享
 * （纯字面量零依赖，client bundle 不因此引入宿主包）。
 *
 * The settings surface is optional and may apply after this plugin, so the
 * controller starts unbound and degrades to the defaults until {@link attach}
 * binds the scope.
 *
 * @module dsh-mega-chat-nav/client/settings
 */

// 0.1.2 线：SettingsScope 契约从已停发的 dsh-client-runtime 移到 dsh-client-ui-settings
import type { SettingsScope, SettingsScopeSnapshot, SettingsScopeSpec } from '@deepseek-ai/dsh-client-ui-settings/client'

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

/** 本插件设置命名空间 */
export const MGCN_NS = 'mega-chat-nav'

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

/** The minimal face of the settings scope service this controller needs. */
export interface SettingsScopeBinderLike {
  bind<T>(spec: SettingsScopeSpec<T>): SettingsScope<T>
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
interface NavSettingsSection {
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
  /** Whether the user layer overrides the composition default. */
  overridden: boolean
}

/** Reactive handle over the plugin's durable settings section. */
export class NavSettingsController {
  private scope: SettingsScope<NavSettingsSection> | undefined
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
    overridden: false,
  }

  /**
   * Bind the namespace scope once the settings surface is present.
   * A no-op after the first bind.
   */
  attach(binder: SettingsScopeBinderLike): void {
    if (this.scope !== undefined) return
    this.scope = binder.bind<NavSettingsSection>({ namespace: MGCN_NS })
    this.state = this.derive(this.scope.getSnapshot())
    this.unsubscribe = this.scope.subscribe(() => {
      if (this.scope === undefined) return
      const next = this.derive(this.scope.getSnapshot())
      if (next.style === this.state.style
        && next.align === this.state.align && next.bandHeight === this.state.bandHeight
        && next.cardCount === this.state.cardCount
        && next.scrollBehavior === this.state.scrollBehavior
        && next.showCount === this.state.showCount
        && next.showSearch === this.state.showSearch
        && next.showQuickSettings === this.state.showQuickSettings
        && next.overridden === this.state.overridden) return
      this.state = next
      for (const listener of this.listeners) listener()
    })
  }

  /** 当前生效风格的 styles.<style> 段（快照内读取，供逐风格独立取值） */
  private styleSection(snapshot: SettingsScopeSnapshot<NavSettingsSection>, style: NavStyle): StyleWireSection | undefined {
    return snapshot.value?.styles?.[style]
  }

  private derive(snapshot: SettingsScopeSnapshot<NavSettingsSection>): NavSettingsState {
    const user = snapshot.user as NavSettingsSection | undefined
    const general = snapshot.value?.general
    const ready = snapshot.status === 'ready'
    const style = ready && isNavStyle(general?.style) ? general.style : DEFAULT_STYLE
    const active = this.styleSection(snapshot, style)
    return {
      style,
      align: ready && isRailAlign(general?.align) ? general.align : DEFAULT_ALIGN,
      bandHeight: ready && isBandHeight(active?.bandHeight) ? active.bandHeight : DEFAULT_BAND,
      cardCount: ready && isCardCount(active?.cardCount) ? active.cardCount : DEFAULT_CARD_COUNT[style],
      cardItems: ready && isCardItems(active?.cardItems) ? active.cardItems : [...DEFAULT_CARD_ITEMS],
      markTone: ready && isMarkTone(active?.markTone) ? active.markTone : DEFAULT_MARK_TONE,
      scrollBehavior: ready && isScrollMode(general?.scrollBehavior) ? general.scrollBehavior : DEFAULT_SCROLL,
      showCount: ready ? coerceShowMode(general?.showCount) : DEFAULT_SHOW,
      showSearch: ready ? coerceShowMode(general?.showSearch) : DEFAULT_SHOW,
      showQuickSettings: ready ? coerceShowMode(general?.showQuickSettings) : DEFAULT_SHOW,
      showFavorites: ready ? coerceShowMode(general?.showFavorites) : DEFAULT_SHOW,
      showPaging: ready ? coercePagingMode(active?.showPaging, DEFAULT_PAGING[style]) : DEFAULT_PAGING[style],
      searchScopes: ready && isSearchScopes(general?.searchScopes) ? general.searchScopes : [...DEFAULT_SEARCH_SCOPES],
      railOffset: ready && typeof general?.railOffset === 'number' && general.railOffset >= 0 && general.railOffset <= 32
        ? Math.round(general.railOffset)
        : DEFAULT_RAIL_OFFSET,
      overridden: user !== undefined && (user.general !== undefined || user.styles !== undefined),
    }
  }

  /** Release the scope subscription. */
  dispose(): void {
    this.unsubscribe()
    this.listeners.clear()
  }

  /** 乐观提交：更新状态并立即通知（UI 即时反映） */
  private commit(next: NavSettingsState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }

  /** 当前 general 段（setter 整段写回用） */
  private get general(): NavSettingsSection['general'] {
    return {
      style: this.state.style,
      align: this.state.align,
      scrollBehavior: this.state.scrollBehavior,
      showCount: this.state.showCount,
      showSearch: this.state.showSearch,
      showQuickSettings: this.state.showQuickSettings,
      showFavorites: this.state.showFavorites,
      searchScopes: this.state.searchScopes,
      railOffset: this.state.railOffset,
    }
  }

  /** 当前风格段的完整值（setter 局部 patch 的基础） */
  private get styleValues(): { bandHeight: BandHeight; cardCount: CardCount; cardItems: CardItem[]; markTone: MarkTone; showPaging: ShowMode } {
    return {
      bandHeight: this.state.bandHeight,
      cardCount: this.state.cardCount,
      cardItems: this.state.cardItems,
      markTone: this.state.markTone,
      showPaging: this.state.showPaging,
    }
  }

  /** 按当前风格构造 write 的 styles 段（只含当前风格键，绝不染指其他风格段） */
  private stylePatch(extra: Partial<StyleWireSection>): NavSettingsSection['styles'] {
    const section = { ...this.styleValues, ...extra }
    const patch: Partial<Record<NavStyle, StyleWireSection>> = {}
    patch[this.state.style] = section
    return patch
  }

  /** @returns the current state (stable reference until the next change). */
  getSnapshot(): NavSettingsState {
    return this.state
  }

  /** Observe state replacements; returns the disposer. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * 写回宿主：scope.set 契约只接受 section 内**标量**字段，嵌套 section
   * （general/styles 对象）无法经它持久化，所以走 host 桥
   * （POST /mega-chat-nav/settings → settings.update 深层 merge + revision 围栏）。
   */
  private write(patch: NavSettingsSection): void {
    if (this.scope === undefined) return
    const revision = this.scope.getSnapshot().revision
    void fetch('/mega-chat-nav/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patch, revision: revision ?? undefined }),
    })
      .then((resp) => resp.json().catch(() => ({})) as Promise<{ ok?: boolean }>)
      .then((data) => {
        if (!data.ok) console.error('[mega-chat-nav] settings write rejected')
      })
      .catch((e: unknown) => console.error('[mega-chat-nav] settings write failed:', e))
  }

  /** Route the user's anchor-edge choice to the Host document. */
  setAlign(align: RailAlign): void {
    if (this.scope === undefined) return
    this.commit({ ...this.state, align })
    this.write({ general: { ...this.general, align } })
  }

  /** Route the user's style choice to the Host document（切换后随即载入该风格自己的独立配置） */
  setStyle(style: NavStyle): void {
    if (this.scope === undefined) return
    const snapshot = this.scope.getSnapshot()
    const next = this.derive({ ...snapshot, value: { ...snapshot.value, general: { ...snapshot.value?.general, style } } })
    this.commit({ ...next, overridden: this.state.overridden })
    this.write({ general: { ...this.general, style } })
  }

  /** Route the user's band-height choice to the Host document（写入当前风格的独立段） */
  setBandHeight(band: BandHeight): void {
    if (this.scope === undefined) return
    this.commit({ ...this.state, bandHeight: band })
    this.write({ styles: this.stylePatch({ bandHeight: band }) })
  }

  /** Route the user's scroll-mode choice to the Host document. */
  setScrollMode(mode: ScrollMode): void {
    if (this.scope === undefined) return
    this.commit({ ...this.state, scrollBehavior: mode })
    this.write({ general: { ...this.general, scrollBehavior: mode } })
  }

  /** Route the user's count-badge display mode to the Host document. */
  setShowCount(mode: ShowMode): void {
    if (this.scope === undefined) return
    this.commit({ ...this.state, showCount: mode })
    this.write({ general: { ...this.general, showCount: mode } })
  }

  /** Route the user's search-button display mode to the Host document. */
  setShowSearch(mode: ShowMode): void {
    if (this.scope === undefined) return
    this.commit({ ...this.state, showSearch: mode })
    this.write({ general: { ...this.general, showSearch: mode } })
  }

  /** Route the user's quick-settings display mode to the Host document. */
  setShowQuickSettings(mode: ShowMode): void {
    if (this.scope === undefined) return
    this.commit({ ...this.state, showQuickSettings: mode })
    this.write({ general: { ...this.general, showQuickSettings: mode } })
  }

  /** Route the user's favorite-button display mode to the Host document. */
  setShowFavorites(mode: ShowMode): void {
    if (this.scope === undefined) return
    this.commit({ ...this.state, showFavorites: mode })
    this.write({ general: { ...this.general, showFavorites: mode } })
  }

  /** Route the user's paging-marker display mode to the Host document（写入当前风格独立段） */
  setShowPaging(mode: ShowMode): void {
    if (this.scope === undefined) return
    this.commit({ ...this.state, showPaging: mode })
    this.write({ styles: this.stylePatch({ showPaging: mode }) })
  }

  /** Route the user's search-scope selection to the Host document（用户必选，强制保留且置于首位） */
  setSearchScopes(scopes: SearchScope[]): void {
    if (this.scope === undefined) return
    const normalized = ['user' as SearchScope, ...scopes.filter((s) => s !== 'user')]
    this.commit({ ...this.state, searchScopes: normalized })
    this.write({ general: { ...this.general, searchScopes: normalized } })
  }

  /** Route the user's rail-offset choice to the Host document（0-32px 取整钳制） */
  setRailOffset(offset: number): void {
    if (this.scope === undefined) return
    const clamped = Math.max(RAIL_OFFSET_MIN, Math.min(RAIL_OFFSET_MAX, Math.round(offset)))
    this.commit({ ...this.state, railOffset: clamped })
    this.write({ general: { ...this.general, railOffset: clamped } })
  }

  /** Route the user's cascade-card count to the Host document（写入当前风格的独立段） */
  setCardCount(count: CardCount): void {
    if (this.scope === undefined) return
    this.commit({ ...this.state, cardCount: count })
    this.write({ styles: this.stylePatch({ cardCount: count }) })
  }

  /** Route the user's card-content selection to the Host document（写入当前风格的独立段） */
  setCardItems(items: CardItem[]): void {
    if (this.scope === undefined) return
    this.commit({ ...this.state, cardItems: items })
    this.write({ styles: this.stylePatch({ cardItems: items }) })
  }

  /** Route the user's mark-tone choice to the Host document（codex 刻度色调；写入当前风格段） */
  setMarkTone(tone: MarkTone): void {
    if (this.scope === undefined) return
    this.commit({ ...this.state, markTone: tone })
    this.write({ styles: this.stylePatch({ markTone: tone }) })
  }
}