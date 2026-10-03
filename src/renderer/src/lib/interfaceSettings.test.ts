import { describe, it, expect } from 'vitest'
import {
  PRESET_CONFIGS,
  DEFAULT_INTERFACE_SETTINGS,
  isPresetModified,
  adjustAccentContrast
} from './interfaceSettings'

describe('interfaceSettings - isPresetModified', () => {
  it('returns false for default preset settings matching preset config exactly', () => {
    const refinedPresetSettings = {
      ...DEFAULT_INTERFACE_SETTINGS,
      aestheticPreset: 'refined-modern' as const,
      ...PRESET_CONFIGS['refined-modern']
    }
    expect(isPresetModified(refinedPresetSettings)).toBe(false)
  })

  it('returns true when any key in preset diverges from preset defaults', () => {
    const customizedPresetSettings = {
      ...DEFAULT_INTERFACE_SETTINGS,
      aestheticPreset: 'cyberpunk-neon' as const,
      ...PRESET_CONFIGS['cyberpunk-neon'],
      cornerRadius: 20 // Diverged from cyberpunk-neon (which has cornerRadius 4)
    }
    expect(isPresetModified(customizedPresetSettings)).toBe(true)
  })

  it('returns false when aestheticPreset is custom or undefined', () => {
    expect(isPresetModified({ ...DEFAULT_INTERFACE_SETTINGS, aestheticPreset: 'custom' })).toBe(false)
    expect(isPresetModified({ ...DEFAULT_INTERFACE_SETTINGS, aestheticPreset: undefined as any })).toBe(false)
  })
})

describe('interfaceSettings - adjustAccentContrast', () => {
  it('converts to monochrome gray when contrast is 0%', () => {
    const hex = '#6366f1' // Indigo
    const adjusted = adjustAccentContrast(hex, 0)
    // In grayscale, R === G === B
    const r = parseInt(adjusted.slice(1, 3), 16)
    const g = parseInt(adjusted.slice(3, 5), 16)
    const b = parseInt(adjusted.slice(5, 7), 16)
    expect(r).toBe(g)
    expect(g).toBe(b)
  })

  it('returns exact hex at 100% contrast', () => {
    const hex = '#22d3ee'
    expect(adjustAccentContrast(hex, 100).toLowerCase()).toBe('#22d3ee')
  })

  it('boosts saturation at 150% contrast without throwing', () => {
    const hex = '#10a37f'
    const boosted = adjustAccentContrast(hex, 150)
    expect(boosted).toMatch(/^#[0-9a-fA-F]{6}$/)
  })
})

describe('interfaceSettings - globalCustomJs and features', () => {
  it('has empty string as default globalCustomJs', () => {
    expect(DEFAULT_INTERFACE_SETTINGS.globalCustomJs).toBe('')
  })
})

