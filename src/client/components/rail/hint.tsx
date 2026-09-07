// 跳转失败 / 加载提示（portal 到 body）：
//  - 失败提示：贴 rail 侧顶部（rail 左右对齐）
//  - 加载提示：对话输入框上方细条，水平对齐相对**对话区域**左右边缘（跟随 rail 侧）
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { RailAlign } from '../../settings.ts'

export interface HintProps {
  text: string
  align: RailAlign
  /** bottom：显示在对话输入框上方（加载较早记录提示），水平对齐跟随对话区域左右边缘 */
  position?: 'rail' | 'bottom'
  /** 加载点动画（仅加载中提示） */
  loading?: boolean
}

/** 对话区域左/右边缘到视口的距离（fixed 定位用） */
function conversationEdge(align: RailAlign): number | null {
  const root = document.querySelector<HTMLElement>('[data-slot="conversation"] > div[data-phase]')
  if (root === null) return null
  const r = root.getBoundingClientRect()
  return align === 'right' ? window.innerWidth - r.right : r.left
}

export function Hint({ text, align, position = 'rail', loading = false }: HintProps): ReactNode {
  const [edge, setEdge] = useState<number | null>(() => conversationEdge(align))

  useEffect(() => {
    const measure = (): void => setEdge(conversationEdge(align))
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [align])

  const cls = position === 'bottom' ? 'mgcn-hint mgcn-hint--bottom' : 'mgcn-hint'
  const style = position === 'bottom'
    ? align === 'right'
      ? { right: (edge ?? 0) + 20, bottom: 150 }
      : { left: (edge ?? 0) + 20, bottom: 150 }
    : align === 'right' ? { right: 52, top: 12 } : { left: 52, top: 12 }
  return createPortal(
    <div className={cls} style={style}>
      {loading ? (
        <span className="mgcn-hint-dots" aria-hidden="true"><i /><i /><i /></span>
      ) : null}
      <span>{text}</span>
    </div>,
    document.body,
  )
}
