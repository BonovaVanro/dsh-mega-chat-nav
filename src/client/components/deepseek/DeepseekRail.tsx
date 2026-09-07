// deepseek 风格：用户消息面板——风格自治实现（数据/布局/间谍经 ../rail 共享）。
//
// 形态：常态 30px 窄轨（每轮行首 8×2 短横把手）；hover（JS 状态驱动）展开
//   280px 面板：面板头 = 操作区独立一行，面板体 = 用户消息列表（30px 行 / 14px 字）。
//   交互（全部 JS 状态驱动）：
//   - 行 hover：该行横线变为收藏按钮（点击收藏/取消），离开恢复横线；
//   - 点 🔍：操作区变为搜索框（仅保留搜索钮 + 输入），列表随输入变动，清空/Esc/再点还原；
//     搜索态鼠标移出面板**不收起**，仅点击外部才关闭；
//   - 点 ⚙：导航面板收起（还原未 hover 的 30px 窄轨），弹出**通用设置浮层**（rail 对话侧）；
//   - 收藏筛选 ⭐ 开启后同搜索：移出不收起，仅点击外部关闭；取消最后一个收藏自动退出筛选；
//   - 点击外部（rail 与浮层之外）：关闭展开/搜索/设置/收藏筛选并还原列表。
import type { ReactNode } from 'react'
import { memo, useEffect, useRef, useState } from 'react'
import { useMarkerData, usePinning, useReadingSpy, useFailureNotice, useLoadingNotice, useFavorites, useMobileMode, useMobileSearchButton, useNavSettings, clockText } from '../rail/useRail.ts'
import { Hint } from '../rail/hint.tsx'
import { fetchHits, type SearchHit } from '../rail/search.tsx'
import { QuickSettings } from '../rail/quick-settings.tsx'
import { BAND_HEIGHT_PX } from '../../settings.ts'
import type { RailMarker, RailProps } from '../shared/types.ts'

/** deepseek 消息行高（px）：行高 30px = 行距几何（文字 14px） */
const DS_ROW_HEIGHT = 30

