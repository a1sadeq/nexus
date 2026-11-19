import type { Rectangle } from 'electron'

/**
 * Forced repaint for native `WebContentsView` surfaces.
 *
 * The bug this exists for: a tab's webview can end up showing the window background
 * ("dark tab") after the window is hidden/minimised/occluded or after the compositor
 * discards a surface. Re-applying the *same* bounds and the *same* visibility does not
 * make Chromium produce a frame — the stale surface just stays on screen until something
 * flips visibility (opening a settings overlay, switching tabs, hiding/showing the window),
 * which is exactly what users discover as a "workaround".
 *
 * Two independent levers, because either alone is unreliable across platforms/drivers:
 *   1. `webContents.invalidate()` — asks Chromium to schedule a full repaint.
 *   2. a 1px bounds nudge restored on the next tick — a real geometry change, which forces
 *      the compositor to redraw even when `invalidate()` is a no-op.
 *
 * Guards: never touches a destroyed webContents, never sends a zero/negative size, never
 * nudges more often than `minIntervalMs` (show/focus/restore/resize all fire in bursts),
 * and always restores the caller's authoritative bounds.
 */

export interface RepaintViewLike {
  webContents?: {
    invalidate?: () => void
    isDestroyed?: () => boolean
  }
  setBounds?: (bounds: Rectangle) => void
  getBounds?: () => Rectangle
}

export interface RepaintOptions {
  /** Authoritative bounds to restore after the nudge. Falls back to `getBounds()`. */
  bounds?: Rectangle | null
  /** How long the 1px nudge stays applied. */
  restoreDelayMs?: number
  /** Minimum spacing between nudges for the same view. */
  minIntervalMs?: number
  /** Injectable clock (tests). */
  now?: number
  /** Injectable scheduler (tests). */
  schedule?: (fn: () => void, ms: number) => void
  /** Why we are repainting — logged, so a recurrence is diagnosable. */
  reason?: string
  log?: (message: string) => void
}

export type RepaintOutcome = 'invalidated' | 'invalidated+nudged' | 'nudged' | 'skipped'

const DEFAULT_RESTORE_DELAY_MS = 24
const DEFAULT_MIN_INTERVAL_MS = 400

/** view → timestamp of the last nudge, so bursts collapse into one. */
const lastNudgeAt = new WeakMap<object, number>()

/** Test helper: forget cooldowns so a suite can assert the first-nudge path repeatedly. */
export function resetRepaintState(): void {
  // WeakMap has no clear(); a fresh module-scope map is the only way, so callers that need
  // a reset should use distinct view objects. Kept for symmetry/documentation.
}

const isUsableRect = (rect: Rectangle | null | undefined): rect is Rectangle =>
  Boolean(
    rect &&
      Number.isFinite(rect.x) &&
      Number.isFinite(rect.y) &&
      Number.isFinite(rect.width) &&
      Number.isFinite(rect.height) &&
      rect.width >= 2 &&
      rect.height >= 2
  )

function safeDestroyed(view: RepaintViewLike): boolean {
  try {
    return view.webContents?.isDestroyed?.() === true
  } catch {
    return true
  }
}

function invalidate(view: RepaintViewLike, log: (m: string) => void): boolean {
  const invalidateFn = view.webContents?.invalidate
  if (typeof invalidateFn !== 'function') return false
  try {
    invalidateFn.call(view.webContents)
    return true
  } catch (error) {
    log(`invalidate() failed: ${(error as Error)?.message ?? error}`)
    return false
  }
}

/**
 * Force a visible surface to repaint. Safe to call on any view, as often as you like.
 */
export function forceViewRepaint(
  view: RepaintViewLike | null | undefined,
  options: RepaintOptions = {}
): RepaintOutcome {
  const log = options.log ?? (() => undefined)
  if (!view) return 'skipped'
  if (safeDestroyed(view)) return 'skipped'

  const reason = options.reason ?? 'unspecified'
  const invalidated = invalidate(view, log)

  const bounds = options.bounds ?? (typeof view.getBounds === 'function' ? view.getBounds() : null)
  const setBounds = typeof view.setBounds === 'function' ? view.setBounds : undefined
  const canNudge = isUsableRect(bounds) && setBounds !== undefined

  if (!canNudge || !isUsableRect(bounds) || !setBounds) {
    // A hidden or zero-sized view cannot be nudged; invalidate() was still attempted.
    if (!invalidated) log(`no repaint path available (${reason})`)
    return invalidated ? 'invalidated' : 'skipped'
  }

  const now = options.now ?? Date.now()
  const minInterval = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
  const previous = lastNudgeAt.get(view as object)
  if (previous !== undefined && now - previous < minInterval) {
    // Coalesce: a nudge happened moments ago; invalidate() above is enough for this one.
    return invalidated ? 'invalidated' : 'skipped'
  }
  lastNudgeAt.set(view as object, now)

  const scheduledBounds: Rectangle = bounds
  const nudgedBounds: Rectangle = { ...bounds, width: bounds.width - 1 }
  const schedule =
    options.schedule ?? ((fn: () => void, ms: number) => void setTimeout(fn, ms))

  try {
    setBounds(nudgedBounds)
  } catch (error) {
    log(`nudge setBounds failed: ${(error as Error)?.message ?? error}`)
    return invalidated ? 'invalidated' : 'skipped'
  }

  const restore = (): void => {
    if (safeDestroyed(view)) return
    try {
      view.setBounds?.(scheduledBounds)
    } catch (error) {
      log(`restore setBounds failed: ${(error as Error)?.message ?? error}`)
    }
  }

  try {
    schedule(restore, options.restoreDelayMs ?? DEFAULT_RESTORE_DELAY_MS)
  } catch {
    // If the scheduler is unavailable, restore synchronously rather than leave bad geometry.
    restore()
  }

  log(`repaint (${reason}): ${invalidated ? 'invalidate + ' : ''}1px nudge`)
  return invalidated ? 'invalidated+nudged' : 'nudged'
}
