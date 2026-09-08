// 跨风格移动端搜索抽屉公共组件（minimal / codex / harness 共用）：
// 遮罩 + 底部抽屉 + SearchBox（空态显示全部轮次列表）。
import type { ReactNode } from 'react'
import { SearchBox } from './search.tsx'
import { clockText } from './useRail.ts'
import type { RailMarker, Translate } from '../shared/types.ts'
import type { SearchScope } from '../../settings.ts'

export interface MobileDrawerProps {
  open: boolean
  onClose: () => void
  sessionId: string | undefined
  scopes: readonly SearchScope[]
  t: Translate
  markers: readonly RailMarker[]
  /** 搜索结果跳转（key, seq） */
  onJump: (key: string, seq: number) => void
}

export function MobileDrawer(props: MobileDrawerProps): ReactNode {
  const { open, onClose, sessionId, scopes, t, markers, onJump } = props
  if (!open) return null
  return (
    <>
      <div className="mgcn-drawerMask" onClick={onClose} />
      <div className="mgcn-searchDrawer" role="dialog" aria-label={t('search.placeholder')}>
        <SearchBox
          sessionId={sessionId}
          scopes={scopes}
          t={t}
          onJump={onJump}
          onClose={onClose}
          emptyContent={
            <div className="mgcn-drawerList">
              {[...markers].reverse().slice(0, 20).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className="mgcn-drawerItem"
                  onClick={() => { onClose(); onJump(m.key, m.seq) }}
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
  )
}
