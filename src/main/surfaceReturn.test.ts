import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { classifySurfaceReturn } from './surfaceReturn'

const base = {
  shouldShow: true,
  geometryChanged: false,
  recordedHidden: false,
  resumedByActivation: false,
  boundsUsable: true
}

describe('build 37 — what a returning surface needs', () => {
  it('asks for the strong path when the view was hidden', () => {
    expect(classifySurfaceReturn({ ...base, recordedHidden: true })).toBe('strong')
  })

  it('asks for the strong path when the activation is what showed it', () => {
    // The case in the user's log: `setVisible (activate_tab, active) {visible=true}` immediately before
    // the reconcile, which then reported wasHidden=false and only invalidated a surface that no longer
    // existed — the tab switch that comes back blank until you hide and show it again.
    expect(classifySurfaceReturn({ ...base, resumedByActivation: true })).toBe('strong')
  })

  it('lets the compositor do the work when the geometry really moved', () => {
    expect(classifySurfaceReturn({ ...base, geometryChanged: true })).toBe('none')
  })

  it('invalidates when nothing moved and nothing was hidden', () => {
    expect(classifySurfaceReturn(base)).toBe('cheap')
  })

  it('never repaints a view that is supposed to be off screen', () => {
    expect(
      classifySurfaceReturn({ ...base, shouldShow: false, recordedHidden: true, resumedByActivation: true })
    ).toBe('none')
  })

  it('invalidates only, when there are no usable bounds to nudge', () => {
    expect(classifySurfaceReturn({ ...base, boundsUsable: false })).toBe('cheap')
  })
})

describe('build 37 — the wiring that makes it reachable', () => {
  const main = readFileSync(resolve(__dirname, 'index.ts'), 'utf8')

  it('records that the view was hidden before the activation shows it', () => {
    const capture = main.indexOf('const returningFromHidden = shouldBeVisible && viewWasHidden(tabId, view)')
    const show = main.indexOf('traceViewOp(tabId, \'setVisible (activate_tab, active)\'')
    expect(capture).toBeGreaterThan(-1)
    expect(show).toBeGreaterThan(-1)
    // Order matters: asked after the show, the answer is always "not hidden".
    expect(capture).toBeLessThan(show)
    expect(main).toContain('if (returningFromHidden) shownFromHidden.add(tabId)')
  })

  it('consumes that note in the reconcile that follows, once', () => {
    expect(main).toContain('const resumedByActivation = shownFromHidden.delete(activeViewId)')
    expect(main).toContain('const surfaceReturn = classifySurfaceReturn({')
  })

  it('flips visibility on the strong path and after a re-attach', () => {
    const strong = main.indexOf("reason: 'coming back from hidden (overlay / tab switch)'")
    expect(strong).toBeGreaterThan(-1)
    expect(main.slice(strong, strong + 400)).toContain('flipVisibility: true')

    const reattach = main.indexOf("reason: 'after re-attach'")
    expect(reattach).toBeGreaterThan(-1)
    expect(main.slice(reattach, reattach + 400)).toContain('flipVisibility: true')
  })
})
