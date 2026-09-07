// 自足完整配置入口：宿主（mega-settings）已收纳时让位提示，否则渲染完整配置页
import { useEffect, useState, type ReactNode } from 'react'
import type { NavInjected, Translate } from '../shared/types.ts'
import { SettingsPage } from './SettingsPage.tsx'

interface SlotsLike {
  entries?(key: string): readonly unknown[]
  subscribe?(key: string, fn: () => void): () => void
}

export interface StandaloneSettingsProps {
  injected: NavInjected
  slots?: SlotsLike
  t: Translate
}

export function StandaloneSettings(props: StandaloneSettingsProps): ReactNode {
  const [hosted, setHosted] = useState(false)
  useEffect(() => {
    const check = () => {
      const n = props.slots?.entries?.('mega.settings.member')?.length ?? 0
      setHosted(n > 0)
    }
    check()
    return props.slots?.subscribe?.('mega.settings.member', check)
  }, [props.slots])
  return <SettingsPage injected={props.injected} t={props.t} hosted={hosted} />
}
