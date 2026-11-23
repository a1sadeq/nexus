/**
 * The overlay watchdog.
 *
 * Escape is only ever a *request*: main tells the renderer "close what is open" and the renderer
 * decides. If the renderer is wedged, or its idea of what is open has drifted from main's, that
 * request can land nowhere — the overlay stays on screen, main still believes an overlay is open so
 * it keeps swallowing every shortcut, and the native AI view stays hidden behind it. From the
 * outside that is "ctrl+comma opened Settings and nothing closes it any more", and the only way out
 * was Alt+Space to hide and re-show the window.
 *
 * So main keeps a deadline: after asking for a close, if `set_overlays_open false` has not arrived
 * within the grace period, main stops trusting the renderer's answer and closes the overlays itself.
 * The grace period is short enough to feel like the close simply worked, and long enough that a
 * renderer doing a normal amount of work is never raced.
 */

export const OVERLAY_CLOSE_GRACE_MS = 900

export interface WatchdogState {
  armedAt: number | null
}

export function createWatchdogState(): WatchdogState {
  return { armedAt: null }
}

/** Start (or keep) the deadline. Re-arming while armed does not extend it: the first Escape wins. */
export function armWatchdog(state: WatchdogState, now: number): WatchdogState {
  if (state.armedAt === null) return { armedAt: now }
  return state
}

export function disarmWatchdog(): WatchdogState {
  return { armedAt: null }
}

export function isWatchdogArmed(state: WatchdogState): boolean {
  return state.armedAt !== null
}

/** Has the renderer had its grace period and still not reported the overlay closed? */
export function isWatchdogOverdue(state: WatchdogState, now: number): boolean {
  if (state.armedAt === null) return false
  return now - state.armedAt >= OVERLAY_CLOSE_GRACE_MS
}
