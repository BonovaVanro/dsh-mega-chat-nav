// 悬浮卡片组（minimal 能力）：内容块由配置多选（轮次 / 用时 / 收藏）控制
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { RailAlign, CardItem } from '../../settings.ts'
import { cardMetrics, metricsLine, clockText } from './useRail.ts'
import type { FocusState, RailMarker } from '../shared/types.ts'

export interface CardsProps {
  focus: FocusState
  align: RailAlign
  /** 显示哪些内容块（多选配置） */
  cardItems: readonly CardItem[]
  /** 收藏集合 */
  favorites: ReadonlySet<string>
  /** 切换收藏（按该轮首问锚点 key） */
  onToggleFavorite: (key: string) => void
  onJump: (dot: RailMarker) => void
  /** 卡片 hover 保活（取消 rail 的清焦定时） */
  onEnter: () => void
  /** 离开卡片后重新排程清焦 */
  onLeave: () => void
}

function favoriteButton(favorited: boolean, onClick: () => void): ReactNode {
  return (
    <button
      type="button"
      className={favorited ? 'mgcn-cardFav mgcn-cardFavOn' : 'mgcn-cardFav'}
      aria-label={favorited ? 'unfavorite' : 'favorite'}
      onClick={(e) => { e.stopPropagation(); onClick() }}
    >
      <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
        <path d="M8 2.2l1.76 3.56 3.93.57-2.84 2.77.67 3.91L8 11.4l-3.52 1.85.67-3.91-2.84-2.77 3.93-.57z"
          fill={favorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

export function Cards(props: CardsProps): ReactNode {
  const { focus, align, cardItems, favorites, onToggleFavorite, onJump, onEnter, onLeave } = props
  const showTurn = cardItems.includes('turn')
  const showDuration = cardItems.includes('duration')
  const showFavorite = cardItems.includes('favorite')
  return createPortal(
    <div
      className={align === 'right' ? 'mgcn-cascade mgcn-cascadeRight' : 'mgcn-cascade'}
      style={{
        ...(focus.left !== undefined ? { left: focus.left } : {}),
        ...(focus.right !== undefined ? { right: focus.right } : {}),
        top: focus.centerY,
        transform: 'translateY(-50%)',
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {focus.items.map((item) => {
        const metrics = cardMetrics(item.distance)
        if (metrics === null) return null
        const isSelected = item.distance === 0
        const dot = item.dot
        const text = dot.texts.join(' · ')
        const cls = isSelected
          ? 'mgcn-card mgcn-cardSelected' + (align === 'right' ? ' mgcn-cardSelectedRight' : '')
          : 'mgcn-card'
        const favorited = favorites.has(dot.key)
        return (
          <div
            key={dot.key}
            className={cls}
            role="button"
            tabIndex={-1}
            style={{ width: metrics.widthPx }}
            onClick={() => onJump(dot)}
          >
            <div className="mgcn-cardHead">
              {showFavorite ? favoriteButton(favorited, () => onToggleFavorite(dot.key)) : null}
              {showTurn && isSelected && dot.turn !== null ? (
                <div className="mgcn-cardTitle">Turn {dot.turn}</div>
              ) : null}
              <div className="mgcn-cardTime">{clockText(dot.time, Date.now())}</div>
            </div>
            {showDuration && dot.metrics !== undefined && isSelected ? (
              <div className="mgcn-cardMetrics">{metricsLine(dot.metrics)}</div>
            ) : null}
            <div
              className={isSelected ? 'mgcn-cardBody' : 'mgcn-cardClamp'}
              style={
                isSelected
                  ? undefined
                  : { WebkitLineClamp: metrics.maxLines, fontSize: metrics.fontSize } as React.CSSProperties
              }
            >
              {text}
            </div>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
