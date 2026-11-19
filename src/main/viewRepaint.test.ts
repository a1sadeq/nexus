import { describe, it, expect, vi } from 'vitest'
import { forceViewRepaint, type RepaintViewLike } from './viewRepaint'

interface Harness {
  view: RepaintViewLike
  bounds: { x: number; y: number; width: number; height: number }
  calls: unknown[]
  scheduled: Array<{ fn: () => void; ms: number }>
  invalidations: number
}

function harness(overrides: Partial<{ width: number; height: number; noInvalidate: boolean; destroyed: boolean }> = {}): Harness {
  const bounds = { x: 280, y: 45, width: overrides.width ?? 1200, height: overrides.height ?? 800 }
  const calls: unknown[] = []
  const scheduled: Array<{ fn: () => void; ms: number }> = []
  const state = { invalidations: 0 }
  const view: RepaintViewLike = {
    webContents: {
      ...(overrides.noInvalidate
        ? {}
        : {
            invalidate: () => {
              state.invalidations++
            }
          }),
      isDestroyed: () => overrides.destroyed ?? false
    },
    setBounds: (next) => {
      calls.push({ ...next })
      Object.assign(bounds, next)
    },
    getBounds: () => ({ ...bounds })
  }
  return {
    view,
    bounds,
    calls,
    scheduled,
    get invalidations() {
      return state.invalidations
    }
  } as Harness
}

const runScheduled = (h: Harness): void => {
  for (const entry of h.scheduled.splice(0)) entry.fn()
}

const schedule = (h: Harness) => (fn: () => void, ms: number) => {
  h.scheduled.push({ fn, ms })
}

describe('forced repaint', () => {
  it('invalidates and nudges, then restores the exact original geometry', () => {
    const h = harness()
    const outcome = forceViewRepaint(h.view, { schedule: schedule(h), now: 1000 })
    expect(outcome).toBe('invalidated+nudged')
    expect(h.calls).toHaveLength(1)
    // Nudged by exactly one pixel — enough to force a redraw, invisible to the user.
    expect(h.calls[0]).toEqual({ x: 280, y: 45, width: 1199, height: 800 })
    runScheduled(h)
    expect(h.bounds).toEqual({ x: 280, y: 45, width: 1200, height: 800 })
  })

  it('restores the caller-supplied authoritative bounds, not the mutated ones', () => {
    const h = harness()
    const authoritative = { x: 10, y: 20, width: 900, height: 700 }
    forceViewRepaint(h.view, { bounds: authoritative, schedule: schedule(h), now: 1000 })
    runScheduled(h)
    expect(h.bounds).toEqual(authoritative)
  })

  it('falls back to a nudge when invalidate() is unavailable', () => {
    const h = harness({ noInvalidate: true })
    const outcome = forceViewRepaint(h.view, { schedule: schedule(h), now: 1000 })
    expect(outcome).toBe('nudged')
    expect(h.calls).toHaveLength(1)
  })

  it('still invalidates when the view cannot be nudged (zero-size / hidden)', () => {
    const h = harness({ width: 0, height: 0 })
    const outcome = forceViewRepaint(h.view, { schedule: schedule(h), now: 1000 })
    expect(outcome).toBe('invalidated')
    expect(h.calls).toHaveLength(0)
    // Never send a negative width for a zero-size view.
    expect(h.calls.some((c) => (c as { width: number }).width < 0)).toBe(false)
  })

  it('never touches a destroyed webContents', () => {
    const h = harness({ destroyed: true })
    expect(forceViewRepaint(h.view, { schedule: schedule(h) })).toBe('skipped')
    expect(h.calls).toHaveLength(0)
    expect(h.invalidations).toBe(0)
  })

  it('collapses a burst of triggers into one nudge', () => {
    const h = harness()
    const scheduleFn = schedule(h)
    const first = forceViewRepaint(h.view, { schedule: scheduleFn, now: 1000 })
    const second = forceViewRepaint(h.view, { schedule: scheduleFn, now: 1100 })
    const third = forceViewRepaint(h.view, { schedule: scheduleFn, now: 1200 })
    expect(first).toBe('invalidated+nudged')
    // Later calls in the window still invalidate (cheap) but do not re-nudge.
    expect(second).toBe('invalidated')
    expect(third).toBe('invalidated')
    expect(h.calls).toHaveLength(1)
    runScheduled(h)
    expect(h.bounds.width).toBe(1200)
  })

  it('nudges again once the cooldown has passed', () => {
    const h = harness()
    const scheduleFn = schedule(h)
    forceViewRepaint(h.view, { schedule: scheduleFn, now: 1000 })
    runScheduled(h)
    const later = forceViewRepaint(h.view, { schedule: scheduleFn, now: 1000 + 5000 })
    expect(later).toBe('invalidated+nudged')
    // one nudge + one restore per repaint; the second repaint must have nudged again
    const nudges = h.calls.filter((c) => (c as { width: number }).width === 1199)
    expect(nudges).toHaveLength(2)
  })

  it('survives setBounds throwing and still reports what it managed', () => {
    const bounds = { x: 0, y: 0, width: 800, height: 600 }
    const view: RepaintViewLike = {
      webContents: { invalidate: () => undefined, isDestroyed: () => false },
      setBounds: () => {
        throw new Error('view disposed')
      },
      getBounds: () => bounds
    }
    expect(forceViewRepaint(view, { schedule: () => undefined, now: 1 })).toBe('invalidated')
  })

  it('restores synchronously if the scheduler is unusable, leaving correct geometry', () => {
    const h = harness()
    forceViewRepaint(h.view, {
      now: 1000,
      schedule: () => {
        throw new Error('no scheduler')
      }
    })
    expect(h.bounds.width).toBe(1200)
  })

  it('is a no-op for a null view', () => {
    expect(forceViewRepaint(null)).toBe('skipped')
  })

  it('logs a diagnosable reason', () => {
    const h = harness()
    const log = vi.fn()
    forceViewRepaint(h.view, { schedule: schedule(h), now: 1, reason: 'window-show', log })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('window-show'))
  })
})
