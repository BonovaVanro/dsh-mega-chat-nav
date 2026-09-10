/**
 * Host-side durable settings for the mega-chat-nav plugin.
 * 配置选项（选项表/默认值/类型）集中在 src/shared/domain.ts，双半共享；
 * 本模块只持有 host 侧 schema 与命名空间。
 *
 * @module dsh-mega-chat-nav/settings
 */

import z from '@deepseek-ai/schemastery'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'

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
} from './shared/domain.ts'
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
} from './shared/domain.ts'

// 共享领域定义（选项表/默认值/类型）转发给既有导入方，保持本模块公开面不变
export * from './shared/domain.ts'

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
  harness: StyleSettings
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
  harness: { cardCount: DEFAULT_CARD_COUNT.harness, showPaging: DEFAULT_PAGING.harness },
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
    harness: z.object({ ...StyleFields, ...styleSchemaFields('harness') }),
  }),
})

/** 本插件设置命名空间 */
export const megaChatNavSettingsNamespace = 'mega-chat-nav' as SettingsNamespace