// codex 风格：刻度轨形态（时间线式）——风格自治实现（数据/布局/间谍/翻页经 ../rail 共享，
// 本目录自持轨道视觉与 hover 波纹动效；悬浮卡与操作区为跨风格能力组件）
//
// 视觉语言（吸收内化，不复刻类名）：竖向轨道一条淡引导线贯穿条带；每轮一个
// 水平刻度槽（slot），内含一条短横刻度（mark）。刻度静止为短灰条；hover 时
// 本尊刻度横向展开为长亮条，向两侧逐级衰减（±1 中长 / ±2 中短 / ±3 短），
// 形成波纹式展开；阅读位置（current）刻度常亮；跳转目标刻度品牌色闪光。
// 行距 14px 与圆点轨一致（翻页步距 / 跟读滚动对两风格通用）。
import type { ReactNode } from 'react'
import { memo, useEffect, useRef, useState } from 'react'
import { useMarkerData, usePinning, useReadingSpy, useBandPaging, useCardPreview, useFailureNotice, useLoadingNotice, useFavorites, useMobileMode, useMobileSearchButton, useNavSettings, clockText, ROW_HEIGHT, usePeekState, useClosePopoversOnOutside } from '../rail/useRail.ts'
import { Cards } from '../rail/cards.tsx'
import { PagingButton } from '../rail/paging.tsx'
import { Hint } from '../rail/hint.tsx'
import { SearchBox } from '../rail/search.tsx'
import { QuickSettings } from '../rail/quick-settings.tsx'
import { STYLE_CAPABILITIES, BAND_HEIGHT_PX } from '../../settings.ts'
import type { RailMarker, RailProps } from '../shared/types.ts'

/** 刻度槽组件：纯展示（hover 波纹由 CSS 级联完成，React 不参与逐槽状态）——
 *  memo 化后只有 current/jumping/focused/reveal 变化才重渲，长会话 hover 不再整列刷新 */
const CodexSlot = memo(function CodexSlot(props: {
  marker: RailMarker
  current: boolean
  focused: boolean
  jumping: boolean
  label: string
  reveal?: { dir: 1 | -1; order: number }
}): ReactNode {
  const { marker, current, focused, jumping, label, reveal } = props
  const cls = ['mgcn-cxSlot']
  if (focused) cls.push('mgcn-cxFocused')
  if (current) cls.push('mgcn-cxCurrent')
  if (jumping) cls.push('mgcn-cxJump')
  if (reveal !== undefined) cls.push(reveal.dir === 1 ? 'mgcn-cxEnterFromBottom' : 'mgcn-cxEnterFromTop')
  return (
    <button
      type="button"
      className={cls.join(' ')}
      style={reveal !== undefined ? ({ animationDelay: reveal.order * 35 + 'ms' } as React.CSSProperties) : undefined}
      data-mega-chat-nav-key={marker.key}
      aria-label={label}
    >
      <i className="mgcn-cxMark" aria-hidden="true" />
    </button>
  )
})

/** 阅读位置跟随：正文滚动时带内刻度平滑居中（点击跳转后不冻结） */
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
    const slotTop = 8 + index * ROW_HEIGHT
    const contentHeight = 16 + markers.length * ROW_HEIGHT
    const maxScroll = Math.max(0, contentHeight - list.clientHeight)
    const target = Math.max(0, Math.min(slotTop - list.clientHeight / 2 + ROW_HEIGHT / 2, maxScroll))
    if (Math.abs(target - list.scrollTop) < 2) return
    list.scrollTo({ top: target, behavior: 'smooth' })
    // resetKey：鼠标离开导航区域时 bump → effect 重跑一次跟随
  }, [currentKey, markers, resetKey])
}

