import { describe, it, expect } from 'vitest'

import {
  OVERLAY_CLOSE_GRACE_MS,
  armWatchdog,
  createWatchdogState,
  disarmWatchdog,
  isWatchdogArmed,
  isWatchdogOverdue
} from './overlayWatchdog'

describe('overlay watchdog', () => {
  it('is not overdue before it is armed', () => {
    expect(isWatchdogOverdue(createWatchdogState(), 10_000)).toBe(false)
    expect(isWatchdogArmed(createWatchdogState())).toBe(false)
  })

  it('gives the renderer its grace period before forcing anything', () => {
    const armed = armWatchdog(createWatchdogState(), 1_000)
    expect(isWatchdogOverdue(armed, 1_000)).toBe(false)
    expect(isWatchdogOverdue(armed, 1_000 + OVERLAY_CLOSE_GRACE_MS - 1)).toBe(false)
    expect(isWatchdogOverdue(armed, 1_000 + OVERLAY_CLOSE_GRACE_MS)).toBe(true)
  })

  it('does not let a second Escape push the deadline back', () => {
    let state = armWatchdog(createWatchdogState(), 1_000)
    state = armWatchdog(state, 1_500)
    expect(isWatchdogOverdue(state, 1_000 + OVERLAY_CLOSE_GRACE_MS)).toBe(true)
  })

  it('forgets the deadline once the renderer reports the overlay closed', () => {
    const armed = armWatchdog(createWatchdogState(), 1_000)
    expect(isWatchdogOverdue(disarmWatchdog(), 60_000)).toBe(false)
    expect(isWatchdogArmed(armed)).toBe(true)
  })

  it('can be armed again after it fired, so a second stuck overlay is caught too', () => {
    let state = armWatchdog(createWatchdogState(), 0)
    expect(isWatchdogOverdue(state, OVERLAY_CLOSE_GRACE_MS)).toBe(true)
    state = disarmWatchdog()
    state = armWatchdog(state, 5_000)
    expect(isWatchdogOverdue(state, 5_000)).toBe(false)
    expect(isWatchdogOverdue(state, 5_000 + OVERLAY_CLOSE_GRACE_MS)).toBe(true)
  })
})
