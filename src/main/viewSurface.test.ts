import { describe, it, expect, vi } from 'vitest'
import { repairViewSurface, SurfaceRepairPolicy, type SurfaceViewLike } from './viewSurface'

const rect = { x: 0, y: 40, width: 1200, height: 760 }

function makeView(overrides: Partial<SurfaceViewLike> & { destroyed?: boolean } = {}) {
  const calls: string[] = []
  const view: SurfaceViewLike & { calls: string[] } = {
    calls,
    webContents: {
      isDestroyed: () => overrides.destroyed === true,
      invalidate: () => calls.push('invalidate'),
      executeJavaScript: () => {
        calls.push('executeJavaScript')
        return Promise.resolve(true)
      }
    },
    getBounds: () => rect,
    setBounds: (b) => calls.push(`setBounds:${b.width}x${b.height}`),
    setVisible: (visible) => calls.push(`setVisible:${visible}`)
  }
  return { view, calls }
}

function makeHost() {
  const calls: string[] = []
  const host = {
    contentView: {
      addChildView: () => calls.push('addChildView'),
      removeChildView: () => calls.push('removeChildView')
    }
  }
  return { host, calls }
}

const sync = (fn: () => void) => fn()

describe('repairViewSurface', () => {
  it('re-applies bounds, flips visibility, invalidates and re-attaches', () => {
    const { view, calls } = makeView()
    const { host, calls: hostCalls } = makeHost()
    const outcome = repairViewSurface(host, view, { bounds: rect, schedule: sync })
    expect(outcome).toBe('repaired')
    expect(calls).toContain(`setBounds:${rect.width}x${rect.height}`)
    expect(calls).toContain('setVisible:false')
    expect(calls).toContain('setVisible:true')
    expect(calls).toContain('invalidate')
    expect(hostCalls).toEqual(['removeChildView', 'addChildView'])
  })

  it('restores the authoritative bounds after the re-attach', () => {
    const { view, calls } = makeView()
    const { host } = makeHost()
    repairViewSurface(host, view, { bounds: rect, schedule: sync })
    // setBounds once before the flip and once after the re-attach
    expect(calls.filter((c) => c === `setBounds:${rect.width}x${rect.height}`)).toHaveLength(2)
  })

  it('skips a destroyed view', () => {
    const { view } = makeView({ destroyed: true })
    const { host, calls } = makeHost()
    expect(repairViewSurface(host, view, { bounds: rect, schedule: sync })).toBe('skipped')
    expect(calls).toEqual([])
  })

  it('is partial when there is no host to re-attach to', () => {
    const { view } = makeView()
    expect(repairViewSurface(null, view, { bounds: rect, schedule: sync })).toBe('partial')
  })

  it('never sends a zero-sized rectangle', () => {
    const { view, calls } = makeView()
    const { host } = makeHost()
    repairViewSurface(host, view, { bounds: { x: 0, y: 0, width: 0, height: 0 }, schedule: sync })
    expect(calls.some((c) => c.includes('0x0'))).toBe(false)
  })

  it('does not show a view that is supposed to stay hidden', () => {
    const { view, calls } = makeView()
    const { host } = makeHost()
    repairViewSurface(host, view, { bounds: rect, visible: false, schedule: sync })
    expect(calls).not.toContain('setVisible:true')
  })

  it('survives a view whose calls throw', () => {
    const { host } = makeHost()
    const view: SurfaceViewLike = {
      webContents: { isDestroyed: () => false, invalidate: () => { throw new Error('boom') } },
      getBounds: () => rect,
      setBounds: () => { throw new Error('no geometry') },
      setVisible: () => { throw new Error('no visibility') }
    }
    expect(() => repairViewSurface(host, view, { bounds: rect, schedule: sync })).not.toThrow()
  })

  it('nudges the page for a frame unless told not to', () => {
    const { view, calls } = makeView()
    repairViewSurface(null, view, { bounds: rect, schedule: sync })
    expect(calls).toContain('executeJavaScript')
    const second = makeView()
    repairViewSurface(null, second.view, { bounds: rect, schedule: sync, pageResizeHint: false })
    expect(second.calls).not.toContain('executeJavaScript')
  })

  it('refuses to rebuild a surface while a navigation is in flight', () => {
    // Detaching the view mid-load aborts the load, and the tab then shows the page it had before —
    // "the title changed but the page did not". The caller defers instead.
    const { view } = makeView()
    const { host, calls } = makeHost()
    const outcome = repairViewSurface(host, view, {
      bounds: rect,
      schedule: sync,
      navigationInFlight: true
    })
    expect(outcome).toBe('skipped')
    expect(calls).toEqual([])
  })

  it('logs the reason, so a recurrence is identifiable', () => {
    const log = vi.fn()
    const { view } = makeView()
    const { host } = makeHost()
    repairViewSurface(host, view, { bounds: rect, schedule: sync, reason: 'blank-view', log })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('blank-view'))
    expect(log.mock.calls[0][0]).toContain('re-attached')
  })
})

