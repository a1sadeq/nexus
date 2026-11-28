import { describe, it, expect } from 'vitest'
import {
  decideResumeSurfaceAction,
  RESUME_REFRESH_COOLDOWN_MS,
  type ResumeSurfaceInput
} from './surfaceResume'
import { repairViewSurface, type SurfaceViewLike } from './viewSurface'

/**
 * Build 44: what a window resume does to the AI view.
 *
 * From the build-43 diagnostics (`nexus-diagnostics-2026-11-27T00-49-24.json`), after 4.5 hours with the
 * window hidden:
 *
 *   nav #1394 +27691763ms view    repaint (reconcile-presentation) {geometryChanged=false
 *                                  comingBackFromHidden=false}
 *   nav #1395 +27691763ms repair  repair running — window resumed {visible=true}
 *   nav #1396 +27691763ms view    detach (repair) — aborts any load in flight
 *   nav #1397 +27691763ms view    attach (repair)
 *
 * …and then the user opening Settings and switching tabs, which is the workaround. The resume detached
 * and re-attached an attached view (the strongest repair there is, and the one that can leave no surface
 * behind), and it did it because a resume was treated as proof that the surface was broken. It is not
 * proof. These tests pin the evidence-driven rule that replaced it.
 */

const base: ResumeSurfaceInput = {
  attached: true,
  wasHidden: true,
  msSinceLastRefresh: 60_000
}

describe('decideResumeSurfaceAction — act on evidence, not on the event', () => {
  it('repaints an attached view instead of detaching and re-attaching it', () => {
    expect(decideResumeSurfaceAction(base)).toBe('repaint')
    // The build-43 failure: an attached view that had just been hidden for hours.
    expect(decideResumeSurfaceAction({ ...base, wasHidden: false })).toBe('repaint')
  })

  it('puts the view back only when it is definitely not in the window', () => {
    expect(decideResumeSurfaceAction({ ...base, attached: false })).toBe('repair')
  })

  it('treats "cannot say" as attached, because a wrong detach is the failure being fixed', () => {
    expect(decideResumeSurfaceAction({ ...base, attached: null })).toBe('repaint')
  })

  it('collapses show + restore + powerMonitor resume into one refresh', () => {
    expect(decideResumeSurfaceAction({ ...base, msSinceLastRefresh: 0 })).toBe('skip')
    expect(
      decideResumeSurfaceAction({ ...base, msSinceLastRefresh: RESUME_REFRESH_COOLDOWN_MS - 1 })
    ).toBe('skip')
    expect(
      decideResumeSurfaceAction({ ...base, msSinceLastRefresh: RESUME_REFRESH_COOLDOWN_MS + 1 })
    ).toBe('repaint')
  })

  it('still puts a missing view back while the cooldown runs — the cooldown is about repaints', () => {
    // A view that is not in the window does not get better by waiting.
    expect(decideResumeSurfaceAction({ ...base, attached: false, msSinceLastRefresh: 0 })).toBe(
      'repair'
    )
  })
})

/* ------------------------------------------------------------------ */
/* The repair helper refuses to detach a view that is already in place */
/* ------------------------------------------------------------------ */

const rect = { x: 0, y: 40, width: 1200, height: 760 }
const sync = (fn: () => void) => fn()

function makeView() {
  const calls: string[] = []
  const view: SurfaceViewLike = {
    webContents: {
      isDestroyed: () => false,
      invalidate: () => calls.push('invalidate'),
      executeJavaScript: () => Promise.resolve(true)
    },
    getBounds: () => rect,
    setBounds: (b) => calls.push(`setBounds:${b.width}x${b.height}`),
    setVisible: (visible) => calls.push(`setVisible:${visible}`)
  }
  return { view, calls }
}

function makeHost() {
  const calls: string[] = []
  return {
    calls,
    host: {
      contentView: {
        addChildView: () => calls.push('addChildView'),
        removeChildView: () => calls.push('removeChildView')
      }
    }
  }
}

describe('repairViewSurface — the re-attach is opt-in, not automatic', () => {
  it('keeps the existing surface when the view is attached (resume path)', () => {
    const { view, calls } = makeView()
    const { host, calls: hostCalls } = makeHost()
    const outcome = repairViewSurface(host, view, {
      bounds: rect,
      schedule: sync,
      reattach: 'if-detached',
      isAttached: () => true
    })
    expect(hostCalls).toEqual([])
    expect(outcome).toBe('partial')
    // It still did the safe work: bounds, visibility flip, invalidate.
    expect(calls).toContain(`setBounds:${rect.width}x${rect.height}`)
    expect(calls).toContain('setVisible:false')
    expect(calls).toContain('setVisible:true')
    expect(calls).toContain('invalidate')
  })

  it('re-attaches when the view really is missing from the window', () => {
    const { view } = makeView()
    const { host, calls: hostCalls } = makeHost()
    const outcome = repairViewSurface(host, view, {
      bounds: rect,
      schedule: sync,
      reattach: 'if-detached',
      isAttached: () => false
    })
    expect(outcome).toBe('repaired')
    expect(hostCalls).toEqual(['removeChildView', 'addChildView'])
  })

  it('treats an unanswerable attachment check as attached', () => {
    const { view } = makeView()
    const { host, calls: hostCalls } = makeHost()
    repairViewSurface(host, view, {
      bounds: rect,
      schedule: sync,
      reattach: 'if-detached',
      isAttached: () => {
        throw new Error('no contentView.children on this build')
      }
    })
    expect(hostCalls).toEqual([])
  })

  it('keeps "always" for the escalation, and "never" for repaint-only', () => {
    const attached = makeView()
    const attachedHost = makeHost()
    expect(
      repairViewSurface(attachedHost.host, attached.view, {
        bounds: rect,
        schedule: sync,
        reattach: 'always',
        isAttached: () => true
      })
    ).toBe('repaired')
    expect(attachedHost.calls).toEqual(['removeChildView', 'addChildView'])

    const never = makeView()
    const neverHost = makeHost()
    expect(
      repairViewSurface(neverHost.host, never.view, {
        bounds: rect,
        schedule: sync,
        reattach: 'never'
      })
    ).toBe('partial')
    expect(neverHost.calls).toEqual([])
  })

  it('defaults to the old behaviour, so existing callers are unchanged', () => {
    const { view } = makeView()
    const { host, calls: hostCalls } = makeHost()
    expect(repairViewSurface(host, view, { bounds: rect, schedule: sync })).toBe('repaired')
    expect(hostCalls).toEqual(['removeChildView', 'addChildView'])
  })
})