/** 消息行：行首横线（hover 变收藏按钮）+ 用户消息单行预览 */
const DsRow = memo(function DsRow(props: {
  marker: RailMarker
  current: boolean
  jumping: boolean
  hovered: boolean
  favorited: boolean
  label: string
  onHover: () => void
  onLeave: () => void
  onToggleFavorite: () => void
  onJump: () => void
}): ReactNode {
  const { marker, current, jumping, hovered, favorited, label, onHover, onLeave, onToggleFavorite, onJump } = props
  const cls = ['mgcn-dsRow']
  if (current) cls.push('mgcn-dsCurrent')
  if (jumping) cls.push('mgcn-dsJump')
  if (hovered) cls.push('mgcn-dsRowHover')
  return (
    <div
      className={cls.join(' ')}
      data-mega-chat-nav-key={marker.key}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      {hovered ? (
        <button
          type="button"
          className={favorited ? 'mgcn-dsFav mgcn-dsFavOn' : 'mgcn-dsFav'}
          aria-label={favorited ? 'unfavorite' : 'favorite'}
          onClick={(e) => { e.stopPropagation(); onToggleFavorite() }}
        >
          <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
            <path d="M8 2.2l1.76 3.56 3.93.57-2.84 2.77.67 3.91L8 11.4l-3.52 1.85.67-3.91-2.84-2.77 3.93-.57z"
              fill={favorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
        </button>
      ) : (
        <i className="mgcn-dsMark" aria-hidden="true" />
      )}
      <button type="button" className="mgcn-dsText" aria-label={label} onClick={onJump}>
        <span className="mgcn-dsTextInner">{marker.texts[0] ?? ''}</span>
      </button>
    </div>
  )
})

/** 就地搜索结果行（点击跳转） */
function SearchHitRow(props: { hit: SearchHit; onJump: () => void }): ReactNode {
  const { hit, onJump } = props
  const roleTag = hit.role === 'assistant' ? '助手' : hit.role === 'tool' ? '工具' : '用户'
  return (
    <button type="button" className="mgcn-dsHit" onClick={onJump}>
      <i className="mgcn-dsMark" aria-hidden="true" />
      <span className="mgcn-dsHitBody">
        <span className="mgcn-dsHitMeta">
          {hit.turn > 0 ? <span>第 {hit.turn} 轮</span> : null}
          <span className={'mgcn-dsHitTag mgcn-dsHitTag--' + hit.role}>{roleTag}</span>
        </span>
        <span className="mgcn-dsHitText">
          {hit.hitStart >= 0 && hit.hitLen > 0 ? (
            <>
              {hit.snippet.slice(0, hit.hitStart)}
              <mark className="mgcn-search-mark">{hit.snippet.slice(hit.hitStart, hit.hitStart + hit.hitLen)}</mark>
              {hit.snippet.slice(hit.hitStart + hit.hitLen)}
            </>
          ) : hit.snippet}
        </span>
      </span>
    </button>
  )
}

/** 阅读位置跟随：正文滚动时面板内当前行平滑居中。
 *  resetKey：外部事件计数（退出搜索 searchOpen / 鼠标离开 rail followTick），
 *  变化时强制重新居中到当前行——即使 currentKey/markers 未变也执行一次跟随。 */
function useFollowCurrent(
  listRef: { current: HTMLDivElement | null },
  currentKey: string | null,
  markers: readonly RailMarker[],
  resetKey?: boolean | number | string,
): void {
  useEffect(() => {
    const list = listRef.current
    if (list === null || currentKey === null) return
    const index = markers.findIndex((d) => d.key === currentKey)
    if (index < 0) return
    const slotTop = index * DS_ROW_HEIGHT
    const contentHeight = markers.length * DS_ROW_HEIGHT + 12
    const maxScroll = Math.max(0, contentHeight - list.clientHeight)
    const target = Math.max(0, Math.min(slotTop - list.clientHeight / 2 + DS_ROW_HEIGHT / 2, maxScroll))
    if (Math.abs(target - list.scrollTop) < 2) return
    list.scrollTo({ top: target, behavior: 'smooth' })
  }, [currentKey, markers, resetKey])
}

export function DeepseekRail(props: RailProps): ReactNode {
  const { injected, useSessions, t } = props
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)          // JS hover 展开态（不用 CSS :hover）
  const [jumpingKey, setJumpingKey] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [favFilter, setFavFilter] = useState(false)
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const closeTimer = useRef<number | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)   // 检索进行中（列表 loading 态）
  // 鼠标离开导航区域触发一次跟随：并入 resetKey 使跟随 effect 重跑（几何复用，无新增计算）
  const [followTick, setFollowTick] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<number | null>(null)

  const mobile = useMobileMode()

  const { sessionId, visible, markers } = useMarkerData(injected, useSessions)
  const { favorites, toggle: toggleFavorite } = useFavorites(sessionId)
  const settings = useNavSettings(injected)
  const { align, bandHeight } = settings
  useMobileSearchButton(() => setDrawerOpen(true), mobile && markers.length > 0, align, t('search.placeholder'))

  const effectiveFilter = favFilter && favorites.size > 0
  const displayMarkers = effectiveFilter
    ? markers.filter((m) => m.members.some((k) => favorites.has(k)))
    : markers

  usePinning(panelRef, visible, align, settings.railOffset, sessionId)
  const [currentKey, forceKey] = useReadingSpy(visible, displayMarkers)

  const hint = useFailureNotice(t)
  const loading = useLoadingNotice(t)

  useFollowCurrent(listRef, currentKey, displayMarkers, String(searchOpen) + ':' + followTick)

  // 一键复位：收起面板并关闭全部就地模式（搜索/设置/收藏筛选），列表还原
  const collapseToIdle = (): void => {
    cancelClose()
    setOpen(false)
    setHoverKey(null)
    setSearchOpen(false)
    setQuery('')
    setResults([])
    setSearching(false)
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    abortRef.current?.abort()
    setConfigOpen(false)
    setFavFilter(false)
  }
  // 展开/收起 JS 状态：进入即开，离开延迟 260ms 收。
  // 就地模式（搜索/设置）开启时移出**不收起**——只有点击外部才关闭。
  const cancelClose = (): void => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  const scheduleClose = (): void => {
    cancelClose()
    if (searchOpen || configOpen || effectiveFilter) return
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      collapseToIdle()
    }, 260)
  }
  // 复位函数经 ref 提供给稳定的全局监听（点击外部）
  const collapseToIdleRef = useRef(collapseToIdle)
  collapseToIdleRef.current = collapseToIdle

  // 点击外部（rail 及就地浮层之外）：收起面板并复位全部就地状态
  useEffect(() => {
    const onDocPointerDown = (e: PointerEvent): void => {
      const panel = panelRef.current
      if (panel === null) return
      const t = e.target
      if (t instanceof Node && panel.contains(t)) return
      collapseToIdleRef.current?.()
    }
    document.addEventListener('pointerdown', onDocPointerDown, true)
    return () => document.removeEventListener('pointerdown', onDocPointerDown, true)
  }, [])

  // 卸载清理
  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    abortRef.current?.abort()
  }, [])

  // 搜索：就地输入防抖 → host 检索（进行中列表进入 loading 态）
  const runSearch = (raw: string): void => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    const q = raw.trim()
    if (q.length < 1) { setResults([]); setSearching(false); return }
    setSearching(true)
    fetchHits(sessionId, q, settings.searchScopes, ac.signal)
      .then((hits) => {
        if (abortRef.current !== ac) return
        setResults(hits)
        setSearching(false)
      })
      .catch(() => { if (abortRef.current === ac) setSearching(false) })
  }
  const onSearchInput = (value: string): void => {
    setQuery(value)
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    if (value.trim() === '') {
      // 清空：取消在途检索并还原列表（不再等防抖）
      debounceRef.current = null
      abortRef.current?.abort()
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)     // 输入即 loading（含防抖窗口），结果到达后熄灭
    // 250ms 防抖：连续输入只触发一次检索
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null
      runSearch(value)
    }, 250)
  }
  const openSearch = (): void => {
    cancelClose()
    setConfigOpen(false)
    setFavFilter(false)       // 搜索替代收藏筛选：全量历史检索
    setSearchOpen(true)
    setOpen(true)             // 搜索就地态要求面板保持展开（移出不收）
    window.setTimeout(() => searchInputRef.current?.focus(), 30)
  }
  // 收藏行切换：筛选态下取消「最后一个收藏」→ 自动退出收藏模式
  // （再点行收藏只 +1 收藏，不再自动进入筛选；需点操作栏 ⭐ 才重新进入）
  const onToggleRowFavorite = (key: string): void => {
    const removingLast = effectiveFilter && favorites.size === 1 && favorites.has(key)
    toggleFavorite(key)
    if (removingLast) setFavFilter(false)
  }
  const closeSearch = (): void => {
    cancelClose()
    setSearchOpen(false)
    setQuery('')
    setResults([])
    setSearching(false)
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    abortRef.current?.abort()
    // 还原时指针已不在 rail 上 → 一并收起；仍在 rail 上则保持展开
    if (panelRef.current !== null && !panelRef.current.matches(':hover')) {
      setOpen(false)
      setHoverKey(null)
    }
  }
  // ⚙：消息面板收起（还原未 hover 的窄轨）+ 弹出通用设置浮层（rail 对话侧）
  const toggleConfig = (): void => {
    cancelClose()
    if (configOpen) {
      setConfigOpen(false)
      setHoverKey(null)
      // 点击浮层 ✕/外部后若指针已离开 rail 区域则整体收起
      if (panelRef.current !== null && !panelRef.current.matches(':hover')) {
        setOpen(false)
      }
      return
    }
    closeSearch()
    setOpen(false)
    setHoverKey(null)
    setConfigOpen(true)
  }

  if (!visible || injected === undefined || markers.length === 0) return null

  const onJump = (row: RailMarker): void => {
    if (sessionId === undefined) return
    setJumpingKey(row.key)
    forceKey(row.key)
    const currentMarker = currentKey === null ? undefined : displayMarkers.find((m) => m.key === currentKey)
    injected.jump(sessionId, row.key, row.seq, currentMarker?.seq)
    window.setTimeout(() => setJumpingKey((k) => (k === row.key ? null : k)), 600)
  }
  const onJumpHit = (hit: SearchHit): void => {
    if (sessionId === undefined) return
    setJumpingKey(hit.key)
    forceKey(hit.key)
    injected.jump(sessionId, hit.key, hit.seq)
    window.setTimeout(() => setJumpingKey((k) => (k === hit.key ? null : k)), 600)
  }

  if (mobile) {
    return (
      <>
        {drawerOpen ? (
          <>
            <div className="mgcn-drawerMask" onClick={() => setDrawerOpen(false)} />
            <div className="mgcn-searchDrawer" role="dialog" aria-label={t('search.placeholder')}>
              <div className="mgcn-drawerInput">
                <input
                  className="mgcn-search-input"
                  value={query}
                  placeholder={t('search.placeholder')}
                  autoFocus
                  onChange={(e) => onSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setDrawerOpen(false) }}
                />
              </div>
              {query.trim() === '' ? (
                <div className="mgcn-drawerList">
                  {[...markers].reverse().slice(0, 20).map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      className="mgcn-drawerItem"
                      onClick={() => { setDrawerOpen(false); onJump(m) }}
                    >
                      <span className="mgcn-drawerItemTitle">
                        <span className="mgcn-drawerItemTurn">{m.turn !== null ? 'Turn ' + m.turn : ''}</span>
                        <span className="mgcn-drawerItemTime">{clockText(m.time, Date.now())}</span>
                      </span>
                      <span className="mgcn-drawerItemText">{m.texts[0] ?? ''}</span>
                    </button>
                  ))}
                </div>
              ) : searching ? (
                <div className="mgcn-drawerList">
                  <div className="mgcn-dsLoadingRow" role="status">
                    <span className="mgcn-dsLoadingDots" aria-hidden="true"><i /><i /><i /></span>
                    <span>{t('search.loading')}</span>
                  </div>
                </div>
              ) : (
                <div className="mgcn-drawerList">
                  {results.map((hit) => (
                    <SearchHitRow key={hit.key + ':' + hit.seq} hit={hit} onJump={() => { setDrawerOpen(false); onJumpHit(hit) }} />
                  ))}
                  {results.length === 0 ? <div className="mgcn-dsNoHit">{t('search.empty')}</div> : null}
                </div>
              )}
            </div>
          </>
        ) : null}
      </>
    )
  }

  const messagesBody = (scrollable: boolean): ReactNode => (
    <div ref={scrollable ? listRef : undefined} className="mgcn-dsList">
      {displayMarkers.map((row) => (
        <DsRow
          key={row.key}
          marker={row}
          current={currentKey === row.key}
          jumping={jumpingKey === row.key}
          hovered={hoverKey === row.key}
          favorited={favorites.has(row.key)}
          label={row.texts[0] ?? ''}
          onHover={() => setHoverKey(row.key)}
          onLeave={() => setHoverKey((k) => (k === row.key ? null : k))}
          onToggleFavorite={() => onToggleRowFavorite(row.key)}
          onJump={() => onJump(row)}
        />
      ))}
    </div>
  )

  return (
    <div
      ref={panelRef}
      className={
        (align === 'right' ? 'mgcn-rail mgcn-dsRail mgcn-railRight' : 'mgcn-rail mgcn-dsRail')
        + (open ? ' mgcn-dsOpen' : '')
        + (configOpen ? ' mgcn-dsSnap' : '')   // 设置浮层开启：rail 收起窄轨（无过渡、层级抬升）
      }
      data-mega-chat-nav="rail"
      onMouseEnter={() => { cancelClose(); if (!configOpen) setOpen(true) }}  // 设置浮层开启时不随 hover 展开
      onMouseLeave={() => { setFollowTick((n) => n + 1); scheduleClose() }}  // 离开：先触发一次跟随，再按原调度收起
    >
      <div className="mgcn-queue">
        {displayMarkers.length === 0 ? (
          <div className="mgcn-empty">{t('strip.empty')}</div>
        ) : (
          <div
            className="mgcn-list"
            style={{ '--mgcn-band-height': BAND_HEIGHT_PX.deepseek[bandHeight] + 'px' } as React.CSSProperties}
          >
            <div role="menu" className="mgcn-dsPanel">
              {/* 面板头：操作区独立一行。搜索开启时变为「搜索钮 + 输入框」 */}
              <div className="mgcn-dsHead">
                {settings.showSearch !== 'hide' ? (
                  searchOpen ? (
                    <>
                      <button
                        type="button"
                        className="mgcn-config-gear mgcn-dsModeOn"
                        aria-label={t('search.placeholder')}
                        onClick={closeSearch}
                      >
                        <svg className="mgcn-btn-icon" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                          <line x1="10.4" y1="10.4" x2="14" y2="14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                      </button>
                      <input
                        ref={searchInputRef}
                        className="mgcn-dsSearchInput"
                        value={query}
                        placeholder={t('search.placeholder')}
                        onChange={(e) => onSearchInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') closeSearch() }}
                      />
                    </>
                  ) : (
                    <button
                      type="button"
                      className="mgcn-config-gear"
                      aria-label={t('search.placeholder')}
                      onClick={openSearch}
                    >
                      <svg className="mgcn-btn-icon" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                        <line x1="10.4" y1="10.4" x2="14" y2="14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                    </button>
                  )
                ) : null}
                {!searchOpen && settings.showQuickSettings !== 'hide' ? (
                  <button
                    type="button"
                    className={configOpen ? 'mgcn-config-gear mgcn-dsModeOn' : 'mgcn-config-gear'}
                    aria-label={t('config.title')}
                    onClick={toggleConfig}
                  >
                    <svg className="mgcn-btn-icon" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.7" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                    </svg>
                  </button>
                ) : null}
                {!searchOpen && settings.showFavorites !== 'hide' ? (
                  <button
                    type="button"
                    className={effectiveFilter ? 'mgcn-config-gear mgcn-favFilterOn' : 'mgcn-config-gear'}
                    aria-label={t('fav.filter')}
                    onClick={() => { if (favorites.size > 0) setFavFilter((v) => !v) }}
                  >
                    <svg className="mgcn-btn-icon" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                      <path d="M8 2.2l1.76 3.56 3.93.57-2.84 2.77.67 3.91L8 11.4l-3.52 1.85.67-3.91-2.84-2.77 3.93-.57z"
                        fill={favFilter ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    </svg>
                  </button>
                ) : null}
                {!searchOpen && settings.showCount !== 'hide' ? (
                  <span className="mgcn-count">{displayMarkers.length}</span>
                ) : null}
              </div>
              {/* 面板体：消息 / 就地搜索（⚙ 设置已改由带外浮层承载，不占面板体） */}
              {searchOpen ? (
                <div className="mgcn-dsMode">
                  {query.trim() === '' ? (
                    messagesBody(false)
                  ) : searching ? (
                    <div className="mgcn-dsLoadingRow" role="status">
                      <span className="mgcn-dsLoadingDots" aria-hidden="true"><i /><i /><i /></span>
                      <span>{t('search.loading')}</span>
                    </div>
                  ) : (
                    <div className="mgcn-dsList">
                      {results.map((hit) => (
                        <SearchHitRow key={hit.key + ':' + hit.seq} hit={hit} onJump={() => onJumpHit(hit)} />
                      ))}
                      {results.length === 0 ? <div className="mgcn-dsNoHit">{t('search.empty')}</div> : null}
                    </div>
                  )}
                </div>
              ) : (
                messagesBody(true)
              )}
            </div>
            {/* 设置浮层：挂在 band 盒（.mgcn-list 为定位上下文）角上，rail 收起窄轨时浮于对话侧 */}
            {configOpen ? (
              <span className={'mgcn-gear-wrap mgcn-gear-wrap--' + align + ' mgcn-dsFloat'}>
                <QuickSettings injected={injected} t={t} onClose={() => { cancelClose(); setConfigOpen(false); setHoverKey(null) }} />
              </span>
            ) : null}
          </div>
        )}
      </div>
      {loading !== null ? <Hint text={loading} align={align} position="bottom" loading /> : hint !== null ? <Hint text={hint} align={align} /> : null}
    </div>
  )
}