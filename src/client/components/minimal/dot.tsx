// 圆点按钮：纯展示（缩放/跳转/翻页弹出状态由父级 memo 前算好）——
// memo 化后长会话 hover 不再整列重渲；事件由列表容器委托
import { memo, type ReactNode } from 'react'

export interface DotProps {
  /** 缩放（聚焦模型输出；跳转中 1.6） */
  scale: number
  className: string
  label: string
  index: number
  keyName: string
  focused: boolean
  revealed?: { dir: 1 | -1; order: number }
}

export const Dot = memo(function Dot(props: DotProps): ReactNode {
  const { scale, className, label, index, keyName, focused, revealed } = props
  return (
    <button
      type="button"
      className={className}
      style={{
        transform: 'scale(' + scale + ')',
        ...(revealed !== undefined ? { animationDelay: revealed.order * 35 + 'ms' } : {}),
      }}
      data-mega-chat-nav-focused={focused ? 'true' : undefined}
      data-mega-chat-nav-index={index}
      data-mega-chat-nav-key={keyName}
      aria-label={label}
    />
  )
})
