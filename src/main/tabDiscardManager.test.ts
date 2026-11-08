import { EventEmitter } from 'node:events'

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import {
  TabDiscardManager,
  type DiscardableView,
  type DiscardableWebContents
} from './tabDiscardManager'

function createMockView(id: string, options: {
  url?: string
  isLoading?: boolean
  pendingSnapshot?: boolean
  onSnapshotResolve?: (resolve: (val: number) => void) => void
  onSnapshotReject?: (reject: (err: Error) => void) => void
} = {}): { view: DiscardableView; destroyed: boolean } {
  let destroyed = false
  const events = new EventEmitter()
  const webContents: DiscardableWebContents = {
    once: (name, fn) => events.once(name, fn),
    removeListener: (name, fn) => events.removeListener(name, fn),
    getURL: () => options.url || `https://arena.ai/agent/${id}`,
    isLoading: () => !!options.isLoading,
    executeJavaScript: () => {
      if (options.pendingSnapshot) {
        return new Promise((resolve, reject) => {
          if (options.onSnapshotResolve) options.onSnapshotResolve(resolve)
          if (options.onSnapshotReject) options.onSnapshotReject(reject)
        })
      }
      return Promise.resolve(120)
    },
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

describe('TabDiscardManager', () => {
  let tempDir: string
  let simulatedTime: number

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'nexus-discard-test-'))
    simulatedTime = 1000000
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('D01 & D02: loads default policy when no file exists, saves and reloads persisted policy', () => {
    const manager = new TabDiscardManager({
      getUserDataDir: () => tempDir,
      clock: () => simulatedTime
    })
    manager.init()

    expect(manager.getPolicy().policy).toEqual({
      version: 1,
      tabDiscardMinutes: 10,
      maxActiveTabs: 10
    })

    // Set new policy: 60 minutes, max 5 tabs
    const res = manager.setPolicy({ tabDiscardMinutes: 60, maxActiveTabs: 5 })
    expect(res.success).toBe(true)
    expect(res.policy).toEqual({
      version: 1,
      tabDiscardMinutes: 60,
      maxActiveTabs: 5
    })

    // Verify file exists on disk
    const filePath = manager.getPolicyFilePath()
    expect(existsSync(filePath)).toBe(true)
    const diskContent = JSON.parse(readFileSync(filePath, 'utf-8'))
    expect(diskContent).toEqual({
      version: 1,
      tabDiscardMinutes: 60,
      maxActiveTabs: 5
    })

    // Recreate manager to simulate app restart
    const manager2 = new TabDiscardManager({
      getUserDataDir: () => tempDir,
      clock: () => simulatedTime
    })
    manager2.init()
    expect(manager2.getPolicy().policy).toEqual({
      version: 1,
      tabDiscardMinutes: 60,
      maxActiveTabs: 5
    })
  })

  it('D04: pending eviction does not destroy newly active tab', async () => {
    let resolveSnapshot!: (val: number) => void
    const mockA = createMockView('tabA', {
      pendingSnapshot: true,
      onSnapshotResolve: (r) => {
        resolveSnapshot = r
      }
    })
    const mockB = createMockView('tabB')

    const manager = new TabDiscardManager({
      getUserDataDir: () => tempDir,
      clock: () => simulatedTime,
      onTeardown: (_id, v) => v.webContents.close()
    })
    manager.init()

    // Configure maxActiveTabs = 1
    manager.setPolicy({ maxActiveTabs: 1 })

    // Register tabA, then tabB as active
    manager.registerView('tabA', mockA.view)
    simulatedTime += 1000
    manager.registerView('tabB', mockB.view)
    manager.activateTab('tabB')

    // At this point, tabA is background and capacity eviction should be pending
    const statusBefore = manager.getStatus()
    expect(statusBefore.residentCount).toBe(2)
    expect(statusBefore.pendingCount).toBe(1)
    expect(mockA.destroyed).toBe(false)

    // USER ACTIVATES tabA while snapshot is still pending!
    manager.activateTab('tabA')
    expect(manager.getActiveViewId()).toBe('tabA')

    // Snapshot now resolves
    resolveSnapshot(50)
    await new Promise((r) => setTimeout(r, 10))

    // tabA MUST NOT be destroyed!
    expect(mockA.destroyed).toBe(false)
    expect(manager.hasView('tabA')).toBe(true)
    expect(manager.getActiveViewId()).toBe('tabA')
  })

  it('D05: bounded snapshot timeout allows eviction even if renderer never resolves', async () => {
    const mockA = createMockView('tabA', { pendingSnapshot: true })
    const mockB = createMockView('tabB')

    const manager = new TabDiscardManager({
      getUserDataDir: () => tempDir,
      snapshotTimeoutMs: 50, // Short timeout for test
      clock: () => simulatedTime,
      onTeardown: (_id, v) => v.webContents.close()
    })
    manager.init()
    manager.setPolicy({ maxActiveTabs: 1 })

    manager.registerView('tabA', mockA.view)
    simulatedTime += 1000
    manager.registerView('tabB', mockB.view)
    manager.activateTab('tabB')

    expect(mockA.destroyed).toBe(false)

    // Wait for timeout
    await new Promise((r) => setTimeout(r, 80))

    // tabA should be evicted despite hanging snapshot
    expect(mockA.destroyed).toBe(true)
    expect(manager.hasView('tabA')).toBe(false)
    expect(manager.isTabEvicted('tabA')).toBe(true)
    expect(manager.getEvictedTabState('tabA')?.scrollY).toBe(0)
  })

  it('D03 & D08: idle timer uses backgroundSince and has NO 1-minute generic title override', async () => {
    const mockA = createMockView('tabA')
    const mockB = createMockView('tabB')

    const manager = new TabDiscardManager({
      getUserDataDir: () => tempDir,
      clock: () => simulatedTime,
      onTeardown: (_id, v) => v.webContents.close()
    })
    manager.init()
    manager.setPolicy({ tabDiscardMinutes: 60 }) // 1 hour

    // tabA was created and active
    manager.registerView('tabA', mockA.view)
    manager.activateTab('tabA')

    // 10 minutes pass while tabA is active
    simulatedTime += 10 * 60 * 1000

    // Switch to tabB. tabA is now background starting at this instant
    manager.registerView('tabB', mockB.view)
    manager.activateTab('tabB')

    // 2 minutes pass in background (in legacy code, "New Chat" was evicted here!)
    simulatedTime += 2 * 60 * 1000
    manager.checkIdleTimeout()

    expect(mockA.destroyed).toBe(false)
    expect(manager.hasView('tabA')).toBe(true)

    // 57 more minutes pass (total 59 min in background, still < 60 min threshold)
    simulatedTime += 57 * 60 * 1000
    manager.checkIdleTimeout()
    expect(mockA.destroyed).toBe(false)

    // 2 more minutes pass (total 61 min in background, >= 60 min)
    simulatedTime += 2 * 60 * 1000
    manager.checkIdleTimeout()
    await new Promise((r) => setTimeout(r, 20))
    expect(mockA.destroyed).toBe(true)
  })

  it('D11 & D12: protects pinned and loading tabs from idle and capacity eviction', async () => {
    const pinnedSet = new Set<string>(['tabA'])
    const mockA = createMockView('tabA')
    const mockB = createMockView('tabB', { isLoading: true })
    const mockC = createMockView('tabC')
    const mockActive = createMockView('tabActive')

    const manager = new TabDiscardManager({
      getUserDataDir: () => tempDir,
      clock: () => simulatedTime,
      isPinned: (id) => pinnedSet.has(id),
      onTeardown: (_id, v) => v.webContents.close()
    })
    manager.init()
    manager.setPolicy({ maxActiveTabs: 3 }) // 4 tabs resident, needs 1 evicted

    manager.registerView('tabA', mockA.view)
    manager.registerView('tabB', mockB.view)
    manager.registerView('tabC', mockC.view)
    manager.registerView('tabActive', mockActive.view)
    manager.activateTab('tabActive')
    await new Promise((r) => setTimeout(r, 20))

    // tabA is pinned, tabB is loading, tabActive is active -> tabC is the only eligible target!
    expect(mockA.destroyed).toBe(false)
    expect(mockB.destroyed).toBe(false)
    expect(mockC.destroyed).toBe(true)
    expect(mockActive.destroyed).toBe(false)
  })

  it('D14: explicit navigation clears stale restore state', async () => {
    const mockA = createMockView('tabA', { url: 'https://arena.ai/old' })
    const mockB = createMockView('tabB')

    const manager = new TabDiscardManager({
      getUserDataDir: () => tempDir,
      clock: () => simulatedTime,
      onTeardown: (_id, v) => v.webContents.close()
    })
    manager.init()
    manager.setPolicy({ maxActiveTabs: 1 })

    manager.registerView('tabA', mockA.view)
    simulatedTime += 1000
    manager.registerView('tabB', mockB.view)
    manager.activateTab('tabB')
    await new Promise((r) => setTimeout(r, 20))

    // tabA is evicted and has saved state
    expect(manager.isTabEvicted('tabA')).toBe(true)
    expect(manager.getEvictedTabState('tabA')?.url).toBe('https://arena.ai/old')

    // Explicit navigation to new URL
    manager.onExplicitNavigation('tabA')
    expect(manager.isTabEvicted('tabA')).toBe(false)
    expect(manager.getEvictedTabState('tabA')).toBeUndefined()
  })
})

