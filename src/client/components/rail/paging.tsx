// ▲/▼ 翻页按钮（minimal 与 codex 统一三角形态；显示模式由宿主配置 showPaging 控制）
import type { ReactNode } from 'react'

export interface PagingButtonProps {
  dir: 1 | -1
  visible: boolean
  label: string
  onEnter: () => void
  onLeave: () => void
  onClick: () => void
}

export function PagingButton(props: PagingButtonProps): ReactNode {
  const cls = props.dir === -1 ? 'mgcn-navBtn mgcn-navUp' : 'mgcn-navBtn mgcn-navDown'
  return (
    <button
      type="button"
      className={cls}
      aria-label={props.label}
      style={{ visibility: props.visible ? 'visible' : 'hidden' }}
      onMouseEnter={props.onEnter}
      onMouseLeave={props.onLeave}
      onClick={props.onClick}
    />
  )
}
