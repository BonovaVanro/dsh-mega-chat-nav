/**
 * Host-side durable settings for the mega-chat-nav plugin.
 * 配置选项为本插件自有定义：host 半持有此处；client 半在
 * src/client/settings.ts 持有同值副本（client bundle 不得依赖宿主包）。
 *
 * @module dsh-mega-chat-nav/settings
 */

import z from '@deepseek-ai/schemastery'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'

/** 风格选项：简约 / codex（时间线刻度）/ deepseek（用户消息面板，常态短横折叠） */
export const STYLE_OPTIONS = ['minimal', 'codex', 'deepseek'] as const
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

/** 翻页标记默认显示模式（按风格独立）：minimal 常显（历史行为）/ codex 隐藏 */
export const DEFAULT_PAGING: Record<NavStyle, ShowMode> = {
  minimal: 'show',
  codex: 'hide',
  deepseek: 'peek',
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

/** 通用配置（全局，跨风格生效） */
export interface NavGeneralSettings {
  /** 当前风格 */
  style: NavStyle
  /** 导航条停靠侧 */
  align: RailAlign
  /** 跳转动画方式 */
  scrollBehavior: ScrollMode
  /** 轮次总数徽标显示模式（兼容旧布尔：true→show / false→hide） */
  showCount: ShowMode | boolean
  /** 搜索按钮显示模式（兼容旧布尔） */
  showSearch: ShowMode | boolean
  /** 设置按钮显示模式（兼容旧布尔） */
  showQuickSettings: ShowMode | boolean
  /** 收藏按钮显示模式（兼容旧布尔） */
  showFavorites: ShowMode | boolean
  /** 搜索内容范围（多选；用户必选，其余可关） */
  searchScopes: SearchScope[]
  /** 导航栏与对话列边缘的偏移距离（px，0-32，随左右对齐自适应） */
  railOffset: number
  /** @deprecated 旧版字段（翻页标记曾置于此处）——仅兼容存量配置，新主源在 styles.<style>.showPaging */
  showPaging?: ShowMode | boolean
}

/** 单风格配置（每风格独立一套） */
export interface StyleSettings {
  /** 节点栏条带高度档位 */
  bandHeight: BandHeight
  /** 悬停卡片数量（1/3/5） */
  cardCount: CardCount
  /** 悬浮卡内容块（多选：轮次 / 用时 / 收藏） */
  cardItems: CardItem[]
  /** 刻度色调（codex 刻度轨使用：柔和 / 深邃） */
  markTone: MarkTone
  /** 翻页标记显示模式：show=常显 / peek=浮现 / hide=隐藏 */
  showPaging: ShowMode
}

/** 风格专属配置（styles.<style> 每风格独立） */
export interface NavStyleSettings {
  minimal: StyleSettings
  codex: StyleSettings
  deepseek: StyleSettings
}

/** 持久化设置文档结构 */
export interface NavSettings {
  general: NavGeneralSettings
  styles: NavStyleSettings
}

// 显示模式兼容旧布尔（true → show / false → hide）：旧 user 段里的布尔值
// 不能导致 register 的 schema 校验失败，否则 namespace 注册失败、设置无法持久化
const ShowModeSchema = z.union([z.boolean(), ...SHOW_OPTIONS]).default(DEFAULT_SHOW)

const GeneralSchema = z.object({
  style: z.union([...STYLE_OPTIONS]).default(DEFAULT_STYLE),
  align: z.union([...ALIGN_OPTIONS]).default(DEFAULT_ALIGN),
  scrollBehavior: z.union([...SCROLL_OPTIONS]).default(DEFAULT_SCROLL),
  showCount: ShowModeSchema,
  showSearch: ShowModeSchema,
  showQuickSettings: ShowModeSchema,
  showFavorites: ShowModeSchema,
  /* 旧版 general.showPaging 残留兼容（0.9.x 曾置于此处）；新主源已迁移 styles.<style> */
  showPaging: ShowModeSchema,
  searchScopes: z.array(z.union([...SEARCH_SCOPE_OPTIONS])).default([...DEFAULT_SEARCH_SCOPES]),
  railOffset: z.natural().max(32).default(8),
})

/** 风格公共字段（两风格默认一致的配置） */
const StyleFields = {
  bandHeight: z.union([...BAND_OPTIONS]).default(DEFAULT_BAND),
  cardItems: z.array(z.union([...CARD_ITEM_OPTIONS])).default([...DEFAULT_CARD_ITEMS]),
  markTone: z.union([...MARK_TONE_OPTIONS]).default(DEFAULT_MARK_TONE),
}

/** 每风格独立默认字段：悬浮卡数与翻页标记（minimal 常显 / codex 隐藏 / deepseek 浮现） */
const StyleDefaults: Record<NavStyle, { cardCount: CardCount; showPaging: ShowMode }> = {
  minimal: { cardCount: DEFAULT_CARD_COUNT.minimal, showPaging: DEFAULT_PAGING.minimal },
  codex: { cardCount: DEFAULT_CARD_COUNT.codex, showPaging: DEFAULT_PAGING.codex },
  deepseek: { cardCount: DEFAULT_CARD_COUNT.deepseek, showPaging: DEFAULT_PAGING.deepseek },
}
const styleSchemaFields = (style: NavStyle) => ({
  cardCount: z.union([...CARD_OPTIONS]).default(StyleDefaults[style].cardCount),
  showPaging: z.union([...SHOW_OPTIONS]).default(StyleDefaults[style].showPaging),
})

/** 持久化设置 schema；也是浏览器 scope 校验的 wire 信封 */
export const NavSettingsSchema: z<NavSettings> = z.object({
  general: GeneralSchema,
  styles: z.object({
    minimal: z.object({ ...StyleFields, ...styleSchemaFields('minimal') }),
    codex: z.object({ ...StyleFields, ...styleSchemaFields('codex') }),
    deepseek: z.object({ ...StyleFields, ...styleSchemaFields('deepseek') }),
  }),
})

/** 本插件设置命名空间 */
export const megaChatNavSettingsNamespace = 'mega-chat-nav' as SettingsNamespace