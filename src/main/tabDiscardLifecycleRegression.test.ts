import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TabDiscardManager, type DiscardableView } from './tabDiscardManager'

function fixture() {
  const events = new EventEmitter()
  let destroyed = false
  const contents = {
    getURL: () => 'https://example.test/chat',
    isDestroyed: () => destroyed,
    isLoading: vi.fn(() => false),
    executeJavaScript: async () => 0,
    close: vi.fn(() => { destroyed = true; current = undefined; events.emit('destroyed') }),
    once: (name: 'destroyed', fn: () => void) => events.once(name, fn),
    removeListener: (name: 'destroyed', fn: () => void) => events.removeListener(name, fn)
  }
  let current: typeof contents | undefined = contents
  // Model a native View whose WebContents accessor becomes unavailable.
  const view: DiscardableView = { get webContents() { return current! } }
  return { view, contents, vanish: () => { current = undefined }, destroy: () => { destroyed = true; current = undefined } }
}
let directory: string
const managers: TabDiscardManager[] = []
beforeEach(() => { vi.useFakeTimers(); directory = mkdtempSync(join(tmpdir(), 'nexus-stale-view-')) })
afterEach(() => { managers.splice(0).forEach(m => m.stop()); vi.useRealTimers(); vi.restoreAllMocks(); rmSync(directory, { recursive: true, force: true }) })
function manager() {
  const m = new TabDiscardManager({ getUserDataDir: () => directory, idleCheckIntervalMs: 1000 })
  managers.push(m); m.init(); m.setPolicy({ maxActiveTabs: 0, tabDiscardMinutes: 0 }); return m
}

describe('stale WebContents lifecycle regression', () => {
  it('confirms manual close using the captured contents, not an invalidated view getter', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const m = manager(), a = fixture(); m.registerView('a', a.view)
    expect(await m.closeTab('a')).toBe(true)
    expect(m.hasView('a')).toBe(false); expect(m.getStatus().residentCount).toBe(0)
  })
  it('finishes automatic eviction after the getter disappears without leaving a stale resident', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const m = manager(), a = fixture(), b = fixture()
    m.registerView('a', a.view); m.activateTab('a'); m.registerView('b', b.view); m.activateTab('b')
    m.setPolicy({ maxActiveTabs: 1 }); await vi.advanceTimersByTimeAsync(0)
    expect(m.hasView('a')).toBe(false); expect(m.isTabEvicted('a')).toBe(true)
    expect(() => m.checkIdleTimeout()).not.toThrow()
    expect(m.getStatus().residentCount).toBe(1)
  })
  it('never queries loading on an already-destroyed wrapper', () => {
    const m = manager(), a = fixture(); m.registerView('a', a.view); a.destroy()
    a.contents.isLoading.mockImplementation(() => { throw new Error('Object has been destroyed') })
    expect(() => m.setPolicy({ maxActiveTabs: 1, tabDiscardMinutes: 5 })).not.toThrow()
    expect(() => m.checkIdleTimeout()).not.toThrow()
    expect(() => m.getStatus()).not.toThrow()
    expect(a.contents.isLoading).not.toHaveBeenCalled()
  })
  it('handles a throwing isLoading during maintenance without blocking healthy candidates', async () => {
    const m = manager(), a = fixture(), b = fixture(), c = fixture()
    m.registerView('a', a.view); m.registerView('b', b.view); m.registerView('c', c.view); m.activateTab('c')
    a.contents.isLoading.mockImplementation(() => { throw new Error('native wrapper unavailable') })
    expect(() => m.setPolicy({ maxActiveTabs: 1, tabDiscardMinutes: 5 })).not.toThrow()
    await vi.advanceTimersByTimeAsync(1000)
    expect(m.hasView('a')).toBe(true); expect(m.hasView('b')).toBe(false)
    expect(() => m.getStatus()).not.toThrow()
  })
  it('skips malformed resident records without declaring them successfully discarded', () => {
    const m = manager()
    ;(m as unknown as { views: Map<string, DiscardableView> }).views.set('bad', {} as DiscardableView)
    expect(() => m.setPolicy({ maxActiveTabs: 1, tabDiscardMinutes: 5 })).not.toThrow()
    expect(() => m.checkIdleTimeout()).not.toThrow()
    expect(() => m.getStatus()).not.toThrow()
    expect(m.isTabEvicted('bad')).toBe(false)
  })
  it('uses the owned contents reference if the view accessor disappears before close', async () => {
    const m = manager(), a = fixture(); m.registerView('a', a.view); a.vanish()
    expect(await m.closeTab('a')).toBe(true)
    expect(a.contents.close).toHaveBeenCalledTimes(1)
  })
})
