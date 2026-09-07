// 跨风格契约：注入面 / 数据形态 / 工具面（仅此——风格实现各自自治）
import type { BandHeight, CardCount, CardItem, MarkTone, NavStyle, RailAlign, ScrollMode, SearchScope, ShowMode } from '../../settings.ts'

/** 会话投影 face 最小面 */
export interface ObservableFace {
  getSnapshot: () => unknown
  subscribe: (listener: () => void) => () => void
}

/** 回合标记：某回合的提问组（或一条未入投影的活提问） */
export interface RailMarker {
  /** 归属回合；活提问（投影未收）为 null */
  readonly turn: number | null
  /** 跳转锚点：组内首问的聊天 key */
  readonly key: string
  /** 首问锚点序号 */
  readonly seq: number
  /** 首问时间 */
  readonly time: number
  /** 组内全部提问文本（按序） */
  readonly texts: readonly string[]
  /** 组内全部聊天 key（活合并去重用） */
  readonly members: readonly string[]
  /** 该轮性能指标（投影附带；缺数据时省略） */
  readonly metrics?: { durationMs: number; firstTokenMs: number; tokensPerSec: number }
}

/** 注册注入面（client/index.ts 装配；各风格经此拿数据与动作） */
export interface NavInjected {
  readQuestions: (sessionId: string) => { key: string; anchorSeq: number; seq: number; time: number; text: string }[]
  subscribeList: (cb: () => void) => () => void
  subscribeContent: (sessionId: string, cb: () => void) => () => void
  questionProjection: (sessionId: string) => ObservableFace | undefined
  /** seq：目标轮序号（方向判定）；currentSeq：当前阅读位置序号（可选，下方判定优先用） */
  jump: (sessionId: string, key: string, seq?: number, currentSeq?: number) => void
  style: () => NavStyle
  setStyle: (style: NavStyle) => void
  align: () => RailAlign
  subscribeSettings: (cb: () => void) => () => void
  setAlign: (align: RailAlign) => void
  bandHeight: () => BandHeight
  setBandHeight: (band: BandHeight) => void
  scrollBehavior: () => ScrollMode
  setScrollMode: (mode: ScrollMode) => void
  showCount: () => ShowMode
  setShowCount: (mode: ShowMode) => void
  showSearch: () => ShowMode
  setShowSearch: (mode: ShowMode) => void
  showQuickSettings: () => ShowMode
  setShowQuickSettings: (mode: ShowMode) => void
  showFavorites: () => ShowMode
  setShowFavorites: (mode: ShowMode) => void
  showPaging: () => ShowMode
  setShowPaging: (mode: ShowMode) => void
  searchScopes: () => SearchScope[]
  setSearchScopes: (scopes: SearchScope[]) => void
  railOffset: () => number
  setRailOffset: (offset: number) => void
  cardCount: () => CardCount
  setCardCount: (count: CardCount) => void
  cardItems: () => CardItem[]
  setCardItems: (items: CardItem[]) => void
  markTone: () => MarkTone
  setMarkTone: (tone: MarkTone) => void
}

/** 悬停聚焦窗口项 */
export interface FocusWindowItem {
  dot: RailMarker
  distance: number
}

/** 聚焦状态：卡片呈现所需几何 */
export interface FocusState {
  key: string
  items: FocusWindowItem[]
  centerY: number
  left?: number
  right?: number
}

/** 会话列表最小面（useSessions selector） */
export interface SessionListLike {
  current?: unknown
  byId?: Record<string, { blank?: boolean }>
}

/** 翻译函数面 */
export type Translate = (key: string, vars?: Record<string, string | number>) => string

/** 会话选择器面（useSessions 最小面，宿主按风格组件注入） */
export type SessionSelector = <S>(selector: (s: SessionListLike) => S) => S

/** 风格组件统一 props 面（各风格自治实现，但入参一致） */
export interface RailProps {
  injected: NavInjected | undefined
  useSessions?: SessionSelector
  t: Translate
}