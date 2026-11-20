import { describe, it, expect } from 'vitest'
import { ambientAuraCss, mergeOverrides } from './providerThemes'
import type { ProviderOverrides } from '../shared/providerConfig'

const base = {
  bg: '#1a1a2e',
  surface: '#16213e',
  surface2: '#0f3460',
  accent: '#e94560',
  text: '#eaeaea',
  text2: '#8899aa',
  border: '#2a2a2e',
  radius: 8,
  borderWidth: 1
}

describe('mergeOverrides', () => {
  it('returns base untouched when no overrides', () => {
    expect(mergeOverrides(base, undefined)).toEqual(base)
  })
  it('merges color deltas', () => {
    const o: ProviderOverrides = { colors: { bg: '#000000', accent: '#ffffff' } }
    expect(mergeOverrides(base, o).bg).toBe('#000000')
    expect(mergeOverrides(base, o).accent).toBe('#ffffff')
    expect(mergeOverrides(base, o).surface).toBe('#16213e')
  })
  it('maps geometry, typography, layout, effects into ThemeVars', () => {
    const o: ProviderOverrides = {
      geometry: { radius: 20, borderWidth: 2 },
      typography: { fontWeight: 500, fontSize: 15, fontFamily: 'Inter' },
      layout: { pageWidth: 900, bubbleMaxWidth: 800 },
      effects: { shadowAlpha: 0.2, selectionBg: '#111', codeBlockRadius: 4 }
    }
    const out = mergeOverrides(base, o)
    expect(out.radius).toBe(20)
    expect(out.borderWidth).toBe(2)
    expect(out.fontWeight).toBe(500)
    expect(out.fontSize).toBe(15)
    expect(out.fontFamily).toBe('Inter')
    expect(out.pageWidthPx).toBe(900)
    expect(out.bubbleMaxWidthPx).toBe(800)
    expect(out.shadowAlpha).toBe(0.2)
    expect(out.selectionBg).toBe('#111')
    expect(out.codeBlockRadius).toBe(4)
  })
  it('merges ambientAuraColor, aiResponseWidthPx, and userPromptWidthPx', () => {
    const o: ProviderOverrides = {
      ambientAuraColor: '#22d3ee',
      aiResponseWidthPx: 1040,
      userPromptWidthPx: '100%'
    }
    const out = mergeOverrides(base, o)
    expect(out.ambientAuraColor).toBe('#22d3ee')
    expect(out.aiResponseWidthPx).toBe(1040)
    expect(out.userPromptWidthPx).toBe('100%')
  })
})


describe('ambientAuraCss', () => {
  const aura = (extra: Record<string, unknown> = {}) => ({
    ...base,
    ambientAura: true,
    ambientAuraMode: 'viewport-frame' as const,
    ambientAuraIntensity: 45,
    ...extra
  })

  it('renders nothing when the aura is off', () => {
    expect(ambientAuraCss(aura({ ambientAura: false }))).toBe('')
  })

  it('keeps the documented behaviour up to 100%', () => {
    const css = ambientAuraCss(aura({ ambientAuraIntensity: 100 }))
    expect(css).toContain('body::before')
    expect(css).toContain('120px') // 100 * 1.2, same radius as before this change
  })

  it('extends the reach past 100% instead of only hardening the colour', () => {
    const key = ambientAuraCss(aura({ ambientAuraIntensity: 300 }))
    expect(key).toContain('360px')
    // A second, much wider halo fades in above ~80%; below that it is present but transparent.
    expect(key).toContain('780px')
    expect(key).toContain('rgba(233, 69, 96, 0.5)')
    expect(ambientAuraCss(aura({ ambientAuraIntensity: 45 }))).toContain('rgba(233, 69, 96, 0)')
  })

  it('clamps absurd values rather than emitting nonsense CSS', () => {
    expect(ambientAuraCss(aura({ ambientAuraIntensity: 100000 }))).toContain('360px')
    expect(ambientAuraCss(aura({ ambientAuraIntensity: -50 }))).toContain('body::before')
  })

  it('breathes only when asked to, and always yields to reduced motion', () => {
    const live = ambientAuraCss(aura())
    expect(live).toContain('@keyframes nexus-aura-breathe')
    expect(live).toContain('prefers-reduced-motion: reduce')

    const still = ambientAuraCss(aura({ ambientAuraLive: false }))
    expect(still).not.toContain('animation:')
    expect(still).toContain('body::before')
  })

  it('animates the centered aura without losing its transform', () => {
    const css = ambientAuraCss(aura({ ambientAuraMode: 'chat-center' }))
    expect(css).toContain('body::after')
    expect(css).toContain('@keyframes nexus-aura-drift')
    expect(css).toContain('translate(-50%, -35%)')
  })

  it('accepts a custom z-index for the fallback stylesheet', () => {
    expect(ambientAuraCss(aura(), { zIndex: 12 })).toContain('z-index: 12;')
  })
})
