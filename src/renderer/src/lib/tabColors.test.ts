import { describe, expect, it } from 'vitest'
import {
  applyTabColors,
  colorsForHistory,
  normaliseHexColor,
  sanitiseTabColors,
  TAB_COLOR_PRESETS,
  tabAccentColor,
  tabAuraColor,
  tabHasCustomColors
} from './tabColors'

describe('normaliseHexColor', () => {
  it('expands shorthand hex', () => {
    expect(normaliseHexColor('#abc')).toBe('#aabbcc')
    expect(normaliseHexColor('abc')).toBe('#aabbcc')
  })

  it('keeps six-digit hex, lowercased', () => {
    expect(normaliseHexColor('#AABBCC')).toBe('#aabbcc')
    expect(normaliseHexColor('  #10B981  ')).toBe('#10b981')
  })

  it('drops an alpha channel instead of rejecting the colour', () => {
    expect(normaliseHexColor('#aabbccdd')).toBe('#aabbcc')
  })

  it('rejects everything that is not a hex colour', () => {
    expect(normaliseHexColor('red')).toBeUndefined()
    expect(normaliseHexColor('rgb(255,0,0)')).toBeUndefined()
    expect(normaliseHexColor('var(--accent)')).toBeUndefined()
    expect(normaliseHexColor('#ff')).toBeUndefined()
    expect(normaliseHexColor('')).toBeUndefined()
    expect(normaliseHexColor(null)).toBeUndefined()
    expect(normaliseHexColor(42)).toBeUndefined()
  })

  it('cannot be used to break out of the CSS it is concatenated into', () => {
    const hostile = 'red; } body { display: none } /*'
    expect(normaliseHexColor(hostile)).toBeUndefined()
    expect(normaliseHexColor('#fff;background:url(x)')).toBeUndefined()
  })
})

describe('sanitiseTabColors', () => {
  it('returns an empty object for junk input', () => {
    expect(sanitiseTabColors(null)).toEqual({})
    expect(sanitiseTabColors('nope')).toEqual({})
    expect(sanitiseTabColors({ accentColor: 'nonsense' })).toEqual({})
  })

  it('keeps valid fields and drops invalid ones independently', () => {
    expect(sanitiseTabColors({ accentColor: '#123456', auraColor: 'pink-ish' })).toEqual({
      accentColor: '#123456'
    })
  })
})

describe('tabHasCustomColors', () => {
  it('is false for a plain tab and true once either colour is set', () => {
    expect(tabHasCustomColors({})).toBe(false)
    expect(tabHasCustomColors(null)).toBe(false)
    expect(tabHasCustomColors({ accentColor: '#abcdef' })).toBe(true)
    expect(tabHasCustomColors({ auraColor: '#abcdef' })).toBe(true)
    expect(tabHasCustomColors({ accentColor: 'invalid' })).toBe(false)
  })
})

describe('tabAccentColor / tabAuraColor', () => {
  it('falls back when the tab has nothing of its own', () => {
    expect(tabAccentColor({}, '#6366f1')).toBe('#6366f1')
    expect(tabAuraColor({}, '#6366f1')).toBe('#6366f1')
    expect(tabAccentColor(undefined, '#6366f1')).toBe('#6366f1')
  })

  it('lets the aura inherit the tab accent when no separate aura colour is set', () => {
    expect(tabAuraColor({ accentColor: '#ff0000' }, '#6366f1')).toBe('#ff0000')
    expect(tabAuraColor({ accentColor: '#ff0000', auraColor: '#00ff00' }, '#6366f1')).toBe('#00ff00')
  })
})

describe('applyTabColors', () => {
  it('writes sanitised values and leaves the rest of the tab alone', () => {
    const tab = { id: 'tab-1', title: 'Work', model: 'gemini' }
    expect(applyTabColors(tab, { accentColor: '#FF0000' })).toEqual({
      id: 'tab-1',
      title: 'Work',
      model: 'gemini',
      accentColor: '#ff0000'
    })
  })

  it('deletes cleared colours instead of storing undefined', () => {
    const tab = { id: 'tab-1', accentColor: '#ff0000', auraColor: '#00ff00' }
    const cleared = applyTabColors(tab, {})
    expect(cleared).toEqual({ id: 'tab-1' })
    expect('accentColor' in cleared).toBe(false)
  })

  it('ignores an invalid replacement rather than writing garbage', () => {
    const tab = { id: 'tab-1', accentColor: '#ff0000' }
    expect(applyTabColors(tab, { accentColor: 'not-a-colour' })).toEqual({ id: 'tab-1' })
  })

  it('does not mutate the tab it was given', () => {
    const tab = { id: 'tab-1' }
    applyTabColors(tab, { accentColor: '#ff0000' })
    expect(tab).toEqual({ id: 'tab-1' })
  })
})

describe('colorsForHistory', () => {
  it('copies only the colour fields', () => {
    expect(colorsForHistory({ accentColor: '#ff0000', auraColor: '#00ff00' })).toEqual({
      accentColor: '#ff0000',
      auraColor: '#00ff00'
    })
    expect(colorsForHistory({})).toEqual({})
    expect(colorsForHistory(null)).toEqual({})
  })
})

describe('TAB_COLOR_PRESETS', () => {
  it('are all valid hex colours with unique values', () => {
    for (const preset of TAB_COLOR_PRESETS) {
      expect(normaliseHexColor(preset.hex)).toBe(preset.hex)
      expect(preset.name.length).toBeGreaterThan(0)
    }
    expect(new Set(TAB_COLOR_PRESETS.map((p) => p.hex)).size).toBe(TAB_COLOR_PRESETS.length)
  })
})
