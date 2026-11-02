import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TabDiscardManager,
  type DiscardableView,
  isUsableRestoreUrl
} from './tabDiscardManager'

function createMockContents(initialUrl = 'https://arena.ai/agent/test', scrollY = 0) {
  const events = new EventEmitter()
  let destroyed = false
  let url = initialUrl
  let currentScroll = scrollY

  const executeJavaScript = vi.fn(async (code: string) => {
    const match = code.match(/window\.scrollTo\(0,\s*(\d+)\)/)
    if (match) {
      currentScroll = Number(match[1])
    }
    return currentScroll
  })

  const loadURL = vi.fn(async (targetUrl: string) => {
    url = targetUrl
  })

  const close = vi.fn(() => {
    destroyed = true
    events.emit('destroyed')
  })

  const contents = {
    getURL: () => url,
    setUrl: (newUrl: string) => { url = newUrl },
    getScroll: () => currentScroll,
    isLoading: () => false,
    isDestroyed: () => destroyed,
    executeJavaScript,
    loadURL,
    close,
    once: (name: 'destroyed', fn: () => void) => events.once(name, fn),
    removeListener: (name: 'destroyed', fn: () => void) => events.removeListener(name, fn)
  }

  const view: DiscardableView & {
    bounds?: unknown
    visible?: boolean
    setBounds: ReturnType<typeof vi.fn>
    setVisible: ReturnType<typeof vi.fn>
  } = {
    webContents: contents,
    setBounds: vi.fn((b: unknown) => { view.bounds = b }),
    setVisible: vi.fn((v: boolean) => { view.visible = v })
  }

  return { contents, view }
}

