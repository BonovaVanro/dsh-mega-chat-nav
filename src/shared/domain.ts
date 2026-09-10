/**
 * 双半共享的领域定义（选项表 / 默认值 / 类型）——纯字面量，零依赖。
 *
 * host 半（src/settings.ts）与 client 半（src/client/settings.ts）都从此处取值，
 * 消除两侧同值副本的漂移风险；client bundle 打包本模块只是内联常量，
 * 不引入任何宿主包（client bundle 不得依赖宿主包）。
 *
 * @module dsh-mega-chat-nav/shared/domain
 */

/** 风格选项：简约 / codex（时间线刻度）/ deepseek（用户消息面板）/ harness（复刻官方回合导航刻度轨） */
export const STYLE_OPTIONS = ['minimal', 'codex', 'deepseek', 'harness'] as const
export type NavStyle = typeof STYLE_OPTIONS[number]

/** 停靠侧选项 */
export const ALIGN_OPTIONS = ['left', 'right'] as const
export type RailAlign = typeof ALIGN_OPTIONS[number]

/** 节点栏条带高度档位 */
export const BAND_OPTIONS = ['compact', 'standard', 'tall'] as const
export type BandHeight = typeof BAND_OPTIONS[number]

/** 跳转动画方式 */
export const SCROLL_OPTIONS = ['smooth', 'instant'] as const
export type ScrollMode = typeof SCROLL_OPTIONS[number]

/** 显示策略：常显 / 悬停浮现 / 隐藏 */
export const SHOW_OPTIONS = ['show', 'peek', 'hide'] as const
export type ShowMode = typeof SHOW_OPTIONS[number]

/** 翻页标记显示策略（按风格独立默认）：minimal 常显 / codex 隐藏 / deepseek 浮现 */
export const DEFAULT_PAGING: Record<NavStyle, ShowMode> = {
  minimal: 'show',
  codex: 'hide',
  deepseek: 'peek',
  harness: 'hide',
}

/** 搜索内容范围（多选；用户必选） */
export const SEARCH_SCOPE_OPTIONS = ['user', 'assistant', 'tool'] as const
export type SearchScope = typeof SEARCH_SCOPE_OPTIONS[number]
export const DEFAULT_SEARCH_SCOPES: SearchScope[] = ['user', 'assistant', 'tool']

/** 悬停卡片数量 */
export const CARD_OPTIONS = [1, 3, 5] as const
export type CardCount = typeof CARD_OPTIONS[number]

/** 悬浮卡默认数量（按风格独立）：minimal 3 张 / codex 1 张 / deepseek 1 张（无悬浮卡能力，占位） */
export const DEFAULT_CARD_COUNT: Record<NavStyle, CardCount> = {
  minimal: 3,
  codex: 1,
  deepseek: 1,
  harness: 3,
}

/** 悬浮卡内容块（多选） */
export const CARD_ITEM_OPTIONS = ['turn', 'duration', 'favorite'] as const
export type CardItem = typeof CARD_ITEM_OPTIONS[number]
export const DEFAULT_CARD_ITEMS: CardItem[] = ['turn', 'duration', 'favorite']

/** 刻度色调：柔和（低对比）/ 深邃（高对比、清晰） */
export const MARK_TONE_OPTIONS = ['soft', 'deep'] as const
export type MarkTone = typeof MARK_TONE_OPTIONS[number]
export const DEFAULT_MARK_TONE: MarkTone = 'deep'

export const DEFAULT_STYLE: NavStyle = 'minimal'
export const DEFAULT_ALIGN: RailAlign = 'left'
export const DEFAULT_BAND: BandHeight = 'standard'
export const DEFAULT_SCROLL: ScrollMode = 'smooth'
export const DEFAULT_SHOW: ShowMode = 'show'
