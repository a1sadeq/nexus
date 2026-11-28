/**
 * Is there actually something on the glass?
 *
 * Every other check in this app asks a question that a wedged view answers correctly. `getVisible()`
 * says true because the wrapper is visible; `document.visibilityState` says `visible` because the page
 * believes it is on screen; the presentation check says the view is attached with usable bounds. All
 * three were green in the build-46 and build-47 diagnostics while the window showed nothing behind the
 * sidebar — which is why the blank kept surviving builds that were, by every log line, fixing it.
 *
 * The only witness that cannot be fooled is the pixels. `capturePage()` reads the compositor surface the
 * user would be looking at, so a surface that has been dropped comes back as one flat colour — or as an
 * empty image. That is the evidence this module grades.
 *
 * Two verdicts matter and they are not the same:
 *
 *   `blank-surface` — flat pixels, but the page has real content. The page is fine and the frame is not,
 *                     which is exactly the state "close the tab and open it again" cures.
 *   `blank-page`    — flat pixels and an empty page. A new tab, a page that has not rendered yet, a
 *                     thing the user navigated to that legitimately has nothing on it. Nothing to cure.
 *
 * Capturing is not free — it reads a frame back from the GPU — so the caller decides when to ask, and
 * this module only grades the answer.
 */

export type SurfaceVerdict = 'painted' | 'blank-surface' | 'blank-page' | 'dark-surface' | 'unknown'

export interface SurfaceSample {
  /** Did `capturePage()` produce anything at all? */
  captured: boolean
  /** `true` when every sampled pixel is within {@link UNIFORM_TOLERANCE} of the first one. */
  uniform: boolean
  /** Character count of `document.body.innerText`, or -1 when the page could not be asked. */
  domTextLength: number
  /** Is a navigation still in flight? A loading page is legitimately blank. */
  loading: boolean
  /**
   * Mean luminance of the sampled pixels, 0–255. Absent when the caller did not measure it (older
   * callers, and every test written before build 53) — in which case nothing about this verdict changes.
   */
  meanLuminance?: number
  /** Share of sampled pixels darker than {@link DARK_PIXEL_LUMINANCE}, 0–1. */
  darkFraction?: number
}

/** How far two channels may differ and still count as "the same colour". */
export const UNIFORM_TOLERANCE = 3

/** Shortest page text that counts as content. Shorter than this is a placeholder, not a lost frame. */
export const CONTENT_TEXT_THRESHOLD = 80

/** A pixel this dark is "black" for the purposes of the dark-frame measure. */
export const DARK_PIXEL_LUMINANCE = 24

/**
 * A frame below this mean luminance has content in it — the probe will say `painted` — and is still
 * unreadable. This is the case the user reported as "the error keeps showing up": not a missing frame,
 * a black one. 18/255 is low enough that a dark-themed chat page (which sits around 30–45) passes, and
 * high enough that a page painted into its own background does not.
 */
export const DARK_FRAME_LUMINANCE = 18

export interface BitmapMeasures {
  meanLuminance: number
  darkFraction: number
}

/**
 * Mean luminance and darkness of the sampled pixels.
 *
 * `isUniformBitmap` answers "is there one colour everywhere?"; this answers "how dark is what is there?".
 * A page that has been painted into its own background is not uniform, so the blank probe is right to
 * leave it alone — and the user still cannot read it. Measuring both is what makes that visible.
 */
export function measureBitmap(
  bitmap: Uint8Array | Buffer | null | undefined,
  width: number,
  height: number
): BitmapMeasures | null {
  if (!bitmap || width <= 0 || height <= 0) return null
  const pixels = Math.floor(bitmap.length / 4)
  if (pixels < 4) return null
  const samples = Math.min(1024, pixels)
  const step = Math.max(1, Math.floor(pixels / samples))
  let total = 0
  let counted = 0
  let dark = 0
  for (let i = 0; i < pixels; i += step) {
    const offset = i * 4
    if (offset + 2 >= bitmap.length) break
    const b = bitmap[offset]
    const g = bitmap[offset + 1]
    const r = bitmap[offset + 2]
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
    total += luminance
    counted++
    if (luminance < DARK_PIXEL_LUMINANCE) dark++
  }
  if (counted === 0) return null
  return {
    meanLuminance: Math.round((total / counted) * 100) / 100,
    darkFraction: Math.round((dark / counted) * 1000) / 1000
  }
}

