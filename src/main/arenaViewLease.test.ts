import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { ArenaViewRegistry } from './arenaViewRegistry'
import { acquireArenaViewLease } from './arenaViewLease'

class FakeContents extends EventEmitter {
  destroyed = false
  constructor(public id: number) {
    super()
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  getURL(): string {
    return 'https://arena.ai/'
  }
  async executeJavaScriptInIsolatedWorld(): Promise<unknown> {
    return null
  }
  wc(): WebContents {
    return this as unknown as WebContents
  }
}
function fixture(): { registry: ArenaViewRegistry; contents: FakeContents } {
  const registry = new ArenaViewRegistry(),
    contents = new FakeContents(1)
  registry.register('a', contents.wc())
  return { registry, contents }
}

describe('unwired Arena view lease', () => {
  it('captures a registered view and invalidates before a main-frame navigation commits', () => {
    const { registry, contents } = fixture(),
      lease = acquireArenaViewLease(registry, 'a')
    expect(lease.navigationGeneration).toBe(registry.resolve('a')?.navigationGeneration)
    expect(lease.webContentsId).toBe(1)
    expect(() => lease.assertCurrent()).not.toThrow()
    contents.emit('did-start-navigation', { isMainFrame: true })
    expect(lease.signal.aborted).toBe(true)
    expect(() => lease.assertCurrent()).toThrow('invalid')
  })
  it('conservatively aborts even for subframe and same-document events', () => {
    const a = fixture(),
      first = acquireArenaViewLease(a.registry, 'a')
    a.contents.emit('did-start-navigation', { isMainFrame: false }, '', false, false)
    expect(first.signal.aborted).toBe(true)
    const b = fixture(),
      second = acquireArenaViewLease(b.registry, 'a')
    b.contents.emit('did-navigate-in-page', {}, 'https://arena.ai/#next', true)
    expect(second.signal.aborted).toBe(true)
  })
  it.each(['did-navigate', 'render-process-gone', 'destroyed'])('aborts on %s', (event) => {
    const { registry, contents } = fixture(),
      lease = acquireArenaViewLease(registry, 'a')
    contents.emit(event)
    expect(lease.signal.aborted).toBe(true)
  })
  it('detects replacement and manual registry invalidation on explicit checks', () => {
    const { registry, contents } = fixture(),
      old = acquireArenaViewLease(registry, 'a')
    registry.register('a', new FakeContents(2).wc())
    expect(old.signal.aborted).toBe(false)
    expect(() => old.assertCurrent()).toThrow()
    expect(old.signal.aborted).toBe(true)
    contents.emit('destroyed')
    const current = acquireArenaViewLease(registry, 'a')
    registry.invalidate('a')
    expect(() => current.assertCurrent()).toThrow()
  })
  it('disposal signals before returning, removes listeners, and is idempotent under reentrancy', () => {
    const { registry, contents } = fixture(),
      before = contents.listenerCount('destroyed')
    const lease = acquireArenaViewLease(registry, 'a')
    expect(contents.listenerCount('destroyed')).toBe(before + 1)
    lease.signal.addEventListener('abort', () => lease.dispose())
    lease.dispose()
    lease.dispose()
    expect(lease.signal.aborted).toBe(true)
    expect(contents.listenerCount('destroyed')).toBe(before)
    expect(() => lease.assertCurrent()).toThrow()
  })
  it('fails closed and rolls back partially attached listeners when attachment throws', () => {
    const { registry, contents } = fixture()
    const original = contents.on.bind(contents)
    vi.spyOn(contents, 'on').mockImplementation((event, listener) => {
      if (event === 'did-navigate') throw new Error('native private details')
      return original(event, listener)
    })
    expect(() => acquireArenaViewLease(registry, 'a')).toThrow('View unavailable or changed')
    expect(contents.listenerCount('did-start-navigation')).toBe(1)
  })
  it('rejects unavailable views and changes during listener setup', () => {
    const { registry, contents } = fixture()
    expect(() => acquireArenaViewLease(registry, 'missing')).toThrow()
    const original = contents.on.bind(contents)
    vi.spyOn(contents, 'on').mockImplementation((event, listener) => {
      const result = original(event, listener)
      if (event === 'did-navigate') registry.invalidate('a')
      return result
    })
    expect(() => acquireArenaViewLease(registry, 'a')).toThrow('changed')
  })
  it('does not attach later listeners if a navigation fires during setup', () => {
    const { registry, contents } = fixture()
    const before = contents.listenerCount('destroyed')
    const original = contents.on.bind(contents)
    vi.spyOn(contents, 'on').mockImplementation((event, listener) => {
      const result = original(event, listener)
      if (event === 'did-navigate') contents.emit('did-start-navigation', { isMainFrame: true })
      return result
    })
    expect(() => acquireArenaViewLease(registry, 'a')).toThrow()
    expect(contents.listenerCount('destroyed')).toBe(before)
    expect(contents.listenerCount('did-start-navigation')).toBe(1)
    expect(contents.listenerCount('did-navigate')).toBe(1)
  })
})
