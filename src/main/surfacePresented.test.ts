import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Build 45 — stop assuming the view is on screen, and stop calling a flip a flip when the page never
 * saw it.
 *
 * The build-44 diagnostics contain dozens of `setVisible {visible=true}`, eighteen
 * `repaint forced — the view was hidden` and **no repair at all**, and the user was still looking at an
 * empty window. Two conclusions, both wired here:
 *
 *   1. The app no longer decides that the view is presented because it just called `setVisible(true)`.
 *      It asks Electron the three questions Electron can answer — is the view in the window, does the
 *      view say it is visible, is it where the layout says — and fixes what is wrong.
 *   2. The hide/show is no longer one synchronous pair of calls. It is held hidden until the page itself
 *      reports `document.visibilityState === 'hidden'`, which is what opening Settings and closing it
 *      does for the user by hand.
 */
const main = readFileSync(resolve(__dirname, 'index.ts'), 'utf8')

function body(name: string, length = 3000): string {
  const at = main.indexOf(name)
  expect(at, `${name} must exist`).toBeGreaterThan(-1)
  return main.slice(at, at + length)
}

describe('build 45 — the presentation check', () => {
  it('asks the window, the view and the layout, not its own bookkeeping', () => {
    const check = body('function verifyViewPresentation(')
    expect(check).toContain('isViewAttached(view)')
    expect(check).toContain('view.getVisible')
    expect(check).toContain('view.getBounds()')
  })

  it('puts the view back in the window when the window does not list it', () => {
    const check = body('function verifyViewPresentation(')
    expect(check).toContain('mainWindow.contentView.addChildView(view)')
    // …and says so in the trace, so the next bundle answers this instead of guessing.
    expect(check).toContain("traceViewOp(tabId, 'presentation check'")
  })

  it('shows the view again when the view itself says it is hidden', () => {
    const check = body('function verifyViewPresentation(')
    const visible = check.indexOf('view.getVisible')
    const show = check.indexOf('view.setVisible(true)')
    expect(visible).toBeGreaterThan(-1)
    expect(show).toBeGreaterThan(visible)
  })

  it('restores the layout bounds it recorded for the tab', () => {
    const check = body('function verifyViewPresentation(')
    expect(check).toContain('lastRealBounds.get(tabId)')
    expect(check).toContain('view.setBounds(wanted)')
  })
})

describe('build 45 — one way to present the active view', () => {
  it('verifies first, and only then decides whether to flip', () => {
    const ensure = body('function ensureActiveViewPresented(', 3000)
    const verify = ensure.indexOf('verifyViewPresentation(tabId, view, reason)')
    const decision = ensure.indexOf('const shouldFlip =')
    const flip = ensure.indexOf('flipVisibility: true')
    expect(verify).toBeGreaterThan(-1)
    expect(decision).toBeGreaterThan(verify)
    expect(flip).toBeGreaterThan(decision)
  })

  it('does not flip a view that the check found perfectly fine — build 46', () => {
    // The build-45 trace: every tab switch logged `presented — verified, then flipped`, and the user felt
    // a pause on tabs that were not even loading. A view that is attached, visible and correctly sized
    // gets a repaint and nothing else.
    const ensure = body('function ensureActiveViewPresented(', 3000)
    expect(ensure).toContain("const shouldFlip = mode === 'always' || (mode === 'suspect' && fixedSomething)")
    expect(ensure).toContain('const fixedSomething = report.fixed.length > 0')
    // …and the no-flip path returns before the flip ever happens.
    const cheapReturn = ensure.indexOf('presented — verified, repainted (no flip needed)')
    const flipCall = ensure.indexOf('flipVisibility: true')
    expect(cheapReturn).toBeGreaterThan(-1)
    expect(flipCall).toBeGreaterThan(cheapReturn)
  })

  it('keeps the hidden-view repair on every path, which is what actually caught the bug', () => {
    const check = body('function verifyViewPresentation(')
    expect(check).toContain('view.getVisible')
    expect(check).toContain('view.setVisible(true)')
    // The build-45 trace's one real catch:
    //   presentation check {… visible=true fixed=shown again (it was hidden) …}
    expect(check).toContain('shown again (it was hidden)')
  })

  it('does not hold a loading tab off screen waiting for the page', () => {
    const ensure = body('function ensureActiveViewPresented(', 3000)
    expect(ensure).toContain('flipGate: loading ? undefined : pageVisibilityGate(view)')
    expect(ensure).toContain('maxFlipHiddenMs: 400')
  })

  it('only the escalation flips unconditionally', () => {
    expect(main).toContain("ensureActiveViewPresented('reconciled twice without a frame', 'always')")
    expect(main).toContain('ensureActiveViewPresented(`window resumed (${reason})`, awayFor >= 1500')
    // The tab-switch / overlay-close path decides from the overlay timestamps (build 47): an overlay
    // that was really open flips, a tab switch does not.
    expect(main).toContain("'coming back from hidden (overlay / tab switch)'")
    expect(main).toContain("overlayWasLongEnough ? 'always' : 'suspect'")
  })

  it('never forces a repaint over an overlay, or on a tab that is not active', () => {
    const ensure = body('function ensureActiveViewPresented(', 800)
    expect(ensure).toContain('if (!activeViewVisible || overlaysOpen) return')
  })

  it('no longer detaches the surface to fix a blank one', () => {
    // The build-44 trace is the evidence: no detach ran, and the blank happened anyway. Escalating to a
    // detach bought nothing and stays behind the explicit "Repair AI View" command.
    expect(main).not.toContain("repairTabSurface(activeViewId, 'reconciled twice without a frame', true)")
  })
})

describe('build 45 — what the page thinks', () => {
  it('reads document.visibilityState from the page', () => {
    expect(main).toContain('function readPageVisibility(')
    expect(body('function readPageVisibility(', 900)).toContain('document.visibilityState')
  })

  it('only shows a flipped view again once the page has reported itself hidden', () => {
    const gate = body('function pageVisibilityGate(', 1200)
    expect(gate).toContain('waitForPageHidden')
    expect(gate).toContain('setTimeout')
    expect(gate).toContain("state === 'hidden'")
  })

  it('probes after the flip, and flips at most once more', () => {
    const probe = body('function probeSurfaceState(', 1800)
    const hidden = probe.indexOf("pageState === 'hidden'")
    const flip = probe.indexOf('flipVisibility: true')
    expect(hidden).toBeGreaterThan(-1)
    expect(flip).toBeGreaterThan(hidden)
    // Only for the view that is supposed to be on screen.
    expect(probe.slice(hidden, flip)).toContain('tabId === activeViewId')
    // …and the follow-up probe is what stops it becoming a loop.
    expect(probe).toContain('allowFlip')
  })

  it('says in the trace when there is nothing left on the app side to fix', () => {
    const probe = body('function probeSurfaceState(', 2400)
    expect(probe).toContain('page reports visible; the view is presented')
    // Only on the second probe: the first one may still flip.
    expect(probe).toContain("!allowFlip && pageState === 'visible'")
  })
})
