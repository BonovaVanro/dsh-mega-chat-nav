// 跳转失败 / 加载提示（portal 到 body）：
//  - 失败提示：贴 rail 侧顶部（rail 左右对齐）
//  - 加载提示：对话输入框上方细条，水平对齐相对**对话区域**左右边缘（跟随 rail 侧）
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { RailAlign } from '../../settings.ts'
import { conversationRoot } from './useRail.ts'

export interface HintProps {
  text: string
  align: RailAlign
  /** bottom：显示在对话输入框上方（加载较早记录提示），水平对齐跟随对话区域左右边缘 */
  position?: 'rail' | 'bottom'
  /** 加载点动画（仅加载中提示） */
  loading?: boolean
}

/** 对话区域左/右边缘到视口的距离（fixed 定位用；对话列根选择器见 useRail.conversationRoot） */
function conversationEdge(align: RailAlign): number | null {
  const root = conversationRoot()
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

/**
 * 跳转提示组合（四风格 rail + 移动端抽屉共用）：加载中提示（对话区底部细条、
 * 带加载点）优先于失败提示（rail 侧顶部）。
 *
 * 收口原因：移动端分支曾只渲染 MobileDrawer 而提示留在桌面 JSX 里，导致搜索
 * 抽屉跳转未加载消息时看不到「正在加载较早记录」的分页进度——与常态跳转不一致。
 */
export function JumpNotice({ loading, hint, align }: { loading: string | null; hint: string | null; align: RailAlign }): ReactNode {
  if (loading !== null) return <Hint text={loading} align={align} position="bottom" loading />
  if (hint !== null) return <Hint text={hint} align={align} />
  return null
}
