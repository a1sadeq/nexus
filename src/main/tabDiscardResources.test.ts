import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TabDiscardManager } from './tabDiscardManager'

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
function view(loading = false) {
  const events = new EventEmitter()
  const state = { loading, destroyed: false }
  const wc = {
    getURL: () => 'https://arena.ai/agent/test', isLoading: () => state.loading,
    isDestroyed: () => state.destroyed,
    executeJavaScript: vi.fn((): Promise<unknown> => Promise.resolve(0)),
    close: vi.fn(() => { state.destroyed = true; events.emit('destroyed') }),
    once: (name: 'destroyed', fn: () => void) => events.once(name, fn),
    removeListener: (name: 'destroyed', fn: () => void) => events.removeListener(name, fn)
  }
  return { state, view: { webContents: wc } }
}
let directory: string
const managers: TabDiscardManager[] = []
beforeEach(() => { vi.useFakeTimers(); directory = mkdtempSync(join(tmpdir(), 'nexus-resource-')) })
afterEach(() => { managers.splice(0).forEach(m => m.stop()); vi.useRealTimers(); vi.restoreAllMocks(); rmSync(directory, { recursive: true, force: true }) })
function manager(extra: Partial<ConstructorParameters<typeof TabDiscardManager>[0]> = {}) {
  const m = new TabDiscardManager({ getUserDataDir: () => directory, idleCheckIntervalMs: 1000, ...extra })
  managers.push(m); m.init(); return m
}

describe('resource policy regressions', () => {
  it('retries capacity after loading finishes even when idle discard is disabled', async () => {
    const m = manager(); m.setPolicy({ maxActiveTabs: 1, tabDiscardMinutes: 0 })
    const a = view(true), b = view(true)
    m.registerView('a', a.view); m.activateTab('a'); m.registerView('b', b.view); m.activateTab('b')
    a.state.loading = false; b.state.loading = false
    expect(m.getStatus().effectiveCapExceeded).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(m.getStatus().residentCount).toBe(1); expect(a.state.destroyed).toBe(true)
  })
  it('retains resident tracking and does not invent restore state when close fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const m = manager(); m.setPolicy({ maxActiveTabs: 1 })
    const a = view(), b = view(); a.view.webContents.close.mockImplementation(() => { throw new Error('blocked') })
    m.registerView('a', a.view); m.activateTab('a'); m.registerView('b', b.view); m.activateTab('b')
    await vi.advanceTimersByTimeAsync(0)
    expect(m.getStatus().residentCount).toBe(2); expect(m.isTabEvicted('a')).toBe(false)
    expect(m.getStatus().lastTeardownError).toContain('blocked')
    await vi.advanceTimersByTimeAsync(29000)
    expect(a.view.webContents.close).toHaveBeenCalledTimes(1)
  })
  it('does not trust a teardown callback that never destroys the contents', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const m = manager({ onTeardown: async () => {} }); const a = view()
    m.registerView('a', a.view)
    expect(await m.closeTab('a')).toBe(false); expect(m.hasView('a')).toBe(true)
  })
  it('keeps a closing view resident and resolves activation waiters after bookkeeping', async () => {
    const done = deferred<void>(); const a = view(), b = view()
    const m = manager({ onTeardown: async (_id, target) => { await done.promise; target.webContents.close() } })
    m.setPolicy({ maxActiveTabs: 1 }); m.registerView('a', a.view); m.activateTab('a'); m.registerView('b', b.view); m.activateTab('b')
    await vi.advanceTimersByTimeAsync(0)
    expect(m.getStatus().residentCount).toBe(2); expect(m.getStatus().closingCount).toBe(1)
    const waiting = m.waitForClose('a').then(() => {
      expect(m.hasView('a')).toBe(false); expect(m.isTabEvicted('a')).toBe(true)
    })
    done.resolve(); await waiting
  })
  it('does not call native close twice for simultaneous manual-close requests', async () => {
    const done = deferred<void>(); const a = view()
    const teardown = vi.fn(async () => { await done.promise; a.view.webContents.close() })
    const m = manager({ onTeardown: teardown }); m.registerView('a', a.view)
    const first = m.closeTab('a'), second = m.closeTab('a')
    await vi.advanceTimersByTimeAsync(0); expect(teardown).toHaveBeenCalledTimes(1)
    done.resolve(); expect(await first).toBe(true); expect(await second).toBe(true)
    expect(m.getStatus().residentCount).toBe(0)
  })
  it('revalidates pin protection after asynchronous scroll capture', async () => {
    let pinned = false; const scroll = deferred<unknown>(); const a = view(), b = view()
    a.view.webContents.executeJavaScript.mockImplementation(() => scroll.promise)
    const m = manager({ isPinned: id => id === 'a' && pinned }); m.setPolicy({ maxActiveTabs: 1 })
    m.registerView('a', a.view); m.activateTab('a'); m.registerView('b', b.view); m.activateTab('b')
    pinned = true; scroll.resolve(0); await vi.advanceTimersByTimeAsync(0)
    expect(a.state.destroyed).toBe(false); expect(m.hasView('a')).toBe(true)
  })
  it('respects an increased idle timeout before committing an old snapshot', async () => {
    let now = 100000; const scroll = deferred<unknown>(); const a = view(), b = view()
    a.view.webContents.executeJavaScript.mockImplementation(() => scroll.promise)
    const m = manager({ clock: () => now }); m.setPolicy({ maxActiveTabs: 0, tabDiscardMinutes: 5 })
    m.registerView('a', a.view); m.activateTab('a'); m.registerView('b', b.view); m.activateTab('b')
    now += 6 * 60000; m.checkIdleTimeout(); m.setPolicy({ tabDiscardMinutes: 60 })
    scroll.resolve(0); await vi.advanceTimersByTimeAsync(0)
    expect(a.state.destroyed).toBe(false)
  })
})
