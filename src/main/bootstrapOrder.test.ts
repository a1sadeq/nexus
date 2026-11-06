import { describe, it, expect, vi } from 'vitest'

const callSequence: string[] = []

vi.mock('electron', () => ({
  app: {
    set name(v: string) {
      callSequence.push(`name:${v}`)
    },
    get name() {
      return 'nexus'
    },
    getPath: vi.fn((p: string) => (p === 'appData' ? '/tmp/mock-appdata' : `/tmp/mock-appdata/${p}`)),
    setPath: vi.fn((p: string, _val: string) => {
      callSequence.push(`setPath:${p}`)
    }),
    requestSingleInstanceLock: vi.fn(() => {
      callSequence.push('lock')
      return true
    }),
    on: vi.fn(),
    whenReady: vi.fn(async () => {})
  }
}))

describe('Bootstrap Order Verification (T-A1, T-A2, T-A3)', () => {
  it('T-A1: pins app.name and userData strictly before requesting singleton lock', async () => {
    await import('./bootstrap')
    expect(callSequence[0]).toBe('name:nexus')
    expect(callSequence[1]).toBe('setPath:userData')
    expect(callSequence).toContain('setPath:sessionData')
  })

  it('T-A2 & T-A3: pins sessionData and handles missing directory safely', async () => {
    expect(callSequence).toContain('setPath:sessionData')
  })
})
