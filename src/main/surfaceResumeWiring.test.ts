import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Build 44, asserted where it is wired: the three things in the build-43 diagnostics that turned a
 * resumed window into a blank AI view.
 *
 * From `nexus-diagnostics-2026-11-27T00-49-24.json` (the file the user sent), after 4.5 hours hidden:
 *
 *   nav #1393 +27691763ms view    setVisible (reconcile-presentation) {visible=true}
 *   nav #1394 +27691763ms view    repaint (reconcile-presentation) {geometryChanged=false
 *                                  comingBackFromHidden=false wasHidden=false}
 *   nav #1395 +27691763ms repair  repair running — window resumed {visible=true}
 *   nav #1396 +27691763ms view    detach (repair) — aborts any load in flight
 *   nav #1397 +27691763ms view    attach (repair)
 *   …
 *   nav #1493 +27700019ms view    repaint (reconcile-presentation) {comingBackFromHidden=true …}
 *   nav #1494 +27700019ms view    repaint forced — the view was hidden … {outcome=invalidated+nudged}
 *
 * Three facts in that snippet:
 *
 *   1. `wasHidden=false` after hours hidden — the suspend path never recorded the hidden transition, so
 *      the resume took the weak repaint branch.
 *   2. The resume then detached and re-attached an attached view. The re-attach is the strongest repair
 *      and the one that can leave no surface behind; it is the injury, not the cure.
 *   3. The recovery at #1493/#1494 is a forced repaint after a visibility flip — which is what "switch
 *      tabs or open/close Settings" does. That is the lever that works, so that is what a resume uses.
 */

const main = readFileSync(join(__dirname, 'index.ts'), 'utf8')

function arrowBody(marker: string, span = 2200): string {
  const start = main.indexOf(marker)
  expect(start, `no ${marker} in index.ts`).toBeGreaterThan(0)
  return main.slice(start, start + span)
}

describe('a window that comes back is repainted, not rebuilt — build 44', () => {
  it('records the hidden transition when the window is hidden or minimised', () => {
    const suspend = arrowBody('const suspendAllViews = () => {')
    // Every view is marked hidden, not only throttled: the resume path asks `viewWasHidden()`.
    expect(suspend).toContain('markViewVisibility(tabId, false)')
    expect(suspend).toContain('setBackgroundThrottling(true)')
  })

  it('does not detach an attached view just because the window resumed', () => {
    const resume = arrowBody('const resumeActiveView = () => {', 1400)
    expect(resume).not.toContain("repairTabSurface(activeViewId, 'window resumed', true)")
    expect(resume).toContain("refreshActiveViewSurfaceAfterResume('window resumed')")
  })

  it('asks the new helper for evidence before touching the surface', () => {
    const refresh = arrowBody('function refreshActiveViewSurfaceAfterResume(')
    expect(refresh).toContain('decideResumeSurfaceAction({')
    expect(refresh).toContain('attached: isViewAttached(view)')
    expect(refresh).toContain('wasHidden: viewWasHidden(tabId, view)')
    // The repaint is the strong one, and the view is kept. Build 45 moved the flip+repaint behind
    // `ensureActiveViewPresented` — the resume still keeps the surface, it just verifies first that the
    // window is presenting it at all, and waits for the page to acknowledge the hide before the show.
    expect(refresh).toContain('ensureActiveViewPresented(`window resumed (${reason})`, \'suspect\')')
    // A repair here is the conservative kind, and only for a view that is really gone.
    expect(refresh).toContain("repairTabSurface(tabId, reason, true, false, 'if-detached')")
  })

  it('never escalates to a detach in the half-second after a resume', () => {
    expect(main).toContain('const justResumed = Date.now() - lastResumeRefreshAt <= 600')
    expect(main).toContain('!justResumed')
    expect(main).toContain(
      "'repair held back — the window just resumed, the strong repaint runs first'"
    )
  })

  it('knows whether the view is actually a child of the window', () => {
    const helper = arrowBody('function isViewAttached(', 700)
    expect(helper).toContain('contentView')
    expect(helper).toContain('return null')
  })
})

describe('a subframe finishing is not the page finishing — build 44', () => {
  it('only clears the navigation intent when nothing is loading any more', () => {
    const start = main.indexOf("view.webContents.on('did-stop-loading'")
    expect(start).toBeGreaterThan(0)
    const handler = main.slice(start, start + 2400)
    expect(handler).toContain('view.webContents.isLoading()')
    expect(handler).toContain('if (stillLoading) {')
    // The intent and the loading indicator are cleared after the guard, never before it.
    const guardAt = handler.indexOf('if (stillLoading) {')
    expect(handler.indexOf('navigationIntent.forget(tabId)')).toBeGreaterThan(guardAt)
    expect(handler.indexOf("sendToMainWindow('ai-loading', tabId, false)")).toBeGreaterThan(guardAt)
    expect(handler).toContain('stillLoading')
  })
})
