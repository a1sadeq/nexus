import { describe, expect, it, vi } from 'vitest'
import { callerFrame, shouldDefend, tapNavigationSurface, type NavigationTapEvent } from './navigationTap'

/**
 * The tap exists to answer one question the build-27 trace could not: *which code moved this tab?*
 * These tests pin the two properties that make it trustworthy — it records without changing behaviour,
 * and it never stacks a second layer of wrappers on the same surface.
 */

const sameSite = (a: string, b: string): boolean => {
  try {
    return new URL(a).host === new URL(b).host
  } catch {
    return false
  }
}

function makeSurface() {
  const calls: string[] = []
  const surface = {
    loadURL: vi.fn(async (url: string) => {
      calls.push(`loadURL:${url}`)
      return undefined
    }),
    reload: vi.fn(() => {
      calls.push('reload')
    }),
    stop: vi.fn(() => {
      calls.push('stop')
    }),
    navigationHistory: {
      goBack: vi.fn(() => {
        calls.push('goBack')
      }),
      goForward: vi.fn(() => {
        calls.push('goForward')
      }),
      goToIndex: vi.fn((index: number) => {
        calls.push(`goToIndex:${index}`)
      })
    }
  }
  return { surface, calls }
}

describe('tapNavigationSurface', () => {
  it('records every programmatic navigation and still performs it', async () => {
    const { surface, calls } = makeSurface()
    const seen: NavigationTapEvent[] = []
    tapNavigationSurface(surface, (event) => seen.push(event))

    await surface.loadURL('https://gemini.google.com/app')
    surface.reload?.()
    surface.stop?.()
    surface.navigationHistory.goBack()
    surface.navigationHistory.goToIndex?.(2)

    // Behaviour unchanged: the real methods ran, in order.
    expect(calls).toEqual([
      'loadURL:https://gemini.google.com/app',
      'reload',
      'stop',
      'goBack',
      'goToIndex:2'
    ])
    // …and every one of them named itself.
    expect(seen.map((event) => event.action)).toEqual([
      'loadURL',
      'reload',
      'stop',
      'history.goBack',
      'history.goToIndex'
    ])
    expect(seen[0].url).toBe('https://gemini.google.com/app')
  })

  it('reports the caller, not itself', async () => {
    const { surface } = makeSurface()
    const seen: NavigationTapEvent[] = []
    tapNavigationSurface(surface, (event) => seen.push(event))
    const goBackBeforeLoad = (): void => {
      surface.navigationHistory.goBack()
    }
    goBackBeforeLoad()
    expect(seen[0].caller).toContain('navigationTap.test.ts')
  })

  it('keeps a rejection rejecting and adds one line about it', async () => {
    const surface = {
      loadURL: vi.fn(async (_url: string) => {
        throw Object.assign(new Error('ERR_ABORTED (-3) loading url'), { code: 'ERR_ABORTED' })
      })
    }
    const seen: NavigationTapEvent[] = []
    tapNavigationSurface(surface, (event) => seen.push(event))
    await expect(surface.loadURL('https://kimi.ai/chat')).rejects.toThrow(/ERR_ABORTED/)
    expect(seen.map((event) => event.action)).toEqual([
      'loadURL',
      'loadURL rejected — ERR_ABORTED (-3) loading url'
    ])
  })

  it('does not wrap a surface twice, and the uninstaller restores the originals', async () => {
    const { surface } = makeSurface()
    const seen: NavigationTapEvent[] = []
    const original = surface.loadURL
    const uninstall = tapNavigationSurface(surface, (event) => seen.push(event))
    const second = tapNavigationSurface(surface, (event) => seen.push(event))
    expect(second).toBe(uninstall)

    await surface.loadURL('https://chatgpt.com/')
    expect(seen).toHaveLength(1)

    uninstall()
    await surface.loadURL('https://chatgpt.com/')
    expect(seen).toHaveLength(1)
    expect(surface.loadURL).toBe(original)
  })

  it('survives a surface whose methods are missing', () => {
    const bare = { loadURL: vi.fn(async () => undefined) }
    expect(() => tapNavigationSurface(bare, () => {})).not.toThrow()
    expect(bare.loadURL).toBeInstanceOf(Function)
  })
})

describe('callerFrame', () => {
  it('skips this module and the internal frames', () => {
    const stack = [
      'Error',
      '    at describeError (/app/out/main/navigationTap.js:40:12)',
      '    at loadURL (/app/out/main/navigationTap.js:120:9)',
      '    at run (/app/out/main/index.js:7312:24)'
    ].join('\n')
    expect(callerFrame(stack)).toBe('run@index.js:7312')
  })

  it('returns an empty string when there is nothing to read', () => {
    expect(callerFrame(undefined)).toBe('')
    expect(callerFrame('Error')).toBe('')
  })
})

describe('shouldDefend', () => {
  const base = {
    isMainFrame: true,
    incomingUrl: 'https://www.kimi.ai/chat/c/abc',
    pendingUrl: 'https://gemini.google.com/app',
    sameUrl: sameSite,
    defencesUsed: 0,
    budget: 5,
    lastDefenceAt: 0,
    now: 1_000
  }

  it('fights for the user when the old page comes back', () => {
    expect(shouldDefend(base)).toBe(true)
  })

  it('never fights its own load', () => {
    expect(shouldDefend({ ...base, incomingUrl: 'https://gemini.google.com/app' })).toBe(false)
    expect(shouldDefend({ ...base, incomingUrl: 'https://gemini.google.com/app/new-chat' })).toBe(false)
  })

  it('ignores sub-frames and requests that are already answered', () => {
    expect(shouldDefend({ ...base, isMainFrame: false })).toBe(false)
    expect(shouldDefend({ ...base, pendingUrl: null })).toBe(false)
    expect(shouldDefend({ ...base, incomingUrl: '' })).toBe(false)
  })

  it('respects the budget and the gap between attempts', () => {
    expect(shouldDefend({ ...base, defencesUsed: 5 })).toBe(false)
    expect(shouldDefend({ ...base, lastDefenceAt: 950, now: 1_000 })).toBe(false)
    expect(shouldDefend({ ...base, lastDefenceAt: 850, now: 1_000 })).toBe(true)
  })
})