/**
 * Read the BGRA bitmap the way a person would glance at it: same colour everywhere, or not.
 *
 * Sampling rather than comparing all pixels keeps this bounded on a 4K view — a few hundred samples
 * spread evenly across the frame catch a partially painted view as reliably as a full scan would, and a
 * fully dropped surface is uniform at every offset.
 */
export function isUniformBitmap(
  bitmap: Uint8Array | Buffer | null | undefined,
  width: number,
  height: number,
  tolerance: number = UNIFORM_TOLERANCE
): boolean {
  if (!bitmap || width <= 0 || height <= 0) return false
  const pixels = Math.floor(bitmap.length / 4)
  if (pixels < 4) return false
  const samples = Math.min(1024, pixels)
  const step = Math.max(1, Math.floor(pixels / samples))
  let firstR = -1
  let firstG = -1
  let firstB = -1
  for (let i = 0; i < pixels; i += step) {
    const offset = i * 4
    if (offset + 2 >= bitmap.length) break
    const b = bitmap[offset]
    const g = bitmap[offset + 1]
    const r = bitmap[offset + 2]
    if (firstR < 0) {
      firstR = r
      firstG = g
      firstB = b
      continue
    }
    if (
      Math.abs(r - firstR) > tolerance ||
      Math.abs(g - firstG) > tolerance ||
      Math.abs(b - firstB) > tolerance
    ) {
      return false
    }
  }
  return firstR >= 0
}

/** Grade a capture. Pure, so every branch is testable without a GPU. */
export function judgeSurface(sample: SurfaceSample): SurfaceVerdict {
  if (!sample.captured) return 'unknown'
  // A page that is still loading is blank on purpose. Restarting it would abort the load the user asked
  // for, which is worse than the frame they are missing for another few hundred milliseconds.
  if (sample.loading) return 'unknown'
  // Painted, and black. The frame is not missing — it is unreadable, which is a different fault with a
  // different cause, and reporting it as `painted` is how it survived three builds.
  if (!sample.uniform) {
    if (
      typeof sample.meanLuminance === 'number' &&
      Number.isFinite(sample.meanLuminance) &&
      sample.meanLuminance < DARK_FRAME_LUMINANCE &&
      sample.domTextLength >= CONTENT_TEXT_THRESHOLD
    ) {
      return 'dark-surface'
    }
    return 'painted'
  }
  if (sample.domTextLength < 0) return 'unknown'
  return sample.domTextLength >= CONTENT_TEXT_THRESHOLD ? 'blank-surface' : 'blank-page'
}

/** How many automatic rebuilds a single tab may be given in one run of the app. */
export const MAX_AUTOMATIC_RESTARTS_PER_TAB = 2

/** Two rebuilds closer together than this are almost certainly the same wedge being chased. */
export const RESTART_COOLDOWN_MS = 20000

export interface RestartBudget {
  count: number
  lastAt: number
}

/**
 * Should a `blank-surface` verdict be answered with a rebuild?
 *
 * Deliberately mean: the rebuild costs the page's live state (it comes back at the same URL and the same
 * scroll position, but the conversation is reloaded), so it needs evidence, a cooldown and a hard cap.
 * Returning a reason rather than a boolean lets the trace say why nothing happened.
 */
export function mayRestartSurface(
  budget: RestartBudget | undefined,
  now: number
): { allowed: boolean; reason: string } {
  if (!budget) return { allowed: true, reason: 'first time' }
  if (budget.count >= MAX_AUTOMATIC_RESTARTS_PER_TAB) {
    return { allowed: false, reason: `already rebuilt ${budget.count} times this run` }
  }
  const since = now - budget.lastAt
  if (since < RESTART_COOLDOWN_MS) {
    return { allowed: false, reason: `rebuilt ${since}ms ago` }
  }
  return { allowed: true, reason: `rebuild ${budget.count + 1} of ${MAX_AUTOMATIC_RESTARTS_PER_TAB}` }
}
