import type { CSSProperties } from 'react'
import type { ModelKey } from '../lib/tabs'
import { BRAND_IDS, modelColor, modelLabel } from '../lib/modelVisuals'
import { BrandIcon } from './BrandIcons'
import type { ModelDef } from './ModelPills'
import './ModelNotch.css'

interface Props {
  models: ModelDef[]
  activeModel: ModelKey
  onSelect: (model: ModelKey) => void
}

// Darken a hex color toward a near-black base so the collapsed pill
// stays dark regardless of how light the provider's brand color is.
function darkTint(hex: string): string {
  let h = hex.replace('#', '')
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  if (h.length !== 6) return '#16161f'
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const mix = (c: number) =>
    Math.round(c * 0.32 + 10)
      .toString(16)
      .padStart(2, '0')
  return `#${mix(r)}${mix(g)}${mix(b)}`
}

/**
 * ModelNotch — Dynamic-Island provider selector.
 * Collapsed: active provider's icon on a dark-tinted pill; icon takes the
 * provider color (custom overrides brand). Hover/focus: track expands to
 * neutral surface, all providers fade in; click = switch.
 * Stateless: expansion is pure CSS :hover / :focus-within.
 */
export default function ModelNotch({ models, activeModel, onSelect }: Props) {
  const colorFor = (key: string) => {
    const m = models.find((x) => x.key === key)
    return m?.color || modelColor(key)
  }
  const activeColor = colorFor(activeModel)
  const trackVars = {
    '--notch-bg': darkTint(activeColor),
    '--notch-fg': activeColor
  } as CSSProperties
  // Pin active provider first — collapsed notch shows ONLY the active icon
  // (max-width clips the rest); first slot must be the active one.
  const ordered = [
    ...models.filter((m) => m.key === activeModel),
    ...models.filter((m) => m.key !== activeModel)
  ]
  return (
    <div className="model-notch" style={trackVars} role="group" aria-label="AI provider selector">
      {ordered.map((m) => {
        const active = m.key === activeModel
        return (
          <button
            key={m.key}
            type="button"
            title={m.label}
            aria-pressed={active}
            className={`model-notch-btn ${active ? 'active' : ''}`}
            style={active ? undefined : { color: colorFor(m.key) }}
            onClick={() => {
              onSelect(m.key)
            }}
          >
            {m.icon ? (
              <span className="model-notch-icon" dangerouslySetInnerHTML={{ __html: m.icon }} />
            ) : BRAND_IDS[m.key] ? (
              <BrandIcon id={m.key} size={18} className="model-notch-icon" />
            ) : (
              <span className="model-notch-fallback">{modelLabel(m.key).slice(0, 2)}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
