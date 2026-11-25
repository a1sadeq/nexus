import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AiToastManager, type ToastData, type ToastViewTarget } from './aiToastManager'

/**
 * A notification is not a modal, and opening a panel is not a dismissal.
 *
 * Build 32 and earlier dismissed the in-app toast the moment any overlay opened
 * (`dismissInAppToast()` from the `set_overlays_open` handler) and the moment any tab was switched
 * (the renderer sent `dismiss_in_app_toast` from `switchToTab`). So a finished tab that announced
 * itself while the user was reaching for Ctrl+L was announced to nobody. The toast is now *suspended*
 * while a native view cannot be drawn over a panel, and resumed with the time it had left.
 */

function harness() {
  const calls: string[] = []
  let visible = false
  const view: ToastViewTarget = {
    isDestroyed: () => false,
    loadHtml: () => calls.push('loadHtml'),
    setVisible: (next) => {
      visible = next
      calls.push(`setVisible:${next}`)
    },
    setBounds: (bounds) => calls.push(`setBounds:${bounds.width}x${bounds.height}`),
    startExitAnimation: () => calls.push('exit')
  }
  return {
    view,
    calls,
    get visible() {
      return visible
    }
  }
}

const data: ToastData = {
  id: 'n1',
  tabId: 'tab-1',
  tabTitle: 'a chat',
  model: 'glm',
  status: 'done'
}

describe('AiToastManager suspension', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('hides the toast without ending it, and keeps the data', () => {
    const h = harness()
    const manager = new AiToastManager(() => h.view, undefined, undefined, 6800, 200)
    manager.show(data)
    expect(h.visible).toBe(true)

    manager.suspend()
    expect(h.visible).toBe(false)
    expect(manager.isSuspended()).toBe(true)
    // The notification itself is still the current one — that is the whole point.
    expect(manager.getCurrentData()?.tabId).toBe('tab-1')
  })

  it('does not auto-dismiss while suspended', () => {
    const h = harness()
    const manager = new AiToastManager(() => h.view, undefined, undefined, 6800, 200)
    manager.show(data)
    vi.advanceTimersByTime(1000)
    manager.suspend()
    // Well past the original 6.8 s: a suspended toast is frozen, not quietly expiring behind a panel.
    vi.advanceTimersByTime(30_000)
    expect(manager.getCurrentData()?.tabId).toBe('tab-1')
    expect(h.visible).toBe(false)
  })

  it('resumes with the time it had left rather than a fresh countdown', () => {
    const h = harness()
    const manager = new AiToastManager(() => h.view, undefined, undefined, 6800, 200)
    manager.show(data)
    vi.advanceTimersByTime(6000) // 800 ms left
    manager.suspend()
    vi.advanceTimersByTime(10_000) // hidden for ten seconds behind the panel
    manager.resume()
    expect(h.visible).toBe(true)
    expect(manager.isSuspended()).toBe(false)
    // 800 ms left (floored at 1.2 s by the grace window), not another 6.8 s: 1.2 s to the dismiss,
    // then the 200 ms exit animation.
    vi.advanceTimersByTime(1500)
    expect(manager.getCurrentData()).toBeNull()
    expect(h.visible).toBe(false)
  })

  it('forgets the suspension when a newer notification replaces the old one', () => {
    const h = harness()
    const manager = new AiToastManager(() => h.view, undefined, undefined, 6800, 200)
    manager.show(data)
    manager.suspend()
    manager.show({ ...data, id: 'n2', tabId: 'tab-2' })
    expect(manager.isSuspended()).toBe(false)
    expect(h.visible).toBe(true)
    expect(manager.getCurrentData()?.tabId).toBe('tab-2')
  })

  it('a real dismissal still ends it', () => {
    const h = harness()
    const manager = new AiToastManager(() => h.view, undefined, undefined, 6800, 200)
    manager.show(data)
    manager.suspend()
    manager.resume()
    manager.dismiss(true)
    expect(manager.getCurrentData()).toBeNull()
    expect(manager.isSuspended()).toBe(false)
    expect(h.visible).toBe(false)
  })

  it('ends a suspended toast without playing an animation nobody can see — audit fix', () => {
    // suspend() hid the view. Running the exit animation then would put it back on the window for
    // 200 ms just to hide it again — a flicker over whatever panel the user is looking at.
    const h = harness()
    const manager = new AiToastManager(() => h.view, undefined, undefined, 6800, 200)
    manager.show(data)
    manager.suspend()
    manager.dismiss(false)
    expect(h.calls).not.toContain('exit')
    expect(manager.getCurrentData()).toBeNull()
    // …and it is not brought back on screen by a timer a moment later.
    vi.advanceTimersByTime(1000)
    expect(h.visible).toBe(false)
  })

  it('a resume with no usable view cleans up instead of throwing', () => {
    const manager = new AiToastManager(() => null, undefined, undefined, 6800, 200)
    // No view at all: show() is a no-op, so there is nothing to suspend either.
    manager.show(data)
    manager.suspend()
    expect(() => manager.resume()).not.toThrow()
    expect(manager.isSuspended()).toBe(false)
  })
})
