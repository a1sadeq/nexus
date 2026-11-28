import { describe, it, expect } from 'vitest'
import {
  EMPTY_APPEARANCE,
  UNREADABLE_CONTRAST,
  buildAppearanceScript,
  colourLuminance,
  contrastRatio,
  judgeReadability,
  parseAppearance
} from './viewForensics'

/**
 * Build 53 — the page is the one witness nobody asked.
 *
 * The report that prompted this build said the blank view "keeps showing up after reopening the tab".
 * Every witness the app had — `getVisible()`, `document.visibilityState`, the presentation check, the
 * pixel probe — described the view, and all of them said the view was fine. None of them could say what
 * the *page* looked like, which is the difference between a frame that was never painted and a frame
 * that was painted into its own background.
 *
 * These tests pin the reading of the page's own answer: the colour maths (so "unreadable" is a number and
 * not an opinion), the parsing (so a page that answers oddly does not become a false alarm) and the
 * script (so it stays read-only).
 */

describe('colour luminance', () => {
  it('reads the forms getComputedStyle actually returns', () => {
    expect(colourLuminance('rgb(0, 0, 0)')).toBe(0)
    expect(colourLuminance('rgb(255, 255, 255)')).toBeCloseTo(255, 0)
    expect(colourLuminance('rgba(255, 255, 255, 0.5)')).toBeCloseTo(255, 0)
    expect(colourLuminance('rgb(255 255 255 / 90%)')).toBeCloseTo(255, 0)
  })

  it('reads hex, because the repair colours are written as hex', () => {
    expect(colourLuminance('#0d0d12')).toBeLessThan(20)
    expect(colourLuminance('#f2f2f7')).toBeGreaterThan(235)
    expect(colourLuminance('#fff')).toBeCloseTo(255, 0)
  })

  it('refuses to guess a form it has never seen', () => {
    // Inventing a value here is how a working page gets "repaired" into an unreadable one.
    expect(colourLuminance('color(srgb 1 1 1)')).toBeNull()
    expect(colourLuminance('')).toBeNull()
    expect(colourLuminance('not a colour')).toBeNull()
  })

  it('treats transparent as no light at all', () => {
    expect(colourLuminance('transparent')).toBe(0)
    expect(colourLuminance('rgba(0, 0, 0, 0)')).toBe(0)
  })
})

describe('contrast', () => {
  it('is 1 for identical colours and 21 for black on white', () => {
    expect(contrastRatio(0, 0)).toBe(1)
    expect(contrastRatio(0, 255)).toBeCloseTo(21, 5)
    expect(contrastRatio(120, 120)).toBe(1)
  })

  it('does not care which colour came first', () => {
    expect(contrastRatio(0, 255)).toBe(contrastRatio(255, 0))
  })
})

describe('judging readability', () => {
  const appearance = (over: Partial<typeof EMPTY_APPEARANCE>) => ({ ...EMPTY_APPEARANCE, ok: true, ...over })

  it('calls light text on a white page unreadable — the case the user could not name', () => {
    // A light-themed page that our stylesheet gave `text: #eaeaea` to: painted, not blank, and nobody can
    // read a word of it.
    const verdict = judgeReadability(appearance({ bodyBg: 'rgb(255, 255, 255)', bodyColor: 'rgb(234, 234, 234)' }))
    expect(verdict.unreadable).toBe(true)
    expect(verdict.ratio).not.toBeNull()
    expect((verdict.ratio as number) < UNREADABLE_CONTRAST).toBe(true)
  })

  it('leaves a genuinely dark page alone', () => {
    const verdict = judgeReadability(appearance({ bodyBg: 'rgb(20, 20, 22)', bodyColor: 'rgb(230, 230, 232)' }))
    expect(verdict.unreadable).toBe(false)
    expect((verdict.ratio as number) > 7).toBe(true)
  })

  it('falls back to html when the page sets its colours there', () => {
    const verdict = judgeReadability(
      appearance({ bodyBg: '', bodyColor: '', htmlBg: 'rgb(255, 255, 255)', htmlColor: 'rgb(250, 250, 250)' })
    )
    expect(verdict.unreadable).toBe(true)
  })

  it('prefers body over html, so a default html black does not condemn a dark site', () => {
    // html defaults to black-on-transparent; comparing that against a dark body background would report
    // every dark theme as a fault.
    const verdict = judgeReadability(
      appearance({
        bodyBg: 'rgb(18, 18, 20)',
        bodyColor: 'rgb(224, 224, 226)',
        htmlBg: 'rgba(0, 0, 0, 0)',
        htmlColor: 'rgb(0, 0, 0)'
      })
    )
    expect(verdict.unreadable).toBe(false)
  })

  it('reports nothing rather than a guess when the page did not answer', () => {
    expect(judgeReadability({ ...EMPTY_APPEARANCE, ok: false }).unreadable).toBe(false)
    expect(judgeReadability({ ...EMPTY_APPEARANCE, ok: false }).ratio).toBeNull()
  })
})

describe('parsing what the page said', () => {
  it('accepts a complete answer', () => {
    const parsed = parseAppearance({
      url: 'https://example.test/chat',
      title: 'Chat',
      visibilityState: 'visible',
      viewport: { width: 1200, height: 800, dpr: 2 },
      scroll: { scrollHeight: 4000, clientHeight: 800, scrollbarPx: 5 },
      bodyBg: 'rgb(255, 255, 255)',
      bodyColor: 'rgb(20, 20, 20)',
      styleSheets: 7
    })
    expect(parsed.ok).toBe(true)
    expect(parsed.viewport.width).toBe(1200)
    expect(parsed.scroll.scrollbarPx).toBe(5)
    expect(parsed.styleSheets).toBe(7)
  })

  it('turns an error from the page into a record that explains itself', () => {
    const parsed = parseAppearance({ error: 'SecurityError: blocked a frame' })
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toContain('SecurityError')
  })

  it('turns no answer at all into a record, not a throw', () => {
    expect(parseAppearance(null).ok).toBe(false)
    expect(parseAppearance(undefined).ok).toBe(false)
    expect(parseAppearance('nonsense').ok).toBe(false)
  })

  it('fills gaps rather than trusting a partial answer', () => {
    const parsed = parseAppearance({ url: 'about:blank' })
    expect(parsed.ok).toBe(true)
    expect(parsed.viewport).toEqual({ width: 0, height: 0, dpr: 1 })
    expect(parsed.styleSheets).toBe(0)
  })
})

describe('the script itself', () => {
  const script = buildAppearanceScript()

  it('is read-only', () => {
    // A diagnostic that writes to the page changes the thing it is measuring.
    expect(script).not.toMatch(/\.style\s*=/)
    expect(script).not.toMatch(/setAttribute|appendChild|innerHTML\s*=/)
    expect(script).not.toMatch(/localStorage|sessionStorage/)
  })

  it('reports the few things the verdict needs', () => {
    for (const key of ['backgroundColor', 'color', 'visibilityState', 'scrollbarPx', 'styleSheets']) {
      expect(script).toContain(key)
    }
  })

  it('copes with a page that throws while being read', () => {
    expect(script).toContain('catch (e)')
    expect(script).toContain('error: String')
  })
})
