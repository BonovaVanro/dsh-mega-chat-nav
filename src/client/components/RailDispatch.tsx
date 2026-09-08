// 风格分发：按当前配置的 style 挂载对应风格轨组件（minimal 圆点轨 / codex 刻度轨）。
// 风格配置各自独立（styles.<style> 段），此处仅做选择——切换风格即卸载/重挂风格轨。
import { useEffect, useState, type ReactNode } from 'react'
import type { NavStyle } from '../settings.ts'
import { DEFAULT_STYLE } from '../settings.ts'
import type { NavInjected, SessionSelector, Translate } from './shared/types.ts'
import { MinimalRail } from './minimal/MinimalRail.tsx'
import { CodexRail } from './codex/CodexRail.tsx'
import { DeepseekRail } from './deepseek/DeepseekRail.tsx'
import { HarnessRail } from './harness/HarnessRail.tsx'

export interface RailDispatchProps {
  injected: NavInjected | undefined
  useSessions?: SessionSelector
  t: Translate
}

export function RailDispatch(props: RailDispatchProps): ReactNode {
  const [style, setStyle] = useState<NavStyle>(() => props.injected?.style() ?? DEFAULT_STYLE)
  useEffect(() => {
    if (props.injected === undefined) return
    return props.injected.subscribeSettings(() => setStyle(props.injected?.style() ?? DEFAULT_STYLE))
  }, [props.injected])
  const railProps = { injected: props.injected, useSessions: props.useSessions, t: props.t }
  if (style === 'codex') return <CodexRail {...railProps} />
  if (style === 'deepseek') return <DeepseekRail {...railProps} />
  if (style === 'harness') return <HarnessRail {...railProps} />
  return <MinimalRail {...railProps} />
}