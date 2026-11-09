import { describe, it, expect } from 'vitest'
import {
  DEFAULT_THEME_APPEARANCE,
  isValidThemeAppearance,
  resolveEffectiveColorScheme,
  getColorSchemeCss,
  applyColorSchemeEmulation
} from './nativeThemeAppearance'

describe('nativeThemeAppearance', () => {
  it('defaults to dark appearance out of the box', () => {
    expect(DEFAULT_THEME_APPEARANCE).toBe('dark')
  })

  it('validates supported theme appearances correctly', () => {
    expect(isValidThemeAppearance('dark')).toBe(true)
    expect(isValidThemeAppearance('light')).toBe(true)
    expect(isValidThemeAppearance('system')).toBe(true)
    expect(isValidThemeAppearance('neon')).toBe(false)
    expect(isValidThemeAppearance(null)).toBe(false)
    expect(isValidThemeAppearance(undefined)).toBe(false)
  })

  it('resolves effective color scheme based on appearance and system fallback', () => {
    expect(resolveEffectiveColorScheme('dark', false)).toBe('dark')
    expect(resolveEffectiveColorScheme('dark', true)).toBe('dark')
    expect(resolveEffectiveColorScheme('light', true)).toBe('light')
    expect(resolveEffectiveColorScheme('system', true)).toBe('dark')
    expect(resolveEffectiveColorScheme('system', false)).toBe('light')
  })

  it('generates universal color-scheme CSS snippet', () => {
    expect(getColorSchemeCss('dark')).toContain('color-scheme: dark !important;')
    expect(getColorSchemeCss('light')).toContain('color-scheme: light !important;')
  })

  it('safely applies color-scheme emulation to webContents without throwing', () => {
    let emulated: string | null = null
    const fakeWebContents = {
      emulateMediaType: (type: string) => {
        emulated = type
      }
    }
    applyColorSchemeEmulation(fakeWebContents, 'dark')
    expect(emulated).toBe('screen')

    // Handles faulty or destroyed webContents gracefully
    const faultyWebContents = {
      emulateMediaType: () => {
        throw new Error('WebContents destroyed')
      }
    }
    expect(() => applyColorSchemeEmulation(faultyWebContents, 'dark')).not.toThrow()
  })
})
