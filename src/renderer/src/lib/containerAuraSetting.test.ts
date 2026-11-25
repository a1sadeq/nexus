import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The renderer half of build 33: the switch-away dismissal, and the container aura setting.
 *
 * `switchToTab` used to send `dismiss_in_app_toast` unconditionally — every tab switch threw away the
 * notification that had just arrived, including notifications about *other* tabs. And the container
 * aura was two hardcoded alphas in this file plus a separate ring in `lib/containers.ts`; the strength
 * is now one number that both the painted veil and the view inset read.
 */

const app = readFileSync(join(__dirname, '../App.tsx'), 'utf8')
const settings = readFileSync(join(__dirname, '../lib/interfaceSettings.ts'), 'utf8')
const studio = readFileSync(join(__dirname, '../components/StyleStudioCanvas.tsx'), 'utf8')
const containers = readFileSync(join(__dirname, '../lib/containers.ts'), 'utf8')

describe('switching tabs no longer swallows notifications', () => {
  it('does not send a dismissal from switchToTab', () => {
    const start = app.indexOf('const switchToTab = useCallback(')
    expect(start).toBeGreaterThan(0)
    const body = app.slice(start, start + 2400)
    expect(body).not.toContain("send('dismiss_in_app_toast')")
    expect(body).toContain('The in-app toast is *not* dismissed here')
  })
})

describe('container aura strength is a setting, not a constant', () => {
  it('lives in interface settings, with a clamped default', () => {
    expect(settings).toContain('containerAuraStrength: number')
    expect(settings).toContain('containerAuraStrength: 100')
    // A stored value outside the drawable range is clamped on load, not trusted.
    expect(settings).toContain('Math.max(0, Math.min(300, Math.round(strength)))')
  })

  it('drives the ring width and the painted veil from the same helper', () => {
    expect(containers).toContain('export function auraRingWidth(')
    expect(containers).toContain('export const DEFAULT_CONTAINER_AURA_STRENGTH = 100')
    expect(containers).toContain('export const MAX_CONTAINER_AURA_STRENGTH = 300')
    // App.tsx: the inset the native view is placed at…
    expect(app).toContain('insetRectForAura(base, true, auraRingStrengthRef.current)')
    // …and the glow drawn in that space, from the shared style function.
    expect(app).toContain('...auraRingStyle(activeContainerColor, containerAuraStrength)')
  })

  it('re-sends the native bounds when the strength changes, so the page moves with the ring', () => {
    expect(app).toContain('const auraRingStrengthRef = useRef<number>(DEFAULT_CONTAINER_AURA_STRENGTH)')
    expect(app).toContain('const containerAuraStrength = interfaceSettings.containerAuraStrength')
    expect(app).toContain('if (changed) restoreViewBoundsRef.current?.()')
    // Strength 0 paints nothing at all rather than an invisible spacer.
    expect(app).toContain('activeContainerColor && containerAuraStrength > 0')
  })

  it('is adjustable in Settings → Style without being a per-provider override', () => {
    expect(studio).toContain('data-container-aura-controls="true"')
    expect(studio).toContain("setVal('containerAuraStrength', Number(e.target.value))")
    expect(studio).toContain("aria-label=\"Container aura strength\"")
    // Global only: the ring describes a container, which is a window-level concept.
    expect(studio).toContain('{isGlobal && (')
    // …and it is findable in the settings search.
    expect(readFileSync(join(__dirname, '../components/SettingsOverlay.tsx'), 'utf8')).toContain(
      "id: 'container-aura'"
    )
  })
})
