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
import { useMarkerData, usePinning, useReadingSpy, useBandPaging, useCardPreview, useFailureNotice, useLoadingNotice, useFavorites, useMobileMode, useMobileSearchButton, useNavSettings, useRailJump, ROW_HEIGHT, usePeekState } from '../rail/useRail.ts'
import { Cards } from '../rail/cards.tsx'
import { PagingButton } from '../rail/paging.tsx'
import { JumpNotice } from '../rail/hint.tsx'
import { RailActions } from '../rail/RailActions.tsx'
import { MobileDrawer } from '../rail/MobileDrawer.tsx'
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
        <JumpNotice loading={loading} hint={hint} align={align} />
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
      <JumpNotice loading={loading} hint={hint} align={align} />
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