import { describe, it, expect } from 'vitest'
import { mergeOverrides } from './providerThemes'
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
