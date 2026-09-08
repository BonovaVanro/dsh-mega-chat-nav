// 跨风格操作区公共组件（minimal / codex / harness 共用）：
// ⚙ 快捷设置（QuickSettings）、★ 收藏过滤 + 无收藏提示、🔍 搜索（SearchBox）、计数。
// 内部自管 configOpen / searchOpen / favFilter / favHint 状态，三风格行为逐字一致。
import { useRef, useState, type ReactNode } from 'react'
import { SearchBox } from './search.tsx'
import { QuickSettings } from './quick-settings.tsx'
import { useClosePopoversOnOutside } from './useRail.ts'
import type { NavInjected, RailMarker, Translate } from '../shared/types.ts'
import type { RailAlign, SearchScope, ShowMode } from '../../settings.ts'

export interface RailActionsProps {
  showQuickSettings: ShowMode
  showFavorites: ShowMode
  showSearch: ShowMode
  showCount: ShowMode
  searchScopes: readonly SearchScope[]
  align: RailAlign
  t: Translate
  injected: NavInjected
  sessionId: string | undefined
  /** 收藏过滤开关（受控：影响组件层列表过滤） */
  favFilter: boolean
  /** 收藏按钮切换回调（组件层维护 favFilter 状态） */
  onFavToggle: () => void
  favoritesSize: number
  /** 计数显示值 */
  count: number
  /** 搜索结果跳转 */
  onSearchJump: (key: string, seq: number) => void
  /** peek 浮现类（show=peek 且未悬停时附加 mgcn-peek） */
  peekCls: (mode: ShowMode, open: boolean) => string
}

/** 收藏按钮无收藏提示文案（locales key） */
const NO_FAV_HINT_MS = 1800

export function RailActions(props: RailActionsProps): ReactNode {
  const {
    showQuickSettings, showFavorites, showSearch, showCount, searchScopes,
    align, t, injected, sessionId, favFilter, onFavToggle, favoritesSize, count, onSearchJump, peekCls,
  } = props
  const [configOpen, setConfigOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [favHint, setFavHint] = useState(false)
  const favHintTimer = useRef<number | null>(null)
  const showNoFavHint = (): void => {
    setFavHint(true)
    if (favHintTimer.current !== null) window.clearTimeout(favHintTimer.current)
    favHintTimer.current = window.setTimeout(() => { setFavHint(false); favHintTimer.current = null }, NO_FAV_HINT_MS)
  }

  // 点击浮层之外（非 .mgcn-gear-wrap）→ 关闭 config/search 浮层（原三风格各自实现，统一收口）
  useClosePopoversOnOutside(configOpen, searchOpen, () => {
    setConfigOpen(false)
    setSearchOpen(false)
  })

  const configGear =
    <span className={'mgcn-gear-wrap mgcn-gear-wrap--' + align + peekCls(showQuickSettings, configOpen)}>
      <button
        type="button"
        className="mgcn-config-gear"
        aria-label={t('config.title')}
        onClick={() => { setConfigOpen((v) => !v); setSearchOpen(false) }}
      >
        <svg className="mgcn-btn-icon" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
          <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </button>
      {configOpen ? (
        <QuickSettings injected={injected} t={t} onClose={() => setConfigOpen(false)} />
      ) : null}
    </span>

  const favoritesGear =
    <span className={'mgcn-gear-wrap mgcn-gear-wrap--' + align + peekCls(showFavorites, false)}>
      <button
        type="button"
        className={favFilter && favoritesSize > 0 ? 'mgcn-config-gear mgcn-favFilterOn' : 'mgcn-config-gear'}
        aria-label={t('fav.filter')}
        onClick={() => { if (favoritesSize > 0) onFavToggle(); else showNoFavHint() }}
      >
        <svg className="mgcn-btn-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M8 2.2l1.76 3.56 3.93.57-2.84 2.77.67 3.91L8 11.4l-3.52 1.85.67-3.91-2.84-2.77 3.93-.57z"
            fill={favFilter ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      </button>
      {favHint ? <div className="mgcn-favHint">{t('strip.noFavorites')}</div> : null}
    </span>

  const searchGear =
    <span className={'mgcn-gear-wrap mgcn-gear-wrap--' + align + peekCls(showSearch, searchOpen)}>
      <button
        type="button"
        className="mgcn-config-gear"
        aria-label={t('search.placeholder')}
        onClick={() => { setSearchOpen((v) => !v); setConfigOpen(false) }}
      >
        <svg className="mgcn-btn-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <line x1="10.4" y1="10.4" x2="14" y2="14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      {searchOpen ? (
        <SearchBox
          sessionId={sessionId}
          scopes={searchScopes}
          t={t}
          onJump={(key, seq) => onSearchJump(key, seq)}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}
    </span>

  return (
    <div className="mgcn-actions">
      {showQuickSettings !== 'hide' ? configGear : null}
      {showFavorites !== 'hide' ? favoritesGear : null}
      {showSearch !== 'hide' ? searchGear : null}
      {showCount !== 'hide' ? (
        <span className={'mgcn-count' + peekCls(showCount, false)}>{count}</span>
      ) : null}
    </div>
  )
}

export type { RailMarker }
