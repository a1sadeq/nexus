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
  setVisible?: (visible: boolean) => void
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
  /**
   * Ignore the anti-burst cooldown, and ask a second time one frame later.
   *
   * The cooldown exists because show/focus/restore/resize all fire in bursts and one nudge is enough for
   * them. It is the wrong behaviour for the one case that actually loses the surface: a view that was
   * hidden and is being shown again can arrive while a nudge from a moment ago is still cooling down, and
   * then *nothing* forces a frame. `force` is for known-lost-surface transitions only (overlay closed,
   * window restored, surface re-attached).
   */
  force?: boolean
  /**
   * Flip the view's visibility (hide, then show one frame later) as part of the repaint.
   *
   * This is the strongest lever there is, because it is the one users find by hand: opening Settings
   * hides the page and closing it shows it again, and that — not any bounds change — is what brings a
   * discarded surface back. `setVisible(false)` makes Chromium release the surface; `setVisible(true)`
   * makes it build a new one. Use it for transitions where the surface is *known* to be gone (coming
   * back from an overlay, a tab that was in the background, after a re-attach), not for ordinary
   * layout changes.
   */
  flipVisibility?: boolean
  /**
   * How the flip waits for the page to notice.
   *
   * A synchronous hide-then-show in one turn is not a visibility transition as far as the page is
   * concerned: `setVisible(false)` and `setVisible(true)` both queue work for the renderer, and if the
   * show lands before the renderer has processed the hide, the page's `document.visibilityState` never
   * changes and no new frame is ever built — the surface stays blank and the app logs a flip it never
   * really made. That is exactly the shape of the build-44 diagnostics, and it is why *holding* the view
   * hidden (opening Settings, switching tabs) fixes it when a 24 ms flip does not. With a gate, the show
   * is deferred until the page itself reports hidden (or the deadline passes), so the transition is real.
   */
  flipGate?: FlipGate
  /** Never keep a view hidden longer than this, gate or no gate. */
  maxFlipHiddenMs?: number
  /**
   * May the view be shown again when the flip finishes?
   *
   * A gated flip can take several hundred milliseconds, and the user is free to switch tabs inside that
   * window. Without this check the show would land on a view that is now in the background and put it on
   * top of the tab the user is actually looking at. Defaults to "yes", so a caller that does not need the
   * guard behaves exactly as before.
   */
  flipShouldRestore?: () => boolean
}

export interface FlipGate {
  /** Resolves true once the page reports itself hidden; false if it never did. Never rejects. */
  waitForPageHidden: (deadlineMs: number) => Promise<boolean>
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
  const forced = options.force === true
  if (!forced && previous !== undefined && now - previous < minInterval) {
    // Coalesce: a nudge happened moments ago; invalidate() above is enough for this one.
    return invalidated ? 'invalidated' : 'skipped'
  }
  lastNudgeAt.set(view as object, now)

  const scheduledBounds: Rectangle = bounds
  const nudgedBounds: Rectangle = { ...bounds, width: bounds.width - 1 }
  const flip = options.flipVisibility === true && typeof view.setVisible === 'function'
  if (flip) {
    // Half of the workaround: the page stops being presented, so the compositor lets go of the stale
    // surface instead of keeping it on screen as a rectangle of background.
    try {
      view.setVisible?.(false)
    } catch (error) {
      log(`visibility hide failed: ${(error as Error)?.message ?? error}`)
    }
  }
  const schedule =
    options.schedule ?? ((fn: () => void, ms: number) => void setTimeout(fn, ms))

  try {
    setBounds(nudgedBounds)
  } catch (error) {
    log(`nudge setBounds failed: ${(error as Error)?.message ?? error}`)
    return invalidated ? 'invalidated' : 'skipped'
  }

  let restored = false
  const restore = (): void => {
    if (restored) return
    restored = true
    if (safeDestroyed(view)) return
    try {
      view.setBounds?.(scheduledBounds)
    } catch (error) {
      log(`restore setBounds failed: ${(error as Error)?.message ?? error}`)
    }
    if (flip) {
      // The other half: presented again, with the new geometry already in place, so the frame is built
      // for the surface the user is actually looking at — unless the tab moved on while we waited.
      let allowed = true
      try {
        allowed = options.flipShouldRestore ? options.flipShouldRestore() : true
      } catch {
        allowed = true
      }
      if (!allowed) {
        log('flip: the view is no longer the one on screen — left hidden, as the tab switch wants')
      } else {
        try {
          view.setVisible?.(true)
        } catch (error) {
          log(`visibility restore failed: ${(error as Error)?.message ?? error}`)
        }
      }
    }
    // A forced repaint asks once more after the geometry is back: the first invalidate() can be served
    // from a frame that was already in flight, and on the compositor paths that lose a surface the
    // second ask is the one that lands.
    if (forced) invalidate(view, log)
  }

  const maxHidden = options.flipGate ? (options.maxFlipHiddenMs ?? 700) : 0
  const gate = flip ? options.flipGate : undefined
  if (gate) {
    // Never leave the view hidden, whatever the gate does.
    try {
      schedule(restore, maxHidden)
    } catch {
      /* the promise below still restores */
    }
    const startedAt = Date.now()
    void gate
      .waitForPageHidden(maxHidden)
      .then((acknowledged) => {
        log(
          `flip: the page ${acknowledged ? 'reported itself hidden' : 'never reported hidden'} after ${
            Date.now() - startedAt
          }ms — showing the view again`
        )
        restore()
      })
      .catch(() => restore())
  } else {
    try {
      schedule(restore, options.restoreDelayMs ?? DEFAULT_RESTORE_DELAY_MS)
    } catch {
      // If the scheduler is unavailable, restore synchronously rather than leave bad geometry.
      restore()
    }
  }

  log(
    `repaint (${reason}): ${flip ? 'hide/show + ' : ''}${invalidated ? 'invalidate + ' : ''}1px nudge${
      forced ? ' (forced)' : ''
    }`
  )
  return invalidated ? 'invalidated+nudged' : 'nudged'
}
