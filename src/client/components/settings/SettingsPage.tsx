// 完整配置页（mega-settings 成员页与自足入口共用）
import { useEffect, useState, type ReactNode } from 'react'
import { ALIGN_OPTIONS, CARD_ITEM_OPTIONS, CARD_OPTIONS, MARK_TONE_OPTIONS, SCROLL_OPTIONS, SEARCH_SCOPE_OPTIONS, SHOW_OPTIONS, STYLE_OPTIONS, STYLE_CAPABILITIES, type MarkTone } from '../../settings.ts'
import type { NavInjected, Translate } from '../shared/types.ts'

export interface SettingsPageProps {
  injected: NavInjected
  t: Translate
  /** 已收纳至 mega-settings 时仅显示提示（自足入口让位） */
  hosted?: boolean
}

function Seg<T extends string | number>(props: { options: readonly T[]; value: T; labels: Record<string, string>; onPick: (v: T) => void }): ReactNode {
  return (
    <div className="mgcn-segmented" role="radiogroup">
      {props.options.map((o) => (
        <button
          key={String(o)}
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

function Field({ label, desc, children }: { label: string; desc?: string; children: ReactNode }): ReactNode {
  return (
    <div className="mgcn-settingsRow">
      <div className="mgcn-settingsLabel">
        <p className="mgcn-settingsTitle">{label}</p>
        {desc !== undefined ? <p className="mgcn-settingsDesc">{desc}</p> : null}
      </div>
      <div className="mgcn-settingsControl">{children}</div>
    </div>
  )
}

function useSettingsTick(subscribe: NavInjected['subscribeSettings']): void {
  const [, bump] = useState(0)
  useEffect(() => subscribe(() => bump((n) => n + 1)), [subscribe])
}

export function SettingsPage(props: SettingsPageProps): ReactNode {
  const { injected, t, hosted } = props
  useSettingsTick(injected.subscribeSettings)
  if (hosted === true) {
    return <div className="mgcn-settings">{t('settings.hosted')}</div>
  }
  return (
    <div className="mgcn-settings">
      <Field label={t('config.style')}>
        <Seg
          options={STYLE_OPTIONS}
          value={injected.style()}
          labels={{ minimal: t('config.style.minimal'), codex: t('config.style.codex'), deepseek: t('config.style.deepseek') }}
          onPick={(v) => injected.setStyle(v)}
        />
      </Field>
      <Field label={t('config.railOffset')} desc={t('config.railOffset.desc')}>
        <div className="mgcn-sliderRow">
          <input
            type="range"
            min="0"
            max="32"
            step="1"
            value={injected.railOffset()}
            onChange={(e) => injected.setRailOffset(Number(e.target.value))}
          />
          <span className="mgcn-sliderValue">{injected.railOffset()}px</span>
        </div>
      </Field>
      <Field label={t('config.align')} desc={t('settings.align.desc')}>
        <Seg
          options={ALIGN_OPTIONS}
          value={injected.align()}
          labels={{ left: t('settings.align.left'), right: t('settings.align.right') }}
          onPick={(v) => injected.setAlign(v)}
        />
      </Field>
      <Field label={t('config.scrollBehavior')} desc={t('config.scrollBehavior.desc')}>
        <Seg
          options={SCROLL_OPTIONS}
          value={injected.scrollBehavior()}
          labels={{ smooth: t('config.scrollBehavior.smooth'), instant: t('config.scrollBehavior.instant') }}
          onPick={(v) => injected.setScrollMode(v)}
        />
      </Field>
      {STYLE_CAPABILITIES[injected.style()].hoverCards ? (
        <>
          <Field label={t('config.cardCount')} desc={t('config.cardCount.desc')}>
            <Seg
              options={CARD_OPTIONS}
              value={injected.cardCount()}
              labels={{ 1: '1', 3: '3', 5: '5' }}
              onPick={(v) => injected.setCardCount(v)}
            />
          </Field>
          <Field label={t('config.cardItems')} desc={t('config.cardItems.desc')}>
            <div className="mgcn-checkGroup">
              {CARD_ITEM_OPTIONS.map((item) => {
                const on = injected.cardItems().includes(item)
                return (
                  <label key={item} className="mgcn-checkItem">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => {
                        const items = e.target.checked
                          ? [...injected.cardItems(), item]
                          : injected.cardItems().filter((x) => x !== item)
                        injected.setCardItems(items)
                      }}
                    />
                    <span>{t('config.cardItems.' + item)}</span>
                  </label>
                )
              })}
            </div>
          </Field>
        </>
      ) : null}

      {injected.style() === 'codex' ? (
        <Field label={t('config.markTone')} desc={t('config.markTone.desc')}>
          <Seg
            options={MARK_TONE_OPTIONS}
            value={injected.markTone()}
            labels={{ soft: t('config.markTone.soft'), deep: t('config.markTone.deep') }}
            onPick={(v: MarkTone) => injected.setMarkTone(v)}
          />
        </Field>
      ) : null}

      <Field label={t('config.searchScopes')} desc={t('config.searchScopes.desc')}>
        <div className="mgcn-checkGroup">
          {SEARCH_SCOPE_OPTIONS.map((scope) => {
            const on = injected.searchScopes().includes(scope)
            const locked = scope === 'user'   // 用户必选，不可取消
            return (
              <label key={scope} className="mgcn-checkItem">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={locked}
                  onChange={(e) => {
                    const items = e.target.checked
                      ? [...injected.searchScopes(), scope]
                      : injected.searchScopes().filter((x) => x !== scope)
                    injected.setSearchScopes(items)
                  }}
                />
                <span>{t('config.searchScopes.' + scope)}</span>
              </label>
            )
          })}
        </div>
      </Field>
      <Field label={t('config.showQuickSettings')}>
        <ModeSeg value={injected.showQuickSettings()} onChange={(v) => injected.setShowQuickSettings(v)} t={t} />
      </Field>
      <Field label={t('config.showSearch')}>
        <ModeSeg value={injected.showSearch()} onChange={(v) => injected.setShowSearch(v)} t={t} />
      </Field>
      <Field label={t('config.showFavorites')}>
        <ModeSeg value={injected.showFavorites()} onChange={(v) => injected.setShowFavorites(v)} t={t} />
      </Field>
      <Field label={t('config.showCount')}>
        <ModeSeg value={injected.showCount()} onChange={(v) => injected.setShowCount(v)} t={t} />
      </Field>
      {STYLE_CAPABILITIES[injected.style()].paging ? (
        <Field label={t('config.showPaging')}>
          <ModeSeg value={injected.showPaging()} onChange={(v) => injected.setShowPaging(v)} t={t} />
        </Field>
      ) : null}
    </div>
  )
}

function ModeSeg({ value, onChange, t }: { value: 'show' | 'peek' | 'hide'; onChange(v: 'show' | 'peek' | 'hide'): void; t: Translate }): ReactNode {
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