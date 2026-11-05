import { describe, expect, it } from 'vitest'
import { shouldCaptureAutomaticSnapshot } from './snapshotThrottle'

describe('automatic thumbnail capture', () => {
  it('permits the first visible capture, suppresses repeats and permits later captures', () => {
    expect(shouldCaptureAutomaticSnapshot(undefined, 0, false)).toBe(true)
    expect(shouldCaptureAutomaticSnapshot(1000, 30999, false)).toBe(false)
    expect(shouldCaptureAutomaticSnapshot(1000, 31000, false)).toBe(true)
  })
  it('does not capture while hidden and handles a clock reset', () => {
    expect(shouldCaptureAutomaticSnapshot(undefined, 50000, true)).toBe(false)
    expect(shouldCaptureAutomaticSnapshot(50000, 1000, false)).toBe(true)
  })
})