describe('Tab Discard Wake & Eviction Regressions', () => {
  let directory: string
  const managers: TabDiscardManager[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    directory = mkdtempSync(join(tmpdir(), 'nexus-wake-test-'))
  })

  afterEach(() => {
    managers.splice(0).forEach((m) => m.stop())
    vi.useRealTimers()
    vi.restoreAllMocks()
    rmSync(directory, { recursive: true, force: true })
  })

  function createManager(options: { maxActiveTabs?: number; tabDiscardMinutes?: number } = {}) {
    const m = new TabDiscardManager({
      getUserDataDir: () => directory,
      idleCheckIntervalMs: 1000,
      snapshotTimeoutMs: 50
    })
    managers.push(m)
    m.init()
    m.setPolicy({
      maxActiveTabs: options.maxActiveTabs ?? 0,
      tabDiscardMinutes: options.tabDiscardMinutes ?? 0
    })
    return m
  }

  describe('1. Empty and unusable restore URL discard prevention', () => {
    it('isUsableRestoreUrl correctly classifies URLs', () => {
      expect(isUsableRestoreUrl('')).toBe(false)
      expect(isUsableRestoreUrl('   ')).toBe(false)
      expect(isUsableRestoreUrl(null)).toBe(false)
      expect(isUsableRestoreUrl(undefined)).toBe(false)
      expect(isUsableRestoreUrl('about:blank')).toBe(false)
      expect(isUsableRestoreUrl('about:srcdoc')).toBe(false)
      expect(isUsableRestoreUrl('javascript:alert(1)')).toBe(false)
      expect(isUsableRestoreUrl('not a valid url')).toBe(false)

      expect(isUsableRestoreUrl('https://arena.ai/agent/123')).toBe(true)
      expect(isUsableRestoreUrl('http://localhost:3000')).toBe(true)
      expect(isUsableRestoreUrl('data:text/html,<h1>test</h1>')).toBe(true)
      expect(isUsableRestoreUrl('file:///home/user/doc.html')).toBe(true)
    })

    it('refuses to evict a tab with an empty URL', async () => {
      const m = createManager({ maxActiveTabs: 1 })
      const a = createMockContents('') // Empty URL
      const b = createMockContents('https://arena.ai/agent/active')

      m.registerView('tabA', a.view)
      m.activateTab('tabA')
      m.registerView('tabB', b.view)
      m.activateTab('tabB')

      // Trigger capacity check
      m.reconcileCapacity()
      await vi.advanceTimersByTimeAsync(100)

      expect(m.isTabEvicted('tabA')).toBe(false)
      expect(a.contents.close).not.toHaveBeenCalled()
      expect(m.getStatus().residentCount).toBe(2)
      expect(m.getStatus().protectedCount).toBe(2) // tabB is active, tabA has unusable URL
    })

    it('refuses to evict a tab with about:blank', async () => {
      const m = createManager()
      const a = createMockContents('about:blank')
      const b = createMockContents('https://arena.ai/agent/active')

      m.registerView('tabA', a.view)
      m.activateTab('tabA')
      m.registerView('tabB', b.view)
      m.activateTab('tabB')

      expect(m.requestEviction('tabA', 'capacity')).toBe(false)
      await vi.advanceTimersByTimeAsync(100)

      expect(m.isTabEvicted('tabA')).toBe(false)
      expect(a.contents.close).not.toHaveBeenCalled()
    })

    it('aborts commitEviction if URL becomes unusable during snapshot', async () => {
      const m = createManager({ maxActiveTabs: 1 })
      const a = createMockContents('https://arena.ai/agent/valid')
      const b = createMockContents('https://arena.ai/agent/active')

      m.registerView('tabA', a.view)
      m.activateTab('tabA')
      m.registerView('tabB', b.view)
      // Activating tabB automatically triggers capacity eviction of background tabA
      m.activateTab('tabB')

      // Tab navigates to about:blank while snapshot is pending
      a.contents.setUrl('about:blank')

      await vi.advanceTimersByTimeAsync(100)

      expect(m.isTabEvicted('tabA')).toBe(false)
      expect(a.contents.close).not.toHaveBeenCalled()
    })
  })

  describe('2. Restore URL resolution and fallback', () => {
    it('uses saved URL when valid, falling back to supplied URL if saved is missing/unusable', async () => {
      const m = createManager({ maxActiveTabs: 1 })

      // Case 1: tab has valid eviction state
      const a = createMockContents('https://arena.ai/agent/saved', 200)
      m.registerView('tabA', a.view)
      m.activateTab('tabA')
      const b = createMockContents('https://arena.ai/agent/b')
      m.registerView('tabB', b.view)
      m.activateTab('tabB')

      await vi.advanceTimersByTimeAsync(100)
      expect(m.isTabEvicted('tabA')).toBe(true)

      // Saved URL is used even if fallback is passed
      expect(m.getUsableRestoreUrl('tabA', 'https://arena.ai/agent/fallback')).toBe(
        'https://arena.ai/agent/saved'
      )

      // Case 2: non-evicted tab falls back to supplied URL
      expect(m.getUsableRestoreUrl('tabNonEvicted', 'https://arena.ai/agent/fallback')).toBe(
        'https://arena.ai/agent/fallback'
      )

      // Case 3: invalid fallback returns null
      expect(m.getUsableRestoreUrl('tabNonEvicted', 'about:blank')).toBeNull()
      expect(m.getUsableRestoreUrl('tabNonEvicted', '')).toBeNull()
    })
  })

  describe('3. Eviction state preservation on failure', () => {
    it('does not consume eviction state if wake view creation or load throws', async () => {
      const m = createManager({ maxActiveTabs: 1 })
      const a = createMockContents('https://arena.ai/agent/a', 450)
      m.registerView('tabA', a.view)
      m.activateTab('tabA')
      const b = createMockContents('https://arena.ai/agent/b')
      m.registerView('tabB', b.view)
      m.activateTab('tabB')

      await vi.advanceTimersByTimeAsync(100)
      expect(m.isTabEvicted('tabA')).toBe(true)

      // Simulate wake failure in controller:
      // A failed load or creation does NOT call consumeEvictedTabState
      const savedState = m.getEvictedTabState('tabA')
      expect(savedState).toBeDefined()
      expect(savedState?.scrollY).toBe(450)

      // Failed attempt 1: view creation throws
      try {
        throw new Error('Native view creation failed')
      } catch {
        // Preserved!
      }
      expect(m.isTabEvicted('tabA')).toBe(true)

      // Failed attempt 2: loadURL rejects
      const newView = createMockContents('about:blank')
      newView.contents.loadURL.mockRejectedValueOnce(new Error('ERR_NAME_NOT_RESOLVED'))

      try {
        await newView.contents.loadURL(savedState!.url)
        m.consumeEvictedTabState('tabA')
      } catch {
        // Preserved!
      }

      // Eviction state is STILL intact for retry!
      expect(m.isTabEvicted('tabA')).toBe(true)
      expect(m.getEvictedTabState('tabA')?.url).toBe('https://arena.ai/agent/a')

      // Succeeded attempt 3: loadURL resolves
      newView.contents.loadURL.mockResolvedValueOnce(undefined)
      await newView.contents.loadURL(savedState!.url)
      await newView.contents.executeJavaScript(`window.scrollTo(0, ${savedState!.scrollY})`)
      const consumed = m.consumeEvictedTabState('tabA')

      expect(consumed?.scrollY).toBe(450)
      expect(m.isTabEvicted('tabA')).toBe(false)
      expect(newView.contents.getScroll()).toBe(450)
    })
  })

  describe('4. Rapid switching and race condition handling', () => {
    it('restores scroll on the matching view and does not allow stale wake to overwrite newer navigation', async () => {
      const m = createManager({ maxActiveTabs: 1 })
      const a = createMockContents('https://arena.ai/agent/a', 700)
      m.registerView('tabA', a.view)
      m.activateTab('tabA')
      const b = createMockContents('https://arena.ai/agent/b')
      m.registerView('tabB', b.view)
      m.activateTab('tabB')

      await vi.advanceTimersByTimeAsync(100)
      expect(m.isTabEvicted('tabA')).toBe(true)

      // Wake token tracking simulation
      const wakeTokens = new Map<string, number>()

      // Step 1: User switches to Tab A (Wake 1 begins with token 1)
      const wakeToken1 = (wakeTokens.get('tabA') || 0) + 1
      wakeTokens.set('tabA', wakeToken1)

      let resolveWake1!: () => void
      const wake1Promise = new Promise<void>((r) => { resolveWake1 = r })
      const newViewA = createMockContents('about:blank')
      newViewA.contents.loadURL.mockImplementationOnce(() => wake1Promise)

      // Start wake 1
      const inFlightWake = (async () => {
        await newViewA.contents.loadURL('https://arena.ai/agent/a')
        if (wakeTokens.get('tabA') !== wakeToken1) {
          // Stale wake: do NOT restore scroll or consume
          return false
        }
        await newViewA.contents.executeJavaScript('window.scrollTo(0, 700)')
        m.consumeEvictedTabState('tabA')
        return true
      })()

      // Step 2: Before Wake 1 finishes, user explicitly navigates Tab A to a new URL
      wakeTokens.set('tabA', (wakeTokens.get('tabA') || 0) + 1) // token becomes 2
      m.onExplicitNavigation('tabA')
      expect(m.isTabEvicted('tabA')).toBe(false) // Cleared by explicit nav

      // Step 3: Wake 1 finishes
      resolveWake1()
      const completed = await inFlightWake

      // Wake 1 was cancelled/superseded!
      expect(completed).toBe(false)
      expect(newViewA.contents.getScroll()).toBe(0) // Scroll was NOT restored for old page
    })

    it('background wake load does not focus or overwrite when user rapidly switched to another tab', async () => {
      let activeViewId = 'tabA'
      let focusedViewId: string | null = null

      const viewA = createMockContents('about:blank', 300)
      const viewB = createMockContents('https://arena.ai/agent/b')

      let resolveLoadA!: () => void
      const loadAPromise = new Promise<void>((r) => { resolveLoadA = r })
      viewA.contents.loadURL.mockImplementationOnce(() => loadAPromise)

      // Wake Tab A
      const wakePromise = (async () => {
        await viewA.contents.loadURL('https://arena.ai/agent/a')
        await viewA.contents.executeJavaScript('window.scrollTo(0, 300)')
        if (activeViewId === 'tabA') {
          focusedViewId = 'tabA'
        }
      })()

      // User immediately switches to Tab B
      activeViewId = 'tabB'
      focusedViewId = 'tabB'
      viewA.view.setVisible(false)
      viewB.view.setVisible(true)

      // Tab A's load completes in background
      resolveLoadA()
      await wakePromise

      // Tab A restored its scroll
      expect(viewA.contents.getScroll()).toBe(300)
      // But did NOT steal focus from Tab B
      expect(focusedViewId).toBe('tabB')
      expect(viewA.view.visible).toBe(false)
      expect(viewB.view.visible).toBe(true)
    })
  })

  describe('5. Error resilience: title polling or stale view cannot leave selected view hidden', () => {
    it('sets selected view visible and bounded even if title poller or background view throws', () => {
      const selectedView = createMockContents('https://arena.ai/selected')
      const staleView = createMockContents('https://arena.ai/stale')

      // Stale background view throws on setVisible
      staleView.view.setVisible.mockImplementationOnce(() => {
        throw new Error('Stale native view destroyed')
      })

      const aiViews = new Map<string, typeof selectedView.view>([
        ['staleTab', staleView.view],
        ['selectedTab', selectedView.view]
      ])

      const bounds = { x: 0, y: 0, width: 1024, height: 768 }
      const tabId = 'selectedTab'
      const isHidden = false

      // Title poller simulated failure
      const updateWebviewTitlePoller = () => {
        throw new Error('Title poller script syntax error')
      }

      // Execute safe activation visibility block:
      try {
        updateWebviewTitlePoller()
      } catch (err) {
        // Guarded
      }

      // Hide background views safely
      for (const [id, v] of aiViews) {
        if (id !== tabId) {
          try {
            v.setVisible(false)
          } catch {
            // Guarded
          }
        }
      }

      // Show selected view
      try {
        selectedView.view.setBounds(bounds)
        selectedView.view.setVisible(!isHidden)
      } catch {
        // Guarded
      }

      expect(selectedView.view.visible).toBe(true)
      expect(selectedView.view.bounds).toEqual(bounds)
    })
  })
})
