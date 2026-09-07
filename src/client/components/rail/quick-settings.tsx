// 快捷设置面板：对齐/条带高度/卡片数（能力感知）+ 显示模式
import { useEffect, useState, type ReactNode } from 'react'
import { ALIGN_OPTIONS, BAND_OPTIONS, CARD_OPTIONS, MARK_TONE_OPTIONS, SHOW_OPTIONS, STYLE_CAPABILITIES, type BandHeight, type CardCount, type MarkTone, type RailAlign, type ShowMode } from '../../settings.ts'
import type { NavInjected, Translate } from '../shared/types.ts'

export interface QuickSettingsProps {
  injected: NavInjected
  t: Translate
  onClose: () => void
}

function Seg<T extends string | number>(props: { options: readonly T[]; value: T; labels: Record<string, string>; onPick: (v: T) => void }): ReactNode {
  return (
    <div className="mgcn-segmented" role="radiogroup">
      {props.options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={props.value === o}
          className={props.value === o ? 'mgcn-segment mgcn-segmentActive' : 'mgcn-segment'}
          onClick={() => props.onPick(o)}
        >
          {props.labels[String(o)] ?? String(o)}
        </button>
      ))}
    </div>
  )
}

function ModeSeg({ value, onChange, t }: { value: ShowMode; onChange(v: ShowMode): void; t: Translate }): ReactNode {
  return (
    <Seg
      options={SHOW_OPTIONS}
      value={value}
      labels={{
        show: t('config.showMode.show'),
        peek: t('config.showMode.peek'),
        hide: t('config.showMode.hide'),
      }}
      onPick={(v) => onChange(v)}
    />
  )
}

function useSettingsTick(subscribe: NavInjected['subscribeSettings']): void {
  const [, bump] = useState(0)
  useEffect(() => subscribe(() => bump((n) => n + 1)), [subscribe])
}

export function QuickSettings(props: QuickSettingsProps): ReactNode {
  const { injected, t, onClose } = props
  useSettingsTick(injected.subscribeSettings)
  const caps = STYLE_CAPABILITIES[injected.style()]
  return (
    <div className="mgcn-config-panel" role="dialog" aria-label={t('config.title')}>
      <div className="mgcn-config-head">
        <span className="mgcn-config-title">{t('config.style.' + injected.style())} · {t('config.settings')}</span>
        <button type="button" className="mgcn-config-close" aria-label={t('config.close')} onClick={onClose}>✕</button>
      </div>
      <div className="mgcn-config-row">
        <span className="mgcn-config-label">{t('config.align')}</span>
        <Seg
          options={ALIGN_OPTIONS}
          value={injected.align()}
          labels={{ left: t('settings.align.left'), right: t('settings.align.right') }}
          onPick={(v: RailAlign) => injected.setAlign(v)}
        />
      </div>
      <div className="mgcn-config-row">
        <span className="mgcn-config-label">{t('config.bandHeight')}</span>
        <Seg
          options={BAND_OPTIONS}
          value={injected.bandHeight()}
          labels={{
            compact: t('config.bandHeight.compact'),
            standard: t('config.bandHeight.standard'),
            tall: t('config.bandHeight.tall'),
          }}
          onPick={(v: BandHeight) => injected.setBandHeight(v)}
        />
      </div>
      {caps.hoverCards ? (
        <div className="mgcn-config-row">
          <span className="mgcn-config-label">{t('config.cardCount')}</span>
          <Seg
            options={CARD_OPTIONS}
            value={injected.cardCount()}
            labels={{ 1: '1', 3: '3', 5: '5' }}
            onPick={(v: CardCount) => injected.setCardCount(v)}
          />
        </div>
      ) : null}
      {injected.style() === 'codex' ? (
        <div className="mgcn-config-row">
          <span className="mgcn-config-label">{t('config.markTone')}</span>
          <Seg
            options={MARK_TONE_OPTIONS}
            value={injected.markTone()}
            labels={{ soft: t('config.markTone.soft'), deep: t('config.markTone.deep') }}
            onPick={(v: MarkTone) => injected.setMarkTone(v)}
          />
        </div>
      ) : null}
      <div className="mgcn-config-sep" />
      <div className="mgcn-config-row">
        <span className="mgcn-config-label">{t('config.showQuickSettings')}</span>
        <ModeSeg value={injected.showQuickSettings()} onChange={(v) => injected.setShowQuickSettings(v)} t={t} />
      </div>
      <div className="mgcn-config-row">
        <span className="mgcn-config-label">{t('config.showSearch')}</span>
        <ModeSeg value={injected.showSearch()} onChange={(v) => injected.setShowSearch(v)} t={t} />
      </div>
      <div className="mgcn-config-row">
        <span className="mgcn-config-label">{t('config.showFavorites')}</span>
        <ModeSeg value={injected.showFavorites()} onChange={(v) => injected.setShowFavorites(v)} t={t} />
      </div>
      <div className="mgcn-config-row">
        <span className="mgcn-config-label">{t('config.showCount')}</span>
        <ModeSeg value={injected.showCount()} onChange={(v) => injected.setShowCount(v)} t={t} />
      </div>
      {STYLE_CAPABILITIES[injected.style()].paging ? (
        <div className="mgcn-config-row">
          <span className="mgcn-config-label">{t('config.showPaging')}</span>
          <ModeSeg value={injected.showPaging()} onChange={(v) => injected.setShowPaging(v)} t={t} />
        </div>
      ) : null}
    </div>
  )
}