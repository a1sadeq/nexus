// Per-tab accent & aura colours.
//
// A tab can carry its own accent and aura colour, so five projects open at once are told apart by
// colour rather than by reading five window titles. The values end up inside CSS strings that are
// injected into a live webview, so nothing gets through unless it is a plain hex colour — this
// module is the single gate for that, used on the way in (the picker), on the way out (the tab
// record, localStorage, history) and again in the main process before any CSS is built.

export interface TabColors {
  accentColor?: string
  auraColor?: string
}

/** Colours offered in the picker. Sixteen, because that is how many fit two tidy rows. */
export const TAB_COLOR_PRESETS: { name: string; hex: string }[] = [
  { name: 'Rose', hex: '#f43f5e' },
  { name: 'Amber', hex: '#f59e0b' },
  { name: 'Lime', hex: '#84cc16' },
  { name: 'Emerald', hex: '#10b981' },
  { name: 'Teal', hex: '#14b8a6' },
  { name: 'Cyan', hex: '#06b6d4' },
  { name: 'Sky', hex: '#0ea5e9' },
  { name: 'Indigo', hex: '#6366f1' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Fuchsia', hex: '#d946ef' },
  { name: 'Pink', hex: '#ec4899' },
  { name: 'Red', hex: '#ef4444' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Yellow', hex: '#eab308' },
  { name: 'Slate', hex: '#64748b' },
  { name: 'Ice', hex: '#e2e8f0' }
]

/**
 * Canonicalise anything colour-shaped into `#rrggbb`, or `undefined`.
 *
 * Deliberately strict: hex only. `rgb(...)`, `var(...)` and named colours are rejected rather than
 * passed along, because the result is concatenated into injected CSS and a value like
 * `red; } body { display:none` must never reach that string.
 */
export function normaliseHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const raw = value.trim().toLowerCase()
  if (!raw) return undefined
  const body = raw.startsWith('#') ? raw.slice(1) : raw
  if (body.length === 3 && /^[0-9a-f]{3}$/.test(body)) {
    return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`
  }
  if (body.length === 6 && /^[0-9a-f]{6}$/.test(body)) return `#${body}`
  // 8-digit hex carries alpha; the aura has its own opacity control, so drop the channel.
  if (body.length === 8 && /^[0-9a-f]{8}$/.test(body)) return `#${body.slice(0, 6)}`
  return undefined
}

/** Store-safe pair: unset, unusable and duplicate values all collapse to `{}`. */
export function sanitiseTabColors(input: unknown): TabColors {
  if (!input || typeof input !== 'object') return {}
  const record = input as Record<string, unknown>
  const accentColor = normaliseHexColor(record.accentColor)
  const auraColor = normaliseHexColor(record.auraColor)
  const out: TabColors = {}
  if (accentColor) out.accentColor = accentColor
  if (auraColor) out.auraColor = auraColor
  return out
}

export function tabHasCustomColors(tab: { accentColor?: string; auraColor?: string } | null): boolean {
  if (!tab) return false
  return Boolean(normaliseHexColor(tab.accentColor) || normaliseHexColor(tab.auraColor))
}

/** What the tab strip paints: the tab's own accent, else the provider's colour. */
export function tabAccentColor(
  tab: { accentColor?: string } | null | undefined,
  fallback: string
): string {
  return normaliseHexColor(tab?.accentColor) ?? fallback
}

/** What the aura uses: the tab's own aura colour, else its accent, else the app accent. */
export function tabAuraColor(
  tab: { accentColor?: string; auraColor?: string } | null | undefined,
  fallback: string
): string {
  return (
    normaliseHexColor(tab?.auraColor) ?? normaliseHexColor(tab?.accentColor) ?? fallback
  )
}

/**
 * Merge colours into a tab record. `undefined` clears the field rather than writing `undefined`,
 * so a cleared tab serialises exactly like a tab that never had a colour.
 */
export function applyTabColors<T extends object>(tab: T, colors: TabColors): T & TabColors {
  const next: Record<string, unknown> = { ...(tab as Record<string, unknown>) }
  const accentColor = normaliseHexColor(colors.accentColor)
  const auraColor = normaliseHexColor(colors.auraColor)
  if (accentColor) next.accentColor = accentColor
  else delete next.accentColor
  if (auraColor) next.auraColor = auraColor
  else delete next.auraColor
  return next as T & TabColors
}

/** Only the fields that exist, so history entries stay the shape they always were. */
export function colorsForHistory(tab: TabColors | null | undefined): TabColors {
  return sanitiseTabColors(tab)
}
