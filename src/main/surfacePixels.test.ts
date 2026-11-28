import { describe, it, expect } from 'vitest'
import {
  CONTENT_TEXT_THRESHOLD,
  MAX_AUTOMATIC_RESTARTS_PER_TAB,
  RESTART_COOLDOWN_MS,
  isUniformBitmap,
  judgeSurface,
  mayRestartSurface
} from './surfacePixels'

/**
 * Build 48 — the pixels are the only witness that did not lie.
 *
 * Build 47 shipped a flip for the overlay transition and the user still got a blank view, on a tab that
 * had been blank before. Every check in the chain — `getVisible()`, `document.visibilityState`, the
 * presentation check — reported a healthy view, because they all ask about the wrapper, the page or the
 * geometry and never about the frame. These tests pin down the grading that replaces that guesswork, and
 * the budget that keeps a false verdict from reloading a page the user was reading.
 */

const solid = (r: number, g: number, b: number, pixels = 64): Buffer => {
  const buffer = Buffer.alloc(pixels * 4)
  for (let i = 0; i < pixels; i += 1) {
    buffer[i * 4] = b
    buffer[i * 4 + 1] = g
    buffer[i * 4 + 2] = r
    buffer[i * 4 + 3] = 255
  }
  return buffer
}

describe('reading a captured frame', () => {
  it('calls one flat colour uniform — the signature of a dropped surface', () => {
    expect(isUniformBitmap(solid(20, 26, 46), 8, 8)).toBe(true)
  })

  it('tolerates the tiny differences a compositor leaves behind', () => {
    const buffer = solid(20, 26, 46)
    buffer[4] = 48 // two steps in the blue channel of one pixel
    expect(isUniformBitmap(buffer, 8, 8)).toBe(true)
  })

  it('calls a frame with real content painted', () => {
    const buffer = solid(20, 26, 46)
    buffer[8 * 4 + 2] = 200
    buffer[8 * 4 + 1] = 30
    expect(isUniformBitmap(buffer, 8, 8)).toBe(false)
  })

  it('refuses to grade an image it cannot read', () => {
    expect(isUniformBitmap(null, 8, 8)).toBe(false)
    expect(isUniformBitmap(Buffer.alloc(0), 8, 8)).toBe(false)
    expect(isUniformBitmap(solid(0, 0, 0), 0, 0)).toBe(false)
  })
})

describe('grading the capture', () => {
  it('separates a lost frame from a page that simply has nothing on it', () => {
    expect(judgeSurface({ captured: true, uniform: true, domTextLength: 900, loading: false })).toBe(
      'blank-surface'
    )
    expect(judgeSurface({ captured: true, uniform: true, domTextLength: 5, loading: false })).toBe(
      'blank-page'
    )
  })

  it('never grades a loading page — restarting it would abort the load the user asked for', () => {
    expect(judgeSurface({ captured: true, uniform: true, domTextLength: 900, loading: true })).toBe(
      'unknown'
    )
  })

  it('says nothing when the frame could not be read or the page could not be asked', () => {
    expect(judgeSurface({ captured: false, uniform: false, domTextLength: 900, loading: false })).toBe(
      'unknown'
    )
    expect(judgeSurface({ captured: true, uniform: true, domTextLength: -1, loading: false })).toBe(
      'unknown'
    )
  })

  it('reports a painted view as painted, whatever the page text says', () => {
    expect(judgeSurface({ captured: true, uniform: false, domTextLength: 0, loading: false })).toBe(
      'painted'
    )
    expect(CONTENT_TEXT_THRESHOLD).toBeGreaterThan(0)
  })
})

describe('the rebuild budget', () => {
  it('allows the first rebuild', () => {
    expect(mayRestartSurface(undefined, 1000).allowed).toBe(true)
  })

  it('refuses a second attempt inside the cooldown', () => {
    const decision = mayRestartSurface({ count: 1, lastAt: 1000 }, 1000 + RESTART_COOLDOWN_MS - 1)
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('rebuilt')
  })

  it('allows one more after the cooldown, then stops for good', () => {
    const later = 1000 + RESTART_COOLDOWN_MS + 1
    expect(mayRestartSurface({ count: 1, lastAt: 1000 }, later).allowed).toBe(true)
    expect(
      mayRestartSurface(
        { count: MAX_AUTOMATIC_RESTARTS_PER_TAB, lastAt: 0 },
        later + RESTART_COOLDOWN_MS
      ).allowed
    ).toBe(false)
  })
})
