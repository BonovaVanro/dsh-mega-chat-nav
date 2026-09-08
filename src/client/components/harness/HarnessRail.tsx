// harness 风格：复刻 dsh 原生回合导航栏（TurnNavigator）——悬浮刻度轨，
// 每回合一个短横刻度（tick），hover 弹出预览卡（轮次 + 提问 + 性能指标）；
// 增强（以 Codex 为参照）：hover 波纹展开（本尊 + 邻居逐级衰减）、current 常亮
// 品牌色、跳转目标品牌脉冲、收藏刻度星标、soft/deep 色调档、翻页/跟读复用。
// 数据与交互全部复用 ../rail 共享 hooks；刻度视觉为插件内化实现，不依赖官方 CSS hash。
import type { ReactNode } from 'react'
import { memo, useEffect, useRef, useState } from 'react'
import { useMarkerData, usePinning, useReadingSpy, useBandPaging, useCardPreview, useFailureNotice, useLoadingNotice, useFavorites, useMobileMode, useMobileSearchButton, useNavSettings, useRailJump, usePeekState } from '../rail/useRail.ts'
import { Cards } from '../rail/cards.tsx'
import { PagingButton } from '../rail/paging.tsx'
import { Hint } from '../rail/hint.tsx'
import { RailActions } from '../rail/RailActions.tsx'
import { MobileDrawer } from '../rail/MobileDrawer.tsx'
import { STYLE_CAPABILITIES, BAND_HEIGHT_PX } from '../../settings.ts'
import type { RailMarker, RailProps } from '../shared/types.ts'

/** 刻度行距（px）：对齐官方 TurnNavigator 固定节距 10px */
export const HS_ROW_HEIGHT = 10

/** 刻度 tick：纯展示（hover 波纹由 CSS 级联完成）。memo 化，只有 current/jumping/focused 变化才重渲 */
const HarnessTick = memo(function HarnessTick(props: {
  marker: RailMarker
  current: boolean
  focused: boolean
  jumping: boolean
  favorited: boolean
  unloaded: boolean
  label: string
}): ReactNode {
  const { marker, current, focused, jumping, favorited, unloaded, label } = props
  const cls = ['mgcn-hsTick']
  if (focused) cls.push('mgcn-hsFocused')
  if (current) cls.push('mgcn-hsCurrent')
  if (jumping) cls.push('mgcn-hsJumping')
  if (favorited) cls.push('mgcn-hsFav')
  if (unloaded) cls.push('mgcn-hsTickUnloaded')
  return (
    <button
      type="button"
      className={cls.join(' ')}
      data-mega-chat-nav-key={marker.key}
      aria-label={label}
      title={label}
    >
      <i className="mgcn-hsTickBar" aria-hidden="true" />
      {favorited ? <i className="mgcn-hsTickStar" aria-hidden="true">★</i> : null}
    </button>
  )
})

/** 阅读位置跟随：带内刻度平滑居中（点击跳转后不冻结） */
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
    const slotTop = 8 + index * HS_ROW_HEIGHT
    const contentHeight = 16 + markers.length * HS_ROW_HEIGHT
    const maxScroll = Math.max(0, contentHeight - list.clientHeight)
    const target = Math.max(0, Math.min(slotTop - list.clientHeight / 2 + HS_ROW_HEIGHT / 2, maxScroll))
    if (Math.abs(target - list.scrollTop) < 2) return
    list.scrollTo({ top: target, behavior: 'smooth' })
    // resetKey：鼠标离开导航区域时 bump → effect 重跑一次跟随
  }, [currentKey, markers, resetKey])
}

