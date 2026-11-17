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
      maxActiveTabs: 7
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

  it('does not commit a pending eviction after the tab becomes busy', async () => {
    let resolveSnapshot!: (value: number) => void
    let busy = false
    const target = createMockView('target', {
      pendingSnapshot: true,
      onSnapshotResolve: (resolve) => { resolveSnapshot = resolve }
    })
    const active = createMockView('active')
    const manager = new TabDiscardManager({
      getUserDataDir: () => tempDir,
      clock: () => simulatedTime,
      isBusy: (id) => id === 'target' && busy,
      onTeardown: (_id, view) => view.webContents.close()
    })
    manager.init()
    try {
      manager.setPolicy({ maxActiveTabs: 1 })
      manager.registerView('target', target.view)
      manager.registerView('active', active.view)
      manager.activateTab('active')
      expect(manager.getStatus().pendingCount).toBe(1)
      busy = true
      resolveSnapshot(0)
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(target.destroyed).toBe(false)
      expect(manager.hasView('target')).toBe(true)
      expect(manager.getStatus().pendingCount).toBe(0)
    } finally {
      manager.stop()
    }
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

  it('D15: protects tabs activated within retentionGraceMs (15 min) from capacity eviction', async () => {
    const mockA = createMockView('tabA')
    const mockB = createMockView('tabB')

    const manager = new TabDiscardManager({
      getUserDataDir: () => tempDir,
      clock: () => simulatedTime,
      retentionGraceMs: 15 * 60 * 1000,
      onTeardown: (_id, v) => v.webContents.close()
    })
    manager.init()
    manager.setPolicy({ maxActiveTabs: 1 })

    manager.registerView('tabA', mockA.view)
    manager.activateTab('tabA')

    // 2 minutes later, user activates tabB
    simulatedTime += 2 * 60 * 1000
    manager.registerView('tabB', mockB.view)
    manager.activateTab('tabB')

    // Reconcile capacity runs: totalResident (2) > maxActiveTabs (1)
    // But tabA was activated only 2 minutes ago (< 15 min grace period)
    manager.reconcileCapacity()
    await new Promise((r) => setTimeout(r, 20))

    // tabA MUST NOT be evicted because of the 15-minute grace period!
    expect(mockA.destroyed).toBe(false)
    expect(manager.hasView('tabA')).toBe(true)
    expect(manager.getStatus().pendingCount).toBe(0)

    // Advance simulated time past 15 minutes (e.g. 16 minutes after tabA was active)
    simulatedTime += 14 * 60 * 1000 + 1
    manager.reconcileCapacity()
    await new Promise((r) => setTimeout(r, 20))

    // Now tabA is past 15 minutes and gets evicted for capacity
    expect(mockA.destroyed).toBe(true)
    expect(manager.isTabEvicted('tabA')).toBe(true)
  })

  it('idle timeout threshold measures from max(backgroundSince, enteredIdleAt)', async () => {
    let tabAStatus: 'working' | 'idle' = 'working'
    const mockA = createMockView('tabA')
    const mockB = createMockView('tabB')

    const manager = new TabDiscardManager({
      getUserDataDir: () => tempDir,
      clock: () => simulatedTime,
      isBusy: (id) => id === 'tabA' && tabAStatus !== 'idle',
      onTeardown: (_id, v) => v.webContents.close()
    })
    manager.init()
    manager.setPolicy({ tabDiscardMinutes: 30 })

    // tabA active initially
    manager.registerView('tabA', mockA.view)
    manager.activateTab('tabA')

    // At t=10m, switch to tabB. tabA is now in background, but still working!
    simulatedTime += 10 * 60 * 1000
    manager.registerView('tabB', mockB.view)
    manager.activateTab('tabB')

    // At t=40m (30 min background), tabA completes work and enters idle
    simulatedTime += 30 * 60 * 1000
    tabAStatus = 'idle'
    manager.onAiStatusChanged('tabA', true)
    expect(manager.getEnteredIdleAt('tabA')).toBe(simulatedTime)

    // At t=60m (50 min background, but only 20 min idle < 30 min policy)
    simulatedTime += 20 * 60 * 1000
    manager.checkIdleTimeout()
    expect(mockA.destroyed).toBe(false)
    expect(manager.hasView('tabA')).toBe(true)

    // At t=71m (61 min background, 31 min idle >= 30 min policy)
    simulatedTime += 11 * 60 * 1000
    manager.checkIdleTimeout()
    await new Promise((r) => setTimeout(r, 20))
    expect(mockA.destroyed).toBe(true)
    expect(manager.isTabEvicted('tabA')).toBe(true)
  })

  it('capacity reconciliation protects busy tabs even when retention grace has expired', async () => {
    let busyTab = true
    const mockBusy = createMockView('tabBusy')
    const mockIdle = createMockView('tabIdle')
    const mockActive = createMockView('tabActive')

    const manager = new TabDiscardManager({
      getUserDataDir: () => tempDir,
      clock: () => simulatedTime,
      retentionGraceMs: 5 * 60 * 1000,
      isBusy: (id) => id === 'tabBusy' && busyTab,
      onTeardown: (_id, v) => v.webContents.close()
    })
    manager.init()
    manager.setPolicy({ maxActiveTabs: 1 })

    manager.registerView('tabBusy', mockBusy.view)
    manager.registerView('tabIdle', mockIdle.view)
    manager.onAiStatusChanged('tabIdle', true)
    manager.registerView('tabActive', mockActive.view)
    manager.activateTab('tabActive')

    // Advance 10 minutes (grace period expired for both background tabs)
    simulatedTime += 10 * 60 * 1000
    manager.reconcileCapacity()
    await new Promise((r) => setTimeout(r, 20))

    // tabIdle was evicted, tabBusy remained protected
    expect(mockIdle.destroyed).toBe(true)
    expect(mockBusy.destroyed).toBe(false)
    expect(manager.hasView('tabBusy')).toBe(true)

    // Verify getStatus diagnostics
    const status = manager.getStatus()
    expect(status.protectedCount).toBe(2) // tabActive (active) + tabBusy (busy)
    expect(status.exceededReason).toContain('All resident background tabs are protected')
  })

  it('cancels pending eviction and invalidates ticket when tab transitions to non-idle', async () => {
    let resolveSnapshot!: (val: number) => void
    const mockA = createMockView('tabA', {
      pendingSnapshot: true,
      onSnapshotResolve: (r) => {
        resolveSnapshot = r
      }
    })
    const mockActive = createMockView('tabActive')

    let isBusyA = false
    const manager = new TabDiscardManager({
      getUserDataDir: () => tempDir,
      clock: () => simulatedTime,
      isBusy: (id) => id === 'tabA' && isBusyA,
      onTeardown: (_id, v) => v.webContents.close()
    })
    manager.init()
    manager.setPolicy({ maxActiveTabs: 1 })

    manager.registerView('tabA', mockA.view)
    manager.onAiStatusChanged('tabA', true)
    manager.registerView('tabActive', mockActive.view)
    manager.activateTab('tabActive')

    // Wait 16 minutes to pass retention grace
    simulatedTime += 16 * 60 * 1000
    manager.reconcileCapacity()

    // Eviction for tabA is now pending snapshot
    expect(manager.getStatus().pendingCount).toBe(1)

    // While snapshot is pending, tabA starts generating or receives prompt -> non-idle!
    isBusyA = true
    manager.onAiStatusChanged('tabA', false)

    // Snapshot finishes
    resolveSnapshot(100)
    await new Promise((r) => setTimeout(r, 20))

    // Eviction must be aborted!
    expect(mockA.destroyed).toBe(false)
    expect(manager.hasView('tabA')).toBe(true)
    expect(manager.getStatus().pendingCount).toBe(0)
  })
})

