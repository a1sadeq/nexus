// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_INTERFACE_SETTINGS,
  applyInterfaceCssVariables,
  computeSurfaceColors
} from './interfaceSettings'
import { PRESET_THEMES, applyTheme } from './themes'

describe('Theme Unification & Windows Persistence', () => {
  beforeEach(() => {
    document.documentElement.style.cssText = ''
  })

  it('defaults surfaceDarkness to 50% (Obsidian Midnight) rather than 25% to prevent porcelain light traps', () => {
    expect(DEFAULT_INTERFACE_SETTINGS.surfaceDarkness).toBe(50)
    const colors = computeSurfaceColors('#0b0c14', 50)
    expect(colors.isDark).toBe(true)
    expect(colors.bg).not.toBe('#ffffff')
  })

  it('preserves Dracula theme colors when applyInterfaceCssVariables is invoked with activeTheme', () => {
    const dracula = PRESET_THEMES.find((t) => t.id === 'dracula')!
    expect(dracula).toBeDefined()

    applyTheme(dracula)
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe(dracula.colors.bg)
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe(dracula.colors.accent)

    // Call applyInterfaceCssVariables with activeTheme passed in
    applyInterfaceCssVariables(DEFAULT_INTERFACE_SETTINGS, dracula)

    // Verify Dracula's unique colors were NOT wiped out
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe(dracula.colors.bg)
    expect(document.documentElement.style.getPropertyValue('--surface')).toBe(dracula.colors.surface)
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe(dracula.colors.accent)
  })

  it('preserves Tokyo Night theme colors when applyInterfaceCssVariables is invoked with activeTheme', () => {
    const tokyoNight = PRESET_THEMES.find((t) => t.id === 'tokyo-night')!
    expect(tokyoNight).toBeDefined()

    applyTheme(tokyoNight)
    applyInterfaceCssVariables(DEFAULT_INTERFACE_SETTINGS, tokyoNight)

    expect(document.documentElement.style.getPropertyValue('--bg')).toBe(tokyoNight.colors.bg)
    expect(document.documentElement.style.getPropertyValue('--surface')).toBe(tokyoNight.colors.surface)
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe(tokyoNight.colors.accent)
  })

  it('applies custom surface color when aestheticPreset is custom or surfaceBgColor is explicitly overridden', () => {
    const dracula = PRESET_THEMES.find((t) => t.id === 'dracula')!
    applyTheme(dracula)

    // Explicit override
    const customSettings = {
      ...DEFAULT_INTERFACE_SETTINGS,
      aestheticPreset: 'custom' as const,
      surfaceBgColor: '#002233',
      accentColor: '#33ffaa'
    }
    applyInterfaceCssVariables(customSettings, dracula)

    expect(document.documentElement.style.getPropertyValue('--surface-custom')).toBe('#002233')
  })
})
