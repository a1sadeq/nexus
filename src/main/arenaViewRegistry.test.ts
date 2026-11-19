import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { ArenaViewRegistry } from './arenaViewRegistry'

const controls = {
  composer: { count: 1, visible: 1, enabled: 1 },
  send: { count: 1, visible: 1, enabled: 0 },
  stop: { count: 0, visible: 0, enabled: 0 }
}
class FakeContents extends EventEmitter {
  destroyed = false
  url = 'https://arena.ai/chat/test'
  executeJavaScriptInIsolatedWorld = vi.fn().mockResolvedValue(controls)
  constructor(public id: number) {
    super()
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  getURL(): string {
    return this.url
  }
  asWebContents(): WebContents {
    return this as unknown as WebContents
  }
}

describe('trusted per-tab view registry candidate', () => {
  it('routes each explicit tab to its registered view without referring to the active tab', async () => {
    const registry = new ArenaViewRegistry(),
      a = new FakeContents(1),
      b = new FakeContents(2)
    registry.register('a', a.asWebContents())
    registry.register('b', b.asWebContents())
    const observer = registry.createObserver('a')!
    expect(await observer.observe()).toEqual({
      status: 'observed',
      state: 'send-disabled',
      providerCondition: 'unknown'
    })
    expect(a.executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce()
    expect(b.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
  })
  it('invalidates a captured observer at main-frame navigation start before commit', async () => {
    const registry = new ArenaViewRegistry(),
      a = new FakeContents(1)
    registry.register('a', a.asWebContents())
    const observer = registry.createObserver('a')!
    a.emit('did-start-navigation', { isMainFrame: true }, 'https://arena.ai/new', false, true)
    expect(await observer.observe()).toEqual({
      status: 'unknown',
      reason: 'view-changed',
      providerCondition: 'unknown'
    })
    expect(a.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
  })
  it('invalidates on same-document navigation even when the URL returns to its original value', async () => {
    const registry = new ArenaViewRegistry(),
      a = new FakeContents(1)
    registry.register('a', a.asWebContents())
    const observer = registry.createObserver('a')!
    a.emit('did-navigate-in-page', {}, 'https://arena.ai/other', true)
    a.emit('did-navigate-in-page', {}, a.url, true)
    expect((await observer.observe()).status).toBe('unknown')
  })
  it('does not mistake known subframe navigation for main-frame navigation', async () => {
    const registry = new ArenaViewRegistry(),
      a = new FakeContents(1)
    registry.register('a', a.asWebContents())
    const observer = registry.createObserver('a')!
    a.emit('did-start-navigation', { isMainFrame: false }, 'https://www.google.com/', false, false)
    a.emit('did-navigate-in-page', {}, 'https://www.google.com/', false)
    expect((await observer.observe()).status).toBe('observed')
  })
  it('invalidates conservatively if navigation event frame information is missing', async () => {
    const registry = new ArenaViewRegistry(),
      a = new FakeContents(1)
    registry.register('a', a.asWebContents())
    const observer = registry.createObserver('a')!
    a.emit('did-start-navigation', {})
    expect((await observer.observe()).status).toBe('unknown')
  })
  it('invalidates an in-flight observation when navigation starts', async () => {
    const registry = new ArenaViewRegistry(),
      a = new FakeContents(1)
    let complete!: (data: unknown) => void
    a.executeJavaScriptInIsolatedWorld.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        })
    )
    registry.register('a', a.asWebContents())
    const observer = registry.createObserver('a')!
    const pending = observer.observe()
    a.emit('did-start-navigation', { isMainFrame: true })
    complete(controls)
    expect(await pending).toEqual({
      status: 'unknown',
      reason: 'view-changed',
      providerCondition: 'unknown'
    })
  })
  it('prevents one webContents or its numeric ID from being owned by two tabs', () => {
    const registry = new ArenaViewRegistry(),
      a = new FakeContents(1),
      duplicate = new FakeContents(1)
    registry.register('a', a.asWebContents())
    expect(() => registry.register('b', a.asWebContents())).toThrow(/another tab/)
    expect(() => registry.register('b', duplicate.asWebContents())).toThrow(/another tab/)
    expect(registry.resolve('b')).toBeUndefined()
  })
  it('allows replacement but ignores teardown and events from the old view', () => {
    const registry = new ArenaViewRegistry(),
      old = new FakeContents(1),
      fresh = new FakeContents(2)
    registry.register('a', old.asWebContents())
    const previous = registry.resolve('a')!.navigationGeneration
    registry.register('a', fresh.asWebContents())
    const generation = registry.resolve('a')!.navigationGeneration
    expect(generation).toBeGreaterThan(previous)
    old.emit('destroyed')
    registry.unregister('a', old.asWebContents())
    expect(registry.resolve('a')?.webContents).toBe(fresh)
    expect(registry.resolve('a')?.navigationGeneration).toBe(generation)
  })
  it.each(['destroyed', 'render-process-gone'])('removes dead view on %s', (event) => {
    const registry = new ArenaViewRegistry(),
      a = new FakeContents(1)
    registry.register('a', a.asWebContents())
    a.emit(event)
    expect(registry.resolve('a')).toBeUndefined()
    expect(registry.createObserver('a')).toBeNull()
  })
  it('supports explicit invalidation for grant/account changes and cleanup', async () => {
    const registry = new ArenaViewRegistry(),
      a = new FakeContents(1)
    registry.register('a', a.asWebContents())
    const observer = registry.createObserver('a')!
    registry.invalidate('a')
    expect((await observer.observe()).status).toBe('unknown')
    registry.clear()
    expect(registry.resolve('a')).toBeUndefined()
    expect(a.listenerCount('did-start-navigation')).toBe(0)
  })
  it('rolls back partial listener setup and rejects invalid registrations', () => {
    const registry = new ArenaViewRegistry(),
      a = new FakeContents(1)
    expect(() => registry.register('', a.asWebContents())).toThrow(/Invalid/)
    vi.spyOn(a, 'on').mockImplementationOnce(() => {
      throw new Error('setup failed')
    })
    expect(() => registry.register('a', a.asWebContents())).toThrow(/registration failed/)
    expect(registry.resolve('a')).toBeUndefined()
  })
  it('does not increment when registering the same live view twice', () => {
    const registry = new ArenaViewRegistry(),
      a = new FakeContents(1)
    registry.register('a', a.asWebContents())
    const before = registry.resolve('a')!.navigationGeneration
    registry.register('a', a.asWebContents())
    expect(registry.resolve('a')!.navigationGeneration).toBe(before)
    expect(a.listenerCount('did-start-navigation')).toBe(1)
  })
  it('invalidates when old and new frame flags conflict', async () => {
    const registry = new ArenaViewRegistry(),
      a = new FakeContents(1)
    registry.register('a', a.asWebContents())
    const observer = registry.createObserver('a')!
    a.emit('did-start-navigation', { isMainFrame: false }, '', false, true)
    expect((await observer.observe()).status).toBe('unknown')
  })
  it('forgets the view even when native listener removal throws', () => {
    const registry = new ArenaViewRegistry()
    const a = new FakeContents(1)
    registry.register('a', a.asWebContents())
    vi.spyOn(a, 'removeListener').mockImplementation(() => {
      throw new Error('native wrapper unavailable')
    })
    expect(() => registry.unregister('a', a.asWebContents())).not.toThrow()
    expect(registry.resolve('a')).toBeUndefined()
    // A failed cleanup cannot let old callbacks invalidate a replacement.
    const fresh = new FakeContents(2)
    registry.register('a', fresh.asWebContents())
    const generation = registry.resolve('a')!.navigationGeneration
    a.emit('did-start-navigation', { isMainFrame: true })
    expect(registry.resolve('a')?.navigationGeneration).toBe(generation)
  })
})