export function HarnessRail(props: RailProps): ReactNode {
  const { injected, useSessions, t } = props
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [favFilter, setFavFilter] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [followTick, setFollowTick] = useState(0)
  const { showPeek, hidePeek, peekCls } = usePeekState()
  const lastHoverKey = useRef<string | null>(null)

  const mobile = useMobileMode()
  const { sessionId, visible, markers } = useMarkerData(injected, useSessions)
  const { favorites, toggle: toggleFavorite } = useFavorites(sessionId)
  const settings = useNavSettings(injected)
  const { style, align, bandHeight, cardCount, cardItems, markTone, showPaging } = settings
  // 已加载回合集合（chat 窗口内）；窗口外历史回合 → unloaded 短横线（仅 tall 生效）
  const [loadedTurns, setLoadedTurns] = useState<ReadonlySet<number> | null>(null)
  useEffect(() => {
    if (!visible || sessionId === undefined || injected === undefined) { setLoadedTurns(null); return }
    const refresh = (): void => { setLoadedTurns(injected.navLoadedTurns(sessionId)) }
    refresh()
    return injected.subscribeNavLoadedTurns(sessionId, refresh)
  }, [injected, sessionId, visible])
  useMobileSearchButton(() => setDrawerOpen(true), mobile && markers.length > 0, align, t('search.placeholder'))

  const effectiveFilter = favFilter && favorites.size > 0
  const displayMarkers = effectiveFilter
    ? markers.filter((m) => m.members.some((k) => favorites.has(k)))
    : markers

  usePinning(panelRef, visible, align, settings.railOffset, sessionId)
  const [currentKey, forceKey] = useReadingSpy(visible, displayMarkers)
  const { scrollable, syncScroll, pageBy, canPageUp } = useBandPaging(listRef, displayMarkers)

  const caps = STYLE_CAPABILITIES[style]
  const focusRadius = Math.floor((cardCount - 1) / 2)
  const { focus, openCards, cancelClear, scheduleClear } = useCardPreview(displayMarkers, align, focusRadius, caps.hoverCards)

  const hint = useFailureNotice(t)
  const loading = useLoadingNotice(t)

  useFollowCurrent(listRef, currentKey, displayMarkers, followTick)

  // 跳转（共用 hook）：脉冲 + 阅读位强制激活 + loadThrough 跳转（hooks 规则：须在条件 return 前）
  const [jumpingKey, onJump] = useRailJump(sessionId, injected, displayMarkers, currentKey, forceKey)

  if (!visible || injected === undefined || markers.length === 0) return null


  if (mobile) {
    return (
      <>
        <MobileDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          sessionId={sessionId}
          scopes={settings.searchScopes}
          t={t}
          markers={markers}
          onJump={(key, seq) => {
            setDrawerOpen(false)
            onJump({ key, seq: seq ?? 0, turn: null, time: Date.now(), texts: [], members: [key] })
          }}
        />
      </>
    )
  }

  const hoverOff = (): void => {
    lastHoverKey.current = null
    scheduleClear()
  }

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
      className={align === 'right' ? 'mgcn-rail mgcn-hsRail mgcn-railRight' : 'mgcn-rail mgcn-hsRail'}
      data-mega-chat-nav="rail"
      data-tone={markTone}
      onMouseEnter={showPeek}
      onMouseLeave={() => { hidePeek(); setFollowTick((n) => n + 1) }}
    >
      <div className="mgcn-queue">
        {displayMarkers.length === 0 ? (
          <div className="mgcn-empty">{t('strip.empty')}</div>
        ) : (
          <div
            className={'mgcn-list' + (scrollable && showPaging !== 'hide' ? '' : ' mgcn-listNoPage')}
            style={{ '--mgcn-band-height': BAND_HEIGHT_PX.harness[bandHeight] + 'px' } as React.CSSProperties}
          >
            <RailActions
              showQuickSettings={settings.showQuickSettings}
              showFavorites={settings.showFavorites}
              showSearch={settings.showSearch}
              showCount={settings.showCount}
              searchScopes={settings.searchScopes}
              align={align}
              t={t}
              injected={injected}
              sessionId={sessionId}
              favFilter={favFilter}
              onFavToggle={() => setFavFilter((v) => !v)}
              favoritesSize={favorites.size}
              count={displayMarkers.length}
              onSearchJump={(key, seq) => onJump({ key, seq: seq ?? 0, turn: null, time: Date.now(), texts: [], members: [key] })}
              peekCls={peekCls}
            />
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
              className="mgcn-hsList"
              onScroll={syncScroll}
              onMouseLeave={hoverOff}
              onMouseOver={onListOver}
              onClick={onListClick}
            >
              {displayMarkers.map((marker) => {
                const isFocused = focus !== null && focus.key === marker.key
                const current = currentKey === marker.key
                const jumping = jumpingKey === marker.key
                const favorited = marker.members.some((k) => favorites.has(k))
                // unloaded：回合不在 chat 已加载窗口 → 顶部历史段显示超短横线（所有节点栏高度生效）
                const unloaded = loadedTurns !== null
                  && marker.turn !== null && !loadedTurns.has(marker.turn)
                return (
                  <HarnessTick
                    key={marker.key}
                    marker={marker}
                    current={current}
                    focused={isFocused}
                    jumping={jumping}
                    favorited={favorited}
                    unloaded={unloaded}
                    label={marker.texts[0] ?? (marker.turn !== null ? 'Turn ' + marker.turn : '')}
                  />
                )
              })}
            </div>
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
            {loading !== null ? <Hint text={loading} align={align} position="bottom" loading /> : hint !== null ? <Hint text={hint} align={align} /> : null}
          </div>
        )}
      </div>
    </div>
  )
}
