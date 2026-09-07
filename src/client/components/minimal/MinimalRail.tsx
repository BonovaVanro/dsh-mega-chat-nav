// 简约风格：圆点轨形态——视觉自治（轨道数据/布局/间谍/翻页/卡片能力经 ../rail 共享，
// 本目录仅保留风格专属部件：MinimalRail 装配 + dot 圆点按钮）
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useMarkerData, usePinning, useReadingSpy, useBandPaging, useCardPreview, useFailureNotice, useLoadingNotice, useFavorites, useMobileMode, useMobileSearchButton, useNavSettings, clockText, markerScale, markerTier, ROW_HEIGHT, usePeekState, useClosePopoversOnOutside } from '../rail/useRail.ts'
import { Dot } from './dot.tsx'
import { Cards } from '../rail/cards.tsx'
import { PagingButton } from '../rail/paging.tsx'
import { Hint } from '../rail/hint.tsx'
import { SearchBox } from '../rail/search.tsx'
import { QuickSettings } from '../rail/quick-settings.tsx'
import { STYLE_CAPABILITIES, BAND_HEIGHT_PX } from '../../settings.ts'


import type { RailMarker } from '../shared/types.ts'
import type { NavInjected, SessionListLike, Translate } from '../shared/types.ts'

export interface MinimalRailProps {
  injected: NavInjected | undefined
  useSessions?: <S>(selector: (s: SessionListLike) => S) => S
  t: Translate
}

