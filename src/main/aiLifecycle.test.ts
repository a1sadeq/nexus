import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isProtectedLifecycleStatus,
  mapLifecycleToBadge,
  isGenuineCompletionTransition,
  isNotifiableCompletion,
  shouldDeduplicateCompletion,
  formatDesktopNotificationContent,
  ACTIVE_TAB_DONE_LINGER_MS,
  VISITED_DONE_LINGER_MS
} from '../shared/aiLifecycle'
import { AiLifecycleManager } from './aiLifecycleManager'
import { AiToastManager, type ToastViewTarget } from './aiToastManager'

describe('aiLifecycle production modules', () => {
  it('defines the correct linger constants', () => {
    expect(ACTIVE_TAB_DONE_LINGER_MS).toBe(6000)
    expect(VISITED_DONE_LINGER_MS).toBe(4000)
  })

  it('correctly classifies protected vs idle lifecycle statuses using production isProtectedLifecycleStatus', () => {
    // Only 'idle' is eligible for discard
    expect(isProtectedLifecycleStatus('idle')).toBe(false)

    // All other statuses MUST be protected
    expect(isProtectedLifecycleStatus('unknown')).toBe(true)
    expect(isProtectedLifecycleStatus('working')).toBe(true)
    expect(isProtectedLifecycleStatus('waiting-input')).toBe(true)
    expect(isProtectedLifecycleStatus('done')).toBe(true)
    expect(isProtectedLifecycleStatus('error')).toBe(true)

    // Undefined / null must fail safe as protected
    expect(isProtectedLifecycleStatus(undefined)).toBe(true)
    expect(isProtectedLifecycleStatus(null)).toBe(true)
  })

  it('maps lifecycle statuses to UI badges accurately using production mapLifecycleToBadge', () => {
    expect(mapLifecycleToBadge('working')).toEqual({
      badge: 'working',
      label: 'Working'
    })
    expect(mapLifecycleToBadge('waiting-input')).toEqual({
      badge: 'waiting-input',
      label: 'Waiting for input'
    })
    expect(mapLifecycleToBadge('done')).toEqual({
      badge: 'done',
      label: 'Done'
    })
    expect(mapLifecycleToBadge('error')).toEqual({
      badge: 'error',
      label: 'Error'
    })

    // idle and unknown map to no badge (idle)
    expect(mapLifecycleToBadge('idle')).toEqual({
      badge: null,
      label: 'Idle'
    })
    expect(mapLifecycleToBadge('unknown')).toEqual({
      badge: null,
      label: 'Idle'
    })
    expect(mapLifecycleToBadge(undefined)).toEqual({
      badge: null,
      label: 'Idle'
    })
  })

  describe('Finding 2: Production genuine completion transitions and notification deduplication', () => {
    it('identifies genuine completions only from working -> done or working -> waiting-input via isGenuineCompletionTransition', () => {
      // Initial / setup / non-completion transitions: NOT genuine completions
      expect(isGenuineCompletionTransition('unknown', 'idle')).toBe(false)
      expect(isGenuineCompletionTransition('unknown', 'unknown')).toBe(false)
      expect(isGenuineCompletionTransition('idle', 'error')).toBe(false)
      expect(isGenuineCompletionTransition('idle', 'idle')).toBe(false)
      expect(isGenuineCompletionTransition('done', 'idle')).toBe(false) // timer expiration is not a new completion
      expect(isGenuineCompletionTransition('error', 'idle')).toBe(false)

      // Genuine completions:
      expect(isGenuineCompletionTransition('working', 'done')).toBe(true)
      expect(isGenuineCompletionTransition('working', 'waiting-input')).toBe(true)
    })

    it('deduplicates completion notifications via production shouldDeduplicateCompletion', () => {
      // First completion: no prior record -> not a duplicate
      expect(shouldDeduplicateCompletion(undefined, 'done', 1, 1000)).toBe(false)

      const prev = { status: 'done', revision: 1, time: 1000 }

      // Immediate duplicate (same revision) -> duplicate!
      expect(shouldDeduplicateCompletion(prev, 'done', 1, 1050)).toBe(true)

      // Next revision within 2000ms for same status -> duplicate!
      expect(shouldDeduplicateCompletion(prev, 'done', 2, 1500)).toBe(true)

      // Different status within 2000ms -> NOT a duplicate
      expect(shouldDeduplicateCompletion(prev, 'waiting-input', 2, 1500)).toBe(false)

      // Same status after 2000ms window has passed -> NOT a duplicate
      expect(shouldDeduplicateCompletion(prev, 'done', 2, 3100)).toBe(false)
    })
  })

  describe('Finding 5: Privacy defaults for system desktop notifications', () => {
    it('formats desktop notifications without private chat titles or prompt snippets using production formatDesktopNotificationContent', () => {
      const notif1 = formatDesktopNotificationContent({
        tabTitle: 'Confidential patient record query for Jane Doe',
        status: 'waiting-input',
        snippet: 'Please verify medical record ID 4920'
      })

      expect(notif1.title).toBe('Nexus')
      expect(notif1.body).toBe('An AI session requires your input')
      expect(notif1.body).not.toContain('Jane Doe')
      expect(notif1.body).not.toContain('medical')

      const notif2 = formatDesktopNotificationContent({
        tabTitle: 'Q4 Financial forecast analysis',
        status: 'done',
        snippet: 'The projected EBITDA margin is 24%'
      })

      expect(notif2.title).toBe('Nexus')
      expect(notif2.body).toBe('An AI task has completed')
      expect(notif2.body).not.toContain('Financial')
      expect(notif2.body).not.toContain('EBITDA')
    })
  })

  describe('Finding 3: Production AiToastManager exit timer and replacement during exit animation', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    function createMockViewTarget(): ToastViewTarget & {
      visible: boolean
      bounds: { x: number; y: number; width: number; height: number }
      exitAnimated: boolean
      loadedHtml: string | null
    } {
      return {
        visible: false,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        exitAnimated: false,
        loadedHtml: null,
        isDestroyed: () => false,
        setVisible(v: boolean) {
          this.visible = v
        },
        setBounds(b) {
          this.bounds = b
        },
        startExitAnimation() {
          this.exitAnimated = true
        },
        loadHtml(html: string) {
          this.loadedHtml = html
        }
      }
    }

    it('shows toast, auto-dismisses after timeout, and handles immediate dismissal', () => {
      const mockView = createMockViewTarget()
      const toastManager = new AiToastManager(
        () => mockView,
        () => ({ x: 800, y: 44, width: 380, height: 125 }),
        (data) => `<div>${data.model}</div>`,
        6800,
        200
      )

      toastManager.show({
        id: 'toast-1',
        tabId: 'tab-1',
        tabTitle: 'Session 1',
        model: 'gemini',
        status: 'done'
      })

      expect(toastManager.getIsVisible()).toBe(true)
      expect(mockView.visible).toBe(true)
      expect(mockView.bounds.width).toBe(380)

      // Advance to 6800ms -> triggers exit animation
      vi.advanceTimersByTime(6800)
      expect(mockView.exitAnimated).toBe(true)
      expect(toastManager.isExitTimerActive()).toBe(true)

      // Advance remaining 200ms of exit animation -> completely hides
      vi.advanceTimersByTime(200)
      expect(toastManager.getIsVisible()).toBe(false)
      expect(mockView.visible).toBe(false)
    })

    it('regression: replacement during exit animation cancels old exit timer and prevents hiding newer toast', () => {
      const mockView = createMockViewTarget()
      const toastManager = new AiToastManager(
        () => mockView,
        () => ({ x: 800, y: 44, width: 380, height: 125 }),
        (data) => `<div>${data.id}</div>`,
        6800,
        200
      )

      // 1. Toast 1 is shown
      toastManager.show({
        id: 'toast-1',
        tabId: 'tab-1',
        tabTitle: 'Session 1',
        model: 'gemini',
        status: 'done'
      })
      expect(toastManager.getCurrentEpoch()).toBe(1)
      expect(toastManager.getIsVisible()).toBe(true)

      // 2. Toast 1 auto-dismisses at 6800ms, entering 200ms exit animation
      vi.advanceTimersByTime(6800)
      expect(mockView.exitAnimated).toBe(true)
      expect(toastManager.isExitTimerActive()).toBe(true)

      // 3. Exactly 100ms into the 200ms exit animation, Toast 2 arrives!
      vi.advanceTimersByTime(100)
      toastManager.show({
        id: 'toast-2',
        tabId: 'tab-2',
        tabTitle: 'Session 2',
        model: 'arena',
        status: 'waiting-input'
      })

      // Toast 2 is now active, epoch bumped to 2, exit timer cancelled
      expect(toastManager.getCurrentEpoch()).toBe(2)
      expect(toastManager.getIsVisible()).toBe(true)
      expect(toastManager.getCurrentData()?.id).toBe('toast-2')
      expect(mockView.visible).toBe(true)

      // 4. Advance 150ms further (past when Toast 1's 200ms exit timer would have fired at 100ms)
      vi.advanceTimersByTime(150)

      // CRITICAL VERIFICATION: Toast 2 MUST STILL BE VISIBLE! The orphan timer from Toast 1 was cancelled!
      expect(toastManager.getIsVisible()).toBe(true)
      expect(mockView.visible).toBe(true)
      expect(toastManager.getCurrentData()?.id).toBe('toast-2')

      // 5. Toast 2 finishes its own 6800ms lifecycle and exits properly
      vi.advanceTimersByTime(6800 - 150) // reaches 6800ms for toast 2
      expect(toastManager.isExitTimerActive()).toBe(true)
      vi.advanceTimersByTime(200)
      expect(toastManager.getIsVisible()).toBe(false)
      expect(mockView.visible).toBe(false)
    })
  })

  describe('Finding 4: Production AiLifecycleManager wiring and navigation revision checks', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('rejects stale observer updates when view generation has advanced', () => {
      const dispatchedEvents: any[] = []
      const notifications: any[] = []
      let activeTabId: string | null = 'tab-1'

      const manager = new AiLifecycleManager({
        sendToMainWindow: (channel, payload) => dispatchedEvents.push({ channel, payload }),
        showInAppToast: (data) => notifications.push(data),
        getActiveViewId: () => activeTabId
      })

      // Generation 1: tab becomes working
      expect(manager.getTabViewGeneration('tab-1')).toBe(1)
      const ok1 = manager.setTabAiLifecycle('tab-1', 'working', { viewGeneration: 1 })
      expect(ok1).toBe(true)
      expect(manager.getTabAiStatus('tab-1')).toBe('working')

      // User navigates / view replaced: generation bumped to 2
      const gen2 = manager.bumpTabViewGeneration('tab-1')
      expect(gen2).toBe(2)
      manager.setTabAiLifecycle('tab-1', 'unknown', { viewGeneration: gen2, skipTimer: true })
      expect(manager.getTabAiStatus('tab-1')).toBe('unknown')

      // Stale observer event from Generation 1 arrives -> MUST BE REJECTED!
      const okStale = manager.setTabAiLifecycle('tab-1', 'done', { viewGeneration: 1 })
      expect(okStale).toBe(false)
      expect(manager.getTabAiStatus('tab-1')).toBe('unknown') // Status remains unknown!

      // Legitimate observer event from Generation 2 arrives -> ACCEPTED!
      const okGen2 = manager.setTabAiLifecycle('tab-1', 'working', { viewGeneration: 2 })
      expect(okGen2).toBe(true)
      expect(manager.getTabAiStatus('tab-1')).toBe('working')
    })

    it('cancels stale linger timer from previous view generation when navigation occurs', () => {
      let activeTabId: string | null = 'tab-1'
      const manager = new AiLifecycleManager({
        sendToMainWindow: () => {},
        getActiveViewId: () => activeTabId
      })

      // Tab 1 finishes under Generation 1 while active -> starts 6s linger timer
      manager.setTabAiLifecycle('tab-1', 'working', { viewGeneration: 1 })
      manager.setTabAiLifecycle('tab-1', 'done', { viewGeneration: 1 })
      expect(manager.getTabAiStatus('tab-1')).toBe('done')

      // 2 seconds later, user navigates -> generation bumped to 2 and status reset to unknown
      vi.advanceTimersByTime(2000)
      const nextGen = manager.bumpTabViewGeneration('tab-1')
      expect(nextGen).toBe(2)
      manager.setTabAiLifecycle('tab-1', 'working', { viewGeneration: 2 })
      expect(manager.getTabAiStatus('tab-1')).toBe('working')

      // 5 more seconds pass (reaching 7s total, where Generation 1 timer would have fired at 6s)
      vi.advanceTimersByTime(5000)

      // Generation 2 view MUST NOT have been demoted to idle by generation 1 linger timer!
      expect(manager.getTabAiStatus('tab-1')).toBe('working')
      expect(manager.getTabAiLifecycle('tab-1')?.viewGeneration).toBe(2)
    })

    it('triggers notifications only for genuine completions, not for initial unknown -> idle', () => {
      const notifications: any[] = []
      const manager = new AiLifecycleManager({
        sendToMainWindow: () => {},
        showInAppToast: (data) => notifications.push(data),
        getActiveViewId: () => 'other-tab' // background tab so notifications fire
      })

      // Initial tab load: unknown -> idle
      manager.setTabAiLifecycle('tab-1', 'unknown', { viewGeneration: 1 })
      manager.setTabAiLifecycle('tab-1', 'idle', { viewGeneration: 1 })
      expect(notifications).toHaveLength(0) // NO NOTIFICATION for initial idle!

      // Working starts -> no notification
      manager.setTabAiLifecycle('tab-1', 'working', { viewGeneration: 1 })
      expect(notifications).toHaveLength(0)

      // Working -> done: genuine completion!
      manager.setTabAiLifecycle('tab-1', 'done', { viewGeneration: 1, lastSnippet: 'Done with task' })
      expect(notifications).toHaveLength(1)
      expect(notifications[0].status).toBe('done')
      expect(notifications[0].snippet).toBe('Done with task')
    })
  })
})


describe('Notification reliability: completions that were never announced', () => {
  it('announces a completion even when "working" was never observed', () => {
    // A fast turn, or one that started before the app could observe it, arrives as
    // unknown -> done. Previously silent; that was the reported "notifications do not work".
    expect(isNotifiableCompletion('unknown', 'done')).toBe(true)
    expect(isNotifiableCompletion('unknown', 'waiting-input')).toBe(true)
  })

  it('still announces the ordinary transition', () => {
    expect(isNotifiableCompletion('working', 'done')).toBe(true)
    expect(isNotifiableCompletion('working', 'waiting-input')).toBe(true)
  })

  it('announces a recovery after an error', () => {
    expect(isNotifiableCompletion('error', 'done')).toBe(true)
  })

  it('does not announce non-completions', () => {
    expect(isNotifiableCompletion('working', 'working')).toBe(false)
    expect(isNotifiableCompletion('done', 'done')).toBe(false)
    expect(isNotifiableCompletion('working', 'idle')).toBe(false)
    expect(isNotifiableCompletion('unknown', 'working')).toBe(false)
  })

  it('does not treat leaving idle as a completion, because that is a restore', () => {
    expect(isNotifiableCompletion('idle', 'done')).toBe(false)
  })
})
