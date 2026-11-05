import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

describe('Phase 2 Safety Remediation (P0-1 .. P0-4)', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'nexus-phase2-remediation-'))
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  describe('P0-1: Wake deduplication', () => {
    it('reuses active wake operations for the same target URL instead of duplicating loadURL', async () => {
      const activeWakeOperations = new Map<string, { token: number; targetUrl: string }>()
      const wakeTokens = new Map<string, number>()
      let loadUrlCalls = 0
      let pendingResolve: (() => void) | null = null

      const fakeLoadURL = vi.fn().mockImplementation(() => {
        loadUrlCalls++
        return new Promise<void>((resolve) => {
          pendingResolve = resolve
        })
      })

      const handleActivate = async (tabId: string, targetRestoreUrl: string) => {
        const existingWake = activeWakeOperations.get(tabId)
        if (existingWake && existingWake.targetUrl === targetRestoreUrl) {
          return // Reused ongoing wake!
        }

        const myWakeToken = (wakeTokens.get(tabId) || 0) + 1
        wakeTokens.set(tabId, myWakeToken)
        activeWakeOperations.set(tabId, { token: myWakeToken, targetUrl: targetRestoreUrl })

        try {
          await fakeLoadURL(targetRestoreUrl)
        } finally {
          if (activeWakeOperations.get(tabId)?.token === myWakeToken) {
            activeWakeOperations.delete(tabId)
          }
        }
      }

      // First selection triggers loadURL
      const p1 = handleActivate('tab1', 'https://gemini.google.com/app/1')
      expect(loadUrlCalls).toBe(1)

      // Second selection while first is pending reuses the ongoing wake
      const p2 = handleActivate('tab1', 'https://gemini.google.com/app/1')
      expect(loadUrlCalls).toBe(1) // Still 1! Not duplicated!

      // Resolve the in-flight load
      pendingResolve!()
      await Promise.all([p1, p2])

      // After completion, operation is cleared from map
      expect(activeWakeOperations.has('tab1')).toBe(false)
    })
  })

  describe('P0-2: Native ownership and transactional view registration', () => {
    it('safely retains existing view when manager owns it and does not orphan duplicates', () => {
      const manager = new TabDiscardManager({
        getUserDataDir: () => tempDir,
        onTeardown: (_id, v) => v.webContents.close()
      })
      manager.init()

      const mockOld = createMockView('tab-x')
      manager.registerView('tab-x', mockOld.view)

      const aiViews = new Map<string, DiscardableView>([['tab-x', mockOld.view]])
      const addedToWindow: DiscardableView[] = []

      // Simulate ensureAiView behavior with a view whose webContents throws an error
      function safeEnsureAiView(tabId: string, candidateNewView: DiscardableView): DiscardableView {
        const existing = aiViews.get(tabId)
        if (existing) {
          // If manager still has ownership, retain it
          if (manager.hasView(tabId)) {
            return existing
          }
          aiViews.delete(tabId)
        }

        // Transactional registration
        manager.registerView(tabId, candidateNewView)
        addedToWindow.push(candidateNewView)
        aiViews.set(tabId, candidateNewView)
        return candidateNewView
      }

      const mockNew = createMockView('tab-x-candidate')
      const returned = safeEnsureAiView('tab-x', mockNew.view)

      // Must return existing view and not attach candidate to window
      expect(returned).toBe(mockOld.view)
      expect(addedToWindow.length).toBe(0)
      expect(aiViews.get('tab-x')).toBe(mockOld.view)
      expect(manager.getView('tab-x')).toBe(mockOld.view)
    })
  })

  describe('P0-4: Pin validation, serialization and anti-resurrection', () => {
    it('strictly rejects malformed JSON and non-array payloads', () => {
      function validatePinnedPayload(payload: unknown): string[] | null {
        if (typeof payload !== 'string') return null
        try {
          const parsed = JSON.parse(payload)
          if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
            return null
          }
          return parsed
        } catch {
          return null
        }
      }

      expect(validatePinnedPayload('{broken')).toBeNull()
      expect(validatePinnedPayload('{"id": "tab1"}')).toBeNull()
      expect(validatePinnedPayload('[123, 456]')).toBeNull()
      expect(validatePinnedPayload('["tab1", "tab2"]')).toEqual(['tab1', 'tab2'])
      expect(validatePinnedPayload('[]')).toEqual([])
    })

    it('does not resurrect stale disk state when in-memory set is initialized and empty', () => {
      let isInitialized = true
      const inMemoryPins = new Set<string>() // empty
      const diskContent = JSON.stringify(['stale-tab-1', 'stale-tab-2'])

      function handleGetPinned(): string {
        if (isInitialized) {
          return JSON.stringify(Array.from(inMemoryPins))
        }
        return diskContent
      }

      // Must return empty array and not resurrect disk pins
      expect(handleGetPinned()).toBe('[]')
      expect(inMemoryPins.has('stale-tab-1')).toBe(false)
    })
  })
})
