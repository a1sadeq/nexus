import { describe, it, expect } from 'vitest'
import {
  CONTENT_TEXT_THRESHOLD,
  DARK_FRAME_LUMINANCE,
  DARK_PIXEL_LUMINANCE,
  judgeSurface,
  measureBitmap
} from './surfacePixels'

/**
 * Build 53 — "painted" is not the same as "readable".
 *
 * Build 48 made the probe grade the frame, and it graded it on uniformity: is there more than one colour
 * in here? A page painted into its own background passes that test — it is a real, textured image — and so
 * the probe said `painted`, the app did nothing, and the user went on looking at a black page. The
 * verdict was never wrong about the pixels; it was answering a question one step too shallow.
 */

/** A BGRA buffer of one flat colour, the way `capturePage().getBitmap()` presents it. */
function flat(r: number, g: number, b: number, pixels = 64): Buffer {
  const buffer = Buffer.alloc(pixels * 4)
  for (let i = 0; i < pixels; i++) {
    buffer[i * 4] = b
    buffer[i * 4 + 1] = g
    buffer[i * 4 + 2] = r
    buffer[i * 4 + 3] = 255
  }
  return buffer
}

/** A buffer that alternates dark and slightly-less-dark pixels: textured, and unreadable. */
function mottledDark(pixels = 64): Buffer {
  const buffer = Buffer.alloc(pixels * 4)
  for (let i = 0; i < pixels; i++) {
    const level = i % 2 === 0 ? 4 : 12
    buffer[i * 4] = level
    buffer[i * 4 + 1] = level
    buffer[i * 4 + 2] = level
    buffer[i * 4 + 3] = 255
  }
  return buffer
}

describe('measuring a frame', () => {
  it('reports black as black', () => {
    const measures = measureBitmap(flat(0, 0, 0), 8, 8)
    expect(measures?.meanLuminance).toBe(0)
    expect(measures?.darkFraction).toBe(1)
  })

  it('reports white as white', () => {
    const measures = measureBitmap(flat(255, 255, 255), 8, 8)
    expect(measures?.meanLuminance).toBeCloseTo(255, 0)
    expect(measures?.darkFraction).toBe(0)
  })

  it('weights the channels the way the eye does', () => {
    // Pure green carries most of the luminance; pure blue almost none.
    expect((measureBitmap(flat(0, 255, 0), 8, 8)?.meanLuminance ?? 0)).toBeGreaterThan(180)
    expect((measureBitmap(flat(0, 0, 255), 8, 8)?.meanLuminance ?? 0)).toBeLessThan(20)
  })

  it('reports a dark page as a large dark fraction without calling it uniform', () => {
    const measures = measureBitmap(mottledDark(), 8, 8)
    expect(measures?.meanLuminance).toBeLessThan(DARK_FRAME_LUMINANCE)
    expect(measures?.darkFraction).toBe(1)
  })

  it('returns nothing rather than a made-up number', () => {
    expect(measureBitmap(null, 8, 8)).toBeNull()
    expect(measureBitmap(Buffer.alloc(0), 8, 8)).toBeNull()
    expect(measureBitmap(flat(0, 0, 0), 0, 8)).toBeNull()
  })
})

describe('grading a frame', () => {
  const sample = (over: Record<string, unknown>) => ({
    captured: true,
    uniform: false,
    domTextLength: 500,
    loading: false,
    ...over
  })

  it('still says blank-surface when there is nothing in the frame', () => {
    expect(judgeSurface(sample({ uniform: true }))).toBe('blank-surface')
  })

  it('says painted for an ordinary light frame', () => {
    expect(judgeSurface(sample({ meanLuminance: 210, darkFraction: 0.02 }))).toBe('painted')
  })

  it('says dark-surface when the page has content and the frame is nearly black', () => {
    expect(judgeSurface(sample({ meanLuminance: 6, darkFraction: 0.95 }))).toBe('dark-surface')
  })

  it('does not call a legitimately dark chat page a fault', () => {
    // Real dark themes sit far above the threshold; only a page painted into its own background is this flat.
    expect(judgeSurface(sample({ meanLuminance: DARK_FRAME_LUMINANCE + 12, darkFraction: 0.8 }))).toBe('painted')
  })

  it('says painted when there is no page content, however dark the frame', () => {
    // A page mid-load, or a site that is genuinely just a dark background, has nothing to be unreadable.
    expect(judgeSurface(sample({ meanLuminance: 3, domTextLength: CONTENT_TEXT_THRESHOLD - 1 }))).toBe('painted')
  })

  it('leaves every older caller untouched — no measure, no new verdict', () => {
    expect(judgeSurface(sample({}))).toBe('painted')
    expect(judgeSurface(sample({ uniform: true, domTextLength: 0 }))).toBe('blank-page')
  })

  it('keeps the dark pixel cutoff below the frame cutoff', () => {
    // A pixel counts as dark well before the frame does; the frame verdict needs the whole picture to be.
    expect(DARK_PIXEL_LUMINANCE).toBeGreaterThan(DARK_FRAME_LUMINANCE)
  })
})