export function MinimalRail(props: MinimalRailProps): ReactNode {
  const { injected, useSessions, t } = props
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [jumpingKey, setJumpingKey] = useState<string | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [favFilter, setFavFilter] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  // 鼠标离开导航区域触发一次跟随：仅作 effect 重跑计数（跟随几何复用下方 effect）
  const [followTick, setFollowTick] = useState(0)
  const { showPeek, hidePeek, peekCls } = usePeekState()
  // 上次 hover 命中的圆点 key（同一圆点内 mouseover 高频触发不重复开卡）
  const lastHoverKey = useRef<string | null>(null)

  // 手机模式（<1024px）：仅搜索图标 + 底部半宽搜索抽屉
  const mobile = useMobileMode()

  // 数据与设置
  const { sessionId, visible, markers } = useMarkerData(injected, useSessions)
  const { favorites, toggle: toggleFavorite } = useFavorites(sessionId)
  const settings = useNavSettings(injected)
  const { style, align, bandHeight, cardCount, cardItems, showPaging } = settings
  useMobileSearchButton(() => setDrawerOpen(true), mobile && markers.length > 0, align, t('search.placeholder'))

  // 收藏过滤：派生状态——无收藏数据时自动视为未过滤
  // （取消最后一个收藏立即恢复全部列表，不会困在空过滤态）
  const effectiveFilter = favFilter && favorites.size > 0
  const displayMarkers = effectiveFilter
    ? markers.filter((m) => m.members.some((k) => favorites.has(k)))
    : markers

  // 布局钉位（含导航栏偏移；sessionId 变化 → 校准循环重启，覆盖会话/工作区切换重建）
  usePinning(panelRef, visible, align, settings.railOffset, sessionId)
  const [currentKey, forceKey] = useReadingSpy(visible, displayMarkers)
  const { scrollable, revealed, syncScroll, pageBy, canPageUp, canPageDown } = useBandPaging(listRef, displayMarkers)

  // 悬浮卡片（风格能力）
  const caps = STYLE_CAPABILITIES[style]
  const focusRadius = Math.floor((cardCount - 1) / 2)
  const { focus, openCards, cancelClear, scheduleClear } = useCardPreview(displayMarkers, align, focusRadius, caps.hoverCards)

  // 跳转失败提示 / 加载较早记录提示
  const hint = useFailureNotice(t)
  const loading = useLoadingNotice(t)

  useClosePopoversOnOutside(configOpen, searchOpen, () => {
    setConfigOpen(false)
    setSearchOpen(false)
  })

  // 激活节点跟随：正文滚动时导航列表平滑居中（点击跳转后不冻结）
  useEffect(() => {
    const list = listRef.current
    if (list === null || currentKey === null) return
    const index = displayMarkers.findIndex((d) => d.key === currentKey)
    if (index < 0) return
    const step = ROW_HEIGHT  // 行距 14px（8px 节点 + 6px 间距，与 rail 层几何一致）
    const dotTop = 8 + index * step  // 列表上内边距 8px + 节点位置
    const contentHeight = 16 + displayMarkers.length * step - 6
    const maxScroll = Math.max(0, contentHeight - list.clientHeight)
    const target = Math.max(0, Math.min(dotTop - list.clientHeight / 2 + step / 2, maxScroll))
    if (Math.abs(target - list.scrollTop) < 2) return
    list.scrollTo({ top: target, behavior: 'smooth' })
  }, [currentKey, markers, followTick])   // followTick：鼠标离开 rail 时重跑一次跟随

  if (!visible || injected === undefined || markers.length === 0) return null

  const onJump = (dot: RailMarker): void => {
    if (sessionId === undefined) return
    setJumpingKey(dot.key)
    forceKey(dot.key)   // 点击瞬间强制激活目标（正文滚动稳定后由采样判据接管）
    const currentMarker = currentKey === null ? undefined : displayMarkers.find((m) => m.key === currentKey)
    injected.jump(sessionId, dot.key, dot.seq, currentMarker?.seq)
    window.setTimeout(() => setJumpingKey((k) => (k === dot.key ? null : k)), 600)
  }

  // 事件委托（圆点是 memo 纯展示）：hover 开悬浮卡 / 点击跳转。
  // 用 onMouseOver（真实冒泡，圆点间移动每次触发）而非 onMouseEnter
  // （容器级 mouseenter 只在从外部进入时触发一次——圆点间移动不会换卡）。
  const onDotsOver = (e: React.MouseEvent): void => {
    const el = e.target as HTMLElement
    const hit = el.closest<HTMLElement>('[data-mega-chat-nav-key]')
    if (hit === null) return
    const key = hit.dataset.megaChatNavKey
    if (key === undefined || key === lastHoverKey.current) return
    const dot = displayMarkers.find((d) => d.key === key)
    if (dot === undefined) return
    lastHoverKey.current = key
    cancelClear()
    openCards(dot, hit)
  }
  const onDotsClick = (e: React.MouseEvent): void => {
    const el = e.target as HTMLElement
    const hit = el.closest<HTMLElement>('[data-mega-chat-nav-key]')
    if (hit === null) return
    const key = hit.dataset.megaChatNavKey
    const dot = displayMarkers.find((d) => d.key === key)
    if (dot !== undefined) onJump(dot)
  }

  if (mobile) {
    return (
      <>
        {drawerOpen ? (
          <>
            <div className="mgcn-drawerMask" onClick={() => setDrawerOpen(false)} />
            <div className="mgcn-searchDrawer" role="dialog" aria-label={t('search.placeholder')}>
              <SearchBox
                sessionId={sessionId}
                scopes={settings.searchScopes}
                t={t}
                onJump={(key, seq) => {
                  setDrawerOpen(false)
                  onJump({ key, seq: seq ?? 0, turn: null, time: Date.now(), texts: [], members: [key] })
                }}
                onClose={() => setDrawerOpen(false)}
                emptyContent={
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
                }
              />
            </div>
          </>
        ) : null}
      </>
    )
  }

  const selectedIndex = focus === null ? -1 : displayMarkers.findIndex((d) => d.key === focus?.key)

  return (
    <div
      ref={panelRef}
      className={align === 'right' ? 'mgcn-rail mgcn-railRight' : 'mgcn-rail'}
      data-mega-chat-nav="rail"
      onMouseEnter={showPeek}
      onMouseLeave={() => { hidePeek(); setFollowTick((n) => n + 1) }}  // 离开：触发一次跟随计算
    >
      <div className="mgcn-queue">
        {displayMarkers.length === 0 ? (
          <div className="mgcn-empty">{t('strip.empty')}</div>
        ) : (
          <div
            className="mgcn-list"
            style={{ '--mgcn-band-height': BAND_HEIGHT_PX.minimal[bandHeight] + 'px' } as React.CSSProperties}
          >
            {/* 操作区：.mgcn-list 子级悬浮定位，不占列表高度、不混入圆点流 */}
            <div className="mgcn-actions">
              {settings.showQuickSettings !== 'hide' ? (
                <span className={'mgcn-gear-wrap mgcn-gear-wrap--' + align + peekCls(settings.showQuickSettings, configOpen)}>
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
              ) : null}
              {settings.showFavorites !== 'hide' ? (
                <span className={'mgcn-gear-wrap mgcn-gear-wrap--' + align + peekCls(settings.showFavorites, false)}>
                  <button
                    type="button"
                    className={effectiveFilter ? 'mgcn-config-gear mgcn-favFilterOn' : 'mgcn-config-gear'}
                    aria-label={t('fav.filter')}
                    onClick={() => { if (favorites.size > 0) setFavFilter((v) => !v) }}
                  >
                    <svg className="mgcn-btn-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                      <path d="M8 2.2l1.76 3.56 3.93.57-2.84 2.77.67 3.91L8 11.4l-3.52 1.85.67-3.91-2.84-2.77 3.93-.57z"
                        fill={favFilter ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    </svg>
                  </button>
                </span>
              ) : null}
              {settings.showSearch !== 'hide' ? (
                <span className={'mgcn-gear-wrap mgcn-gear-wrap--' + align + peekCls(settings.showSearch, searchOpen)}>
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
                      scopes={settings.searchScopes}
                      t={t}
                      onJump={(key, seq) => onJump({ key, seq: seq ?? 0, turn: null, time: Date.now(), texts: [], members: [key] })}
                      onClose={() => setSearchOpen(false)}
                    />
                  ) : null}
                </span>
              ) : null}
              {settings.showCount !== 'hide' ? (
                <span className={'mgcn-count' + peekCls(settings.showCount, false)}>{displayMarkers.length}</span>
              ) : null}
            </div>
            {scrollable && showPaging !== 'hide' ? (
              <div className={'mgcn-pageUp' + peekCls(showPaging, false)}>
                <PagingButton
                  dir={-1}
                  visible={canPageUp}
                  label={t('strip.up')}
                  onEnter={cancelClear}
                  onLeave={scheduleClear}
                  onClick={() => pageBy(-1)}
                />
              </div>
            ) : null}
            <div
              ref={listRef}
              className="mgcn-dots"
              onScroll={syncScroll}
              onMouseLeave={() => { lastHoverKey.current = null; scheduleClear() }}
              onMouseOver={onDotsOver}
              onClick={onDotsClick}
            >
              {displayMarkers.map((dot, index) => {
                const isFocused = focus !== null && focus.key === dot.key
                const tier = selectedIndex < 0 ? null : markerTier(index - selectedIndex)
                const scale = jumpingKey === dot.key ? 1.6 : tier !== null ? markerScale(tier) : 1
                const reveal = revealed?.get(dot.key)
                const cls = ['mgcn-dot']
                if (isFocused) cls.push('mgcn-focused')
                if (jumpingKey === dot.key) cls.push('mgcn-active')
                if (currentKey === dot.key) cls.push('mgcn-current')
                if (reveal !== undefined) {
                  cls.push(reveal.dir === 1 ? 'mgcn-dotEnterFromBottom' : 'mgcn-dotEnterFromTop')
                }
                return (
                  <Dot
                    key={dot.key}
                    keyName={dot.key}
                    index={index}
                    className={cls.join(' ')}
                    scale={scale}
                    label={dot.texts[0] ?? ''}
                    focused={isFocused}
                    revealed={reveal}
                  />
                )
              })}
            </div>
            {scrollable && showPaging !== 'hide' ? (
              <div className={'mgcn-pageDown' + peekCls(showPaging, false)}>
                <PagingButton
                  dir={1}
                  visible={canPageDown}
                  label={t('strip.down')}
                  onEnter={cancelClear}
                  onLeave={scheduleClear}
                  onClick={() => pageBy(1)}
                />
              </div>
            ) : null}
          </div>
        )}
      </div>
      {loading !== null ? <Hint text={loading} align={align} position="bottom" loading /> : hint !== null ? <Hint text={hint} align={align} /> : null}
      {focus !== null ? (
        <Cards
          focus={focus}
          align={align}
          cardItems={cardItems}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          onJump={onJump}
          onEnter={cancelClear}
          onLeave={scheduleClear}
        />
      ) : null}
    </div>
  )
}