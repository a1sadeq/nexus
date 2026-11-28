// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_INTERFACE_SETTINGS,
  TAB_ROW_TINT_SCALE,
  tabRowTintScale,
  applyInterfaceCssVariables,
  type InterfaceSettings,
  type TabRowTint
} from './interfaceSettings'

/**
 * Build 43: the colour treatment on the tab rows is a setting, not a fixed style.
 *
 * Build 42 tinted every row with its provider's colour. The amounts were constants in the stylesheet,
 * so the only way to have less of it was to edit CSS. One number now drives all of it — row gradient,
 * border, hover glow, sleeping row, number badge and the new-tab list — and `standard` reproduces the
 * build-42 values exactly, so the default look does not change.
 */

const verticalCss = readFileSync(join(__dirname, '../components/VerticalTabs.css'), 'utf8')
const newTabCss = readFileSync(join(__dirname, '../components/NewTabOverlay.css'), 'utf8')
const studio = readFileSync(join(__dirname, '../components/StyleStudioCanvas.tsx'), 'utf8')

function settings(overrides: Partial<InterfaceSettings> = {}): InterfaceSettings {
  return { ...DEFAULT_INTERFACE_SETTINGS, ...overrides }
}

describe('tabRowTint — the scale', () => {
  it('defaults to standard, which is exactly the build-42 treatment', () => {
    expect(DEFAULT_INTERFACE_SETTINGS.tabRowTint).toBe('standard')
    expect(tabRowTintScale(DEFAULT_INTERFACE_SETTINGS.tabRowTint)).toBe(1)
    expect(TAB_ROW_TINT_SCALE.standard).toBe(1)
  })

  it('turns the tint fully off at `off` and pushes past 1 at `vivid`', () => {
    expect(tabRowTintScale('off')).toBe(0)
    expect(tabRowTintScale('subtle')).toBeGreaterThan(0)
    expect(tabRowTintScale('subtle')).toBeLessThan(1)
    expect(tabRowTintScale('vivid')).toBeGreaterThan(1)
  })

  it('falls back to standard for a missing or unknown value', () => {
    expect(tabRowTintScale(undefined)).toBe(1)
    expect(tabRowTintScale(null)).toBe(1)
    expect(tabRowTintScale('nonsense' as unknown as TabRowTint)).toBe(1)
  })
})

describe('tabRowTint — reaching the stylesheet', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style')
    delete document.body.dataset.tabRowTint
  })

  it('publishes the multiplier as --tab-tint-scale and mirrors it on the body', () => {
    applyInterfaceCssVariables(settings({ tabRowTint: 'off' }))
    expect(document.documentElement.style.getPropertyValue('--tab-tint-scale')).toBe('0')
    expect(document.body.dataset.tabRowTint).toBe('off')

    applyInterfaceCssVariables(settings({ tabRowTint: 'vivid' }))
    expect(document.documentElement.style.getPropertyValue('--tab-tint-scale')).toBe('1.7')
    expect(document.body.dataset.tabRowTint).toBe('vivid')
  })

  it('publishes the standard multiplier when the setting was never stored', () => {
    applyInterfaceCssVariables(settings({ tabRowTint: undefined }))
    expect(document.documentElement.style.getPropertyValue('--tab-tint-scale')).toBe('1')
    expect(document.body.dataset.tabRowTint).toBe('standard')
  })
})

describe('tabRowTint — every tinted surface reads the multiplier', () => {
  it('scales the vertical tab row, its badge and its sleeping state', () => {
    const row = verticalCss.slice(verticalCss.indexOf('.vertical-tab-provider {'))
    expect(row).toContain('var(--tab-tint-scale')
    // Row gradient, border, number badge: all three move together.
    expect(row).toMatch(/calc\(14% \* var\(--tab-tint-scale/)
    expect(row).toMatch(/calc\(32% \* var\(--tab-tint-scale/)
    expect(row).toMatch(/calc\(12% \* var\(--tab-tint-scale/)
  })

  it('scales the new-tab provider list with the same number', () => {
    expect(newTabCss).toContain('var(--tab-tint-scale')
    expect(newTabCss).toMatch(/calc\(5% \* var\(--tab-tint-scale/)
    expect(newTabCss).toMatch(/calc\(20% \* var\(--tab-tint-scale/)
  })

  it('registers the multiplier as a number so the calc() percentages are typed', () => {
    expect(verticalCss).toContain('@property --tab-tint-scale')
    expect(verticalCss).toContain("syntax: '<number>'")
  })

  it('is adjustable from Settings → Style Studio', () => {
    expect(studio).toContain("updateInterfaceSetting('tabRowTint'")
    expect(studio).toContain('Provider Colour on Tab Rows')
    for (const level of ["'off'", "'subtle'", "'standard'", "'vivid'"]) {
      expect(studio).toContain(level)
    }
  })
})
