import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  normaliseHexColor,
  sanitiseTabColors,
  TAB_COLOR_PRESETS,
  type TabColors
} from '../lib/tabColors'
import './TabColorModal.css'

interface Props {
  open: boolean
  /** Title of the tab being coloured, so it is obvious which one changes. */
  tabTitle?: string
  /** Current colours (already sanitised by the caller). */
  colors: TabColors
  /** What "reset" returns to — the provider/app accent for this tab. */
  fallbackAccent: string
  /** Applied on every change, so the tab strip updates live. */
  onChange: (colors: TabColors) => void
  onClose: () => void
}

interface SwatchRowProps {
  label: string
  value?: string
  effective: string
  onPick: (hex: string) => void
  onClear: () => void
  clearLabel: string
  hint?: string
}

function SwatchRow({
  label,
  value,
  effective,
  onPick,
  onClear,
  clearLabel,
  hint
}: SwatchRowProps): ReactElement {
  // The typed value lives here rather than being synced from props in an effect: the input is the
  // only thing that writes it, and a flush-back would fight the user's caret.
  const [draft, setDraft] = useState(value ?? '')
  const valid = normaliseHexColor(draft)

  return (
    <div className="tabcolor-row">
      <div className="tabcolor-row-head">
        <span className="tabcolor-row-label">{label}</span>
        <span className="tabcolor-row-value" title={valid ? undefined : 'Not a hex colour'}>
          {value ? value.toUpperCase() : 'follows ' + clearLabel.toLowerCase()}
        </span>
      </div>
      <div className="tabcolor-controls">
        <label className="tabcolor-native" title={`Pick ${label.toLowerCase()}`}>
          <span className="tabcolor-native-chip" style={{ background: effective }} aria-hidden="true" />
          <input
            type="color"
            value={effective}
            onChange={(e) => {
              setDraft(e.target.value)
              onPick(e.target.value)
            }}
            aria-label={`${label} colour picker`}
          />
        </label>
        <input
          className="tabcolor-hex"
          type="text"
          inputMode="text"
          spellCheck={false}
          placeholder="#rrggbb"
          value={draft}
          onChange={(e) => {
            const next = e.target.value
            setDraft(next)
            const hex = normaliseHexColor(next)
            if (hex) onPick(hex)
          }}
          onBlur={() => setDraft(value ?? '')}
          aria-label={`${label} hex value`}
          aria-invalid={draft.length > 0 && !valid}
        />
        <button
          type="button"
          className="tabcolor-clear"
          onClick={() => {
            setDraft('')
            onClear()
          }}
          title={`Clear — ${clearLabel.toLowerCase()}`}
        >
          Clear
        </button>
      </div>
      <div className="tabcolor-swatches">
        {TAB_COLOR_PRESETS.map((preset) => {
          const active = effective.toLowerCase() === preset.hex.toLowerCase()
          return (
            <button
              key={preset.hex}
              type="button"
              className={`tabcolor-swatch${active ? ' is-active' : ''}`}
              style={{ background: preset.hex }}
              title={preset.name}
              aria-label={preset.name}
              aria-pressed={active}
              onClick={() => onPick(preset.hex)}
            />
          )
        })}
      </div>
      {hint && <p className="tabcolor-hint">{hint}</p>}
    </div>
  )
}

export default function TabColorModal({
  open,
  tabTitle,
  colors,
  fallbackAccent,
  onChange,
  onClose
}: Props): ReactElement | null {
  const panelRef = useRef<HTMLDivElement>(null)
  const safeAccent = normaliseHexColor(fallbackAccent) ?? '#6366f1'
  const effective = useMemo(
    () =>
      sanitiseTabColors({
        accentColor: colors.accentColor ?? safeAccent,
        auraColor: colors.auraColor ?? colors.accentColor ?? safeAccent
      }),
    [colors.accentColor, colors.auraColor, safeAccent]
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    panelRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  const accent = effective.accentColor ?? safeAccent
  const aura = effective.auraColor ?? accent

  return (
    <div className="tabcolor-backdrop" onClick={onClose} role="presentation">
      <div
        className="tabcolor-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Tab accent and aura colours"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{ ['--tabcolor-accent' as string]: accent }}
      >
        <div className="tabcolor-head">
          <div>
            <h2 className="tabcolor-title">Accent &amp; aura</h2>
            <p className="tabcolor-subtitle">{tabTitle?.trim() || 'This tab'} — remembered across restarts</p>
          </div>
          <button type="button" className="tabcolor-done" onClick={onClose}>
            Done
          </button>
        </div>

        <div
          className="tabcolor-preview"
          style={{
            background: `radial-gradient(circle at 50% 50%, ${aura}33 0%, transparent 72%), linear-gradient(135deg, ${accent}22, transparent 60%)`,
            borderColor: `${accent}88`,
            boxShadow: `inset 0 0 24px ${aura}44, 0 0 18px ${accent}33`
          }}
        >
          <span className="tabcolor-preview-dot" style={{ background: accent, boxShadow: `0 0 10px ${accent}` }} />
          <span className="tabcolor-preview-label">{tabTitle?.trim() || 'This tab'}</span>
        </div>

        <SwatchRow
          label="Accent"
          value={colors.accentColor}
          effective={accent}
          onPick={(hex) => onChange({ ...colors, accentColor: hex })}
          onClear={() => onChange({ auraColor: colors.auraColor })}
          clearLabel="This tab's accent"
          hint="Used by the tab strip, the title bar dot and links inside this tab's page."
        />

        <SwatchRow
          label="Aura"
          value={colors.auraColor}
          effective={aura}
          onPick={(hex) => onChange({ ...colors, auraColor: hex })}
          onClear={() => onChange({ accentColor: colors.accentColor })}
          clearLabel="The accent"
          hint="The glow behind this tab's page. Leave it unset to follow the accent."
        />

        <div className="tabcolor-foot">
          <button type="button" className="tabcolor-reset" onClick={() => onChange({})}>
            Reset to the app theme
          </button>
          {colors.auraColor && colors.accentColor && (
            <button
              type="button"
              className="tabcolor-match"
              onClick={() => onChange({ accentColor: colors.accentColor })}
            >
              Aura follows accent
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
