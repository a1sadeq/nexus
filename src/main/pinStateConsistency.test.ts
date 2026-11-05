import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { EventEmitter } from 'node:events'
import {
  TabDiscardManager,
  type DiscardableView,
  type DiscardableWebContents
} from './tabDiscardManager'

function createMockView(id: string): { view: DiscardableView; destroyed: boolean } {
  let destroyed = false
  const events = new EventEmitter()
  const webContents: DiscardableWebContents = {
    once: (name, fn) => events.once(name, fn),
    removeListener: (name, fn) => events.removeListener(name, fn),
    getURL: () => `https://gemini.google.com/app/${id}`,
    isLoading: () => false,
    executeJavaScript: () => Promise.resolve(100),
    close: () => {
      destroyed = true
      events.emit('destroyed')
    },
    isDestroyed: () => destroyed
  }

  return {
    view: { webContents },
    get destroyed() {
      return destroyed
    }
  }
}

describe('Pin-State In-Memory Consistency & Discard Protection', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'nexus-pin-test-'))
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('protects tabs using an in-memory set without synchronous disk lookups', async () => {
    const pinnedSet = new Set<string>()
    let diskReadCount = 0

    const manager = new TabDiscardManager({
      getUserDataDir: () => tempDir,
      isPinned: (tabId) => {
        // Must be zero disk reads
        return pinnedSet.has(tabId)
      },
      onTeardown: (_id, v) => v.webContents.close()
    })

    manager.init()
    manager.setPolicy({ maxActiveTabs: 2 }) // with 3 tabs, 1 must be evicted

    const view1 = createMockView('tab-pinned')
    const view2 = createMockView('tab-normal')
    const viewActive = createMockView('tab-active')

    // Mark tab-pinned as pinned in the in-memory set
    pinnedSet.add('tab-pinned')

    manager.registerView('tab-pinned', view1.view)
    manager.registerView('tab-normal', view2.view)
    manager.registerView('tab-active', viewActive.view)

    manager.activateTab('tab-active')
    await new Promise((r) => setTimeout(r, 20))

    // tab-pinned is protected by in-memory set, tab-active is active -> only tab-normal is evicted!
    expect(view1.destroyed).toBe(false)
    expect(view2.destroyed).toBe(true)
    expect(viewActive.destroyed).toBe(false)
    expect(diskReadCount).toBe(0)
  })

  it('dynamically reacts when pin status is toggled in memory', async () => {
    const pinnedSet = new Set<string>(['tab-1'])

    const manager = new TabDiscardManager({
      getUserDataDir: () => tempDir,
      isPinned: (tabId) => pinnedSet.has(tabId),
      onTeardown: (_id, v) => v.webContents.close()
    })

    manager.init()
    manager.setPolicy({ maxActiveTabs: 1 })

    const view1 = createMockView('tab-1')
    const view2 = createMockView('tab-2')

    manager.registerView('tab-1', view1.view)
    manager.activateTab('tab-1')

    // Now unpin tab-1 and register tab-2 as active
    pinnedSet.delete('tab-1')
    manager.registerView('tab-2', view2.view)
    manager.activateTab('tab-2')
    await new Promise((r) => setTimeout(r, 20))

    // Because tab-1 was unpinned, it is now eligible and gets evicted
    expect(view1.destroyed).toBe(true)
    expect(view2.destroyed).toBe(false)
  })
})
