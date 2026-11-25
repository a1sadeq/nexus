/**
 * What kind of repaint a tab's native view needs when it is being presented again.
 *
 * A `WebContentsView` is a compositor surface, not a DOM node: telling it to show itself is not the same
 * as making Chromium draw it. Three ways a surface goes missing, and they need different answers.
 *
 * 1. **It was hidden** — an overlay, the window minimised, another tab in front. Chromium released the
 *    surface, so showing it again gives you a live but blank rectangle until something makes it draw.
 * 2. **It was hidden by the activation itself.** `activate_tab` shows the view and records that it did,
 *    and then the reconcile that follows asks "was this hidden?" — and is told no, because activation
 *    just said otherwise. This is the tab switch that comes back window-coloured, and it is why the same
 *    switch "works the second time".
 * 3. **The geometry changed** — a resize, a sidebar collapse. The compositor is already re-laying out for
 *    the new rectangle, so nothing needs asking for: `none`.
 *
 * `strong` means: hide it, show it again on the next frame, invalidate, and nudge the geometry — the
 * programme version of the workaround users find for themselves (open Settings, close Settings).
 */
export type SurfaceReturnKind = 'strong' | 'cheap' | 'none'

export interface SurfaceReturnInput {
  /** The view is supposed to be on screen right now. */
  shouldShow: boolean
  /** The bounds we just applied differ from the ones the view already had. */
  geometryChanged: boolean
  /** `presentedVisible` said the view was hidden. */
  recordedHidden: boolean
  /** `activate_tab` showed a view that was not on screen a moment ago. */
  resumedByActivation: boolean
  /** We have real, non-zero bounds to restore after a nudge. */
  boundsUsable: boolean
}

export function classifySurfaceReturn(input: SurfaceReturnInput): SurfaceReturnKind {
  if (!input.shouldShow) return 'none'
  if (input.recordedHidden || input.resumedByActivation) return 'strong'
  // Nothing moved, so nothing will redraw on its own: ask. Same when there are no usable bounds to nudge
  // — an invalidate is the only lever left. If the geometry really did change, the compositor is already
  // painting the new rectangle and a nudge would be one more gratuitous frame.
  if (!input.geometryChanged || !input.boundsUsable) return 'cheap'
  return 'none'
}