describe('SurfaceRepairPolicy', () => {
  it('does nothing after a single repaint request', () => {
    const policy = new SurfaceRepairPolicy()
    policy.noteRepaint('tab-1', 1000)
    expect(policy.shouldRepair('tab-1', 1000)).toBe(false)
  })

  it('escalates on repeated repaint requests inside the window', () => {
    const policy = new SurfaceRepairPolicy()
    policy.noteRepaint('tab-1', 1000)
    policy.noteRepaint('tab-1', 1500)
    expect(policy.shouldRepair('tab-1', 1500)).toBe(true)
  })

  it('ignores repaint requests older than the window', () => {
    const policy = new SurfaceRepairPolicy()
    policy.noteRepaint('tab-1', 1000)
    policy.noteRepaint('tab-1', 2000)
    expect(policy.shouldRepair('tab-1', 9000)).toBe(false)
  })

  it('honours the cooldown after a repair', () => {
    const policy = new SurfaceRepairPolicy()
    policy.noteRepaint('tab-1', 1000)
    policy.noteRepaint('tab-1', 1100)
    expect(policy.shouldRepair('tab-1', 1100)).toBe(true)
    policy.noteRepair('tab-1', 1100)
    policy.noteRepaint('tab-1', 1200)
    policy.noteRepaint('tab-1', 1300)
    expect(policy.shouldRepair('tab-1', 1300)).toBe(false)
    expect(policy.shouldRepair('tab-1', 1100 + 3000)).toBe(true)
  })

  it('keeps tabs independent', () => {
    const policy = new SurfaceRepairPolicy()
    policy.noteRepaint('tab-1', 1000)
    policy.noteRepaint('tab-1', 1100)
    expect(policy.shouldRepair('tab-2', 1100)).toBe(false)
    expect(policy.shouldRepair('tab-1', 1100)).toBe(true)
  })

  it('forget() clears counts and the cooldown', () => {
    const policy = new SurfaceRepairPolicy()
    policy.noteRepaint('tab-1', 1000)
    policy.noteRepaint('tab-1', 1100)
    policy.noteRepair('tab-1', 1100)
    policy.forget('tab-1')
    policy.noteRepaint('tab-1', 1200)
    expect(policy.pendingCount('tab-1', 1200)).toBe(1)
    expect(policy.shouldRepair('tab-1', 1200)).toBe(false)
  })

  it('counts a same-tick double reconcile as one request, not two — build 33', () => {
    // Closing an overlay reconciles twice, 2 ms apart (build-32 diagnostics: +1439989 and +1439991).
    // Counting that pair as "two failed repaints" escalated straight into a detach/re-attach, and a
    // detached surface is the dark page. One transition is one request.
    const policy = new SurfaceRepairPolicy()
    policy.noteRepaint('tab-1', 1000)
    policy.noteRepaint('tab-1', 1002)
    expect(policy.pendingCount('tab-1', 1002)).toBe(1)
    expect(policy.shouldRepair('tab-1', 1002)).toBe(false)
    // A genuinely repeated request a moment later still escalates.
    policy.noteRepaint('tab-1', 1400)
    expect(policy.shouldRepair('tab-1', 1400)).toBe(true)
  })

  it('counts only the requests inside the window', () => {
    const policy = new SurfaceRepairPolicy()
    for (const at of [3000, 3500, 6100]) policy.noteRepaint('tab-1', at)
    // At 6100 the 3000 request is outside the 3 s window; the other two are inside it.
    expect(policy.pendingCount('tab-1', 6100)).toBe(2)
    expect(policy.pendingCount('tab-1', 20000)).toBe(0)
  })
})
