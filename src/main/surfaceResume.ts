/**
 * What to do to the active view when the window comes back.
 *
 * The bug: "the AI webview goes blank, and I have to switch tabs or open/close settings to get it back."
 * The build-43 diagnostics show how it happens. After 4.5 hours with the window hidden, the first thing
 * the app did on resume was:
 *
 *   nav #1393 +27691763ms view    setVisible (reconcile-presentation) {visible=true}
 *   nav #1394 +27691763ms view    repaint (reconcile-presentation) {geometryChanged=false
 *                                  comingBackFromHidden=false ...}
 *   nav #1395 +27691763ms repair  repair running — window resumed {visible=true}
 *   nav #1396 +27691763ms view    detach (repair) — aborts any load in flight
 *   nav #1397 +27691763ms view    attach (repair)
 *
 * Two mistakes in those five lines.
 *
 *   1. `comingBackFromHidden=false`. The window had been hidden for hours, but nothing had recorded it:
 *      the suspend path throttled and muted the views and never touched their recorded visibility. So
 *      the one transition that does drop a compositor surface took the *weak* repaint branch.
 *   2. The resume then re-attached the view unconditionally. A detach/re-attach is the most forceful
 *      repair there is, and it is also the one that can leave the window with no surface behind the
 *      page at all — the same detach/re-attach that build 33 identified as *creating* the blank view
 *      ("a detach/attach in the half-second after an overlay closed is what created the blank
 *      surface"). It is not evidence of anything: the window was resumed, not broken.
 *
 * The user's own workaround is the proof of what does work: switching tabs or opening and closing
 * Settings flips visibility, and the trace shows that recovering the view —
 *
 *   nav #1493 +27700019ms view    repaint (reconcile-presentation) {comingBackFromHidden=true ...}
 *   nav #1494 +27700019ms view    repaint forced — the view was hidden ... {outcome=invalidated+nudged}
 *
 * So the rule is: act on evidence. A view that is missing from the window is put back. A view that is in
 * the window is repainted — strongly, because it has been hidden — and never detached. Repeated,
 * failed repaints still escalate to a re-attach through `SurfaceRepairPolicy`, which is the signal that
 * actually means "the cheap path is not working".
 */

/**
 * Note on strength: a resume always repaints *forcibly* (invalidate, a real 1 px geometry change, then a
 * second invalidate once a frame could have been produced). The cheap repaint is right for a tab switch,
 * where the app knows the surface is fine; a resume is the transition where it is not, and the very
 * bookkeeping that would say "this view was never hidden" is what the build-43 trace shows failing
 * (`wasHidden=false` after 4.5 hours). A resume is rare enough that the strong path costs nothing.
 */
export type ResumeSurfaceAction =
  /** The view is not attached to the window at all: put it back (this keeps the page). */
  | 'repair'
  /** Attached and coming back: strong repaint (invalidate + real 1 px geometry change). No detach. */
  | 'repaint'
  /** The window produced another resume a moment ago; one refresh per transition is enough. */
  | 'skip'

export interface ResumeSurfaceInput {
  /**
   * Is the view a child of the window's content view? `null` when the platform/build cannot say —
   * in which case the view is assumed present, because the failure that needs `repair` is a view
   * that is definitely absent, not one that might be.
   */
  attached: boolean | null
  /** Had the view been hidden when the window went away? Drives how strong the repaint is. */
  wasHidden: boolean
  /** `Date.now() - lastRefreshAt`. */
  msSinceLastRefresh: number
  /** A load is in flight: a detach would abort it, so the caller defers those anyway. */
  navigationInFlight?: boolean
  /** Minimum spacing between resume refreshes. Show + restore + powerMonitor resume arrive together. */
  cooldownMs?: number
}

export const RESUME_REFRESH_COOLDOWN_MS = 1500

/**
 * Decide what the resume path should do. Pure, so the interesting part can be tested without Electron.
 */
export function decideResumeSurfaceAction(input: ResumeSurfaceInput): ResumeSurfaceAction {
  // Only a view that is *known* to be missing from the window needs putting back. `null` (unknown) is
  // not evidence, and a wrong re-attach is exactly what produced the blank view. This is checked before
  // the cooldown because a missing view does not get better by waiting.
  if (input.attached === false) return 'repair'
  const cooldown = input.cooldownMs ?? RESUME_REFRESH_COOLDOWN_MS
  if (Number.isFinite(input.msSinceLastRefresh) && input.msSinceLastRefresh >= 0 && input.msSinceLastRefresh < cooldown) {
    return 'skip'
  }
  return 'repaint'
}