export function CodexRail(props: RailProps): ReactNode {
  const { injected, useSessions, t } = props
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [jumpingKey, setJumpingKey] = useState<string | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [favFilter, setFavFilter] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  // 鼠标离开导航区域触发一次跟随：仅作 effect 重跑计数
  const [followTick, setFollowTick] = useState(0)
  const { showPeek, hidePeek, peekCls } = usePeekState()
  // 上次 hover 命中的槽 key（同一槽内 mouseover 高频触发不重复开卡）
  const lastHoverKey = useRef<string | null>(null)

  const mobile = useMobileMode()

  const { sessionId, visible, markers } = useMarkerData(injected, useSessions)
  const { favorites, toggle: toggleFavorite } = useFavorites(sessionId)
  const settings = useNavSettings(injected)
  const { style, align, bandHeight, cardCount, cardItems, markTone, showPaging } = settings
  useMobileSearchButton(() => setDrawerOpen(true), mobile && markers.length > 0, align, t('search.placeholder'))

  const effectiveFilter = favFilter && favorites.size > 0
  const displayMarkers = effectiveFilter
    ? markers.filter((m) => m.members.some((k) => favorites.has(k)))
    : markers

  usePinning(panelRef, visible, align, settings.railOffset, sessionId)
  const [currentKey, forceKey] = useReadingSpy(visible, displayMarkers)
  const { scrollable, revealed, syncScroll, pageBy, canPageUp, canPageDown } = useBandPaging(listRef, displayMarkers)

  const caps = STYLE_CAPABILITIES[style]
  const focusRadius = Math.floor((cardCount - 1) / 2)
  const { focus, openCards, cancelClear, scheduleClear } = useCardPreview(displayMarkers, align, focusRadius, caps.hoverCards)

  const hint = useFailureNotice(t)
  const loading = useLoadingNotice(t)


  useClosePopoversOnOutside(configOpen, searchOpen, () => {
    setConfigOpen(false)
    setSearchOpen(false)
  })

  useFollowCurrent(listRef, currentKey, displayMarkers, followTick)

  if (!visible || injected === undefined || markers.length === 0) return null

  const onJump = (slot: RailMarker): void => {
    if (sessionId === undefined) return
    setJumpingKey(slot.key)
    forceKey(slot.key)
    const currentMarker = currentKey === null ? undefined : displayMarkers.find((m) => m.key === currentKey)
    injected.jump(sessionId, slot.key, slot.seq, currentMarker?.seq)
    window.setTimeout(() => setJumpingKey((k) => (k === slot.key ? null : k)), 600)
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

  const hoverOff = (): void => {
    lastHoverKey.current = null
    scheduleClear()
  }

  // 事件委托（槽是 memo 纯展示，事件挂在列表容器上）：
  //  - 用 onMouseOver（真实冒泡，槽间移动每次触发）而非 onMouseEnter
  //    （容器级 mouseenter 只在从外部进入时触发一次，槽间移动不会重开卡）
  //  - hover 命中槽 → 打开/切换到该槽的悬浮卡（波纹由 CSS :hover 完成）
  //  - click 命中槽 → 跳转
  const onListOver = (e: React.MouseEvent): void => {
    const el = e.target as HTMLElement
    const slot = el.closest<HTMLElement>('[data-mega-chat-nav-key]')
    if (slot === null) return
    const key = slot.dataset.megaChatNavKey
    if (key === undefined || key === lastHoverKey.current) return
    const marker = displayMarkers.find((m) => m.key === key)
    if (marker === undefined) return
    lastHoverKey.current = key
    cancelClear()
    openCards(marker, slot)
  }
  const onListClick = (e: React.MouseEvent): void => {
    const el = e.target as HTMLElement
    const slot = el.closest<HTMLElement>('[data-mega-chat-nav-key]')
    if (slot === null) return
    const key = slot.dataset.megaChatNavKey
    const marker = displayMarkers.find((m) => m.key === key)
    if (marker !== undefined) onJump(marker)
  }

  return (
    <div
      ref={panelRef}
      className={align === 'right' ? 'mgcn-rail mgcn-cxRail mgcn-railRight' : 'mgcn-rail mgcn-cxRail'}
      data-mega-chat-nav="rail"
      data-tone={markTone}
      onMouseEnter={showPeek}
      onMouseLeave={() => { hidePeek(); setFollowTick((n) => n + 1) }}  // 离开：触发一次跟随计算
    >
      <div className="mgcn-queue">
        {displayMarkers.length === 0 ? (
          <div className="mgcn-empty">{t('strip.empty')}</div>
        ) : (
          <div
            className={'mgcn-list' + (scrollable && showPaging !== 'hide' ? '' : ' mgcn-listNoPage')}
            style={{ '--mgcn-band-height': BAND_HEIGHT_PX.codex[bandHeight] + 'px' } as React.CSSProperties}
          >
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
                  onLeave={hoverOff}
                  onClick={() => pageBy(-1)}
                />
              </div>
            ) : null}
            <div
              ref={listRef}
              className="mgcn-cxList"
              onScroll={syncScroll}
              onMouseLeave={hoverOff}
              onMouseOver={onListOver}
              onClick={onListClick}
            >
              {displayMarkers.map((slot) => {
                const current = currentKey === slot.key
                const focused = focus !== null && focus.key === slot.key
                const reveal = revealed?.get(slot.key)
                return (
                  <CodexSlot
                    key={slot.key}
                    marker={slot}
                    current={current}
                    focused={focused}
                    jumping={jumpingKey === slot.key}
                    label={slot.texts[0] ?? ''}
                    reveal={reveal}
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
                  onLeave={hoverOff}
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
          onLeave={hoverOff}
        />
      ) : null}
    </div>
  )
}