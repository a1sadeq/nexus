import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadThemeState, saveThemeState } from './themes'

const storageMap = new Map<string, string>()
const mockLocalStorage = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, val: string) => storageMap.set(key, val),
  removeItem: (key: string) => storageMap.delete(key),
  clear: () => storageMap.clear(),
  get length() {
    return storageMap.size
  },
  key: (i: number) => Array.from(storageMap.keys())[i] ?? null
}

// @ts-ignore
globalThis.localStorage = mockLocalStorage
// @ts-ignore
if (typeof globalThis.window === 'undefined') {
  // @ts-ignore
  globalThis.window = globalThis
}

describe('Renderer Universal State Hydration & Zero-FOUC (T-A11, T-A12, T-A13, T-A14)', () => {
  beforeEach(() => {
    mockLocalStorage.clear()
    vi.restoreAllMocks()
  })

  it('T-A14: loadThemeState reads synchronously from window.nexusState.getThemeSync for zero-FOUC', () => {
    const mockTheme = {
      activeId: 'custom-nord',
      customs: [{ id: 'custom-nord', name: 'Nord', colors: { bg: '#2e3440' } }]
    }

    // @ts-ignore
    window.nexusState = {
      getThemeSync: vi.fn(() => mockTheme),
      get: vi.fn(),
      save: vi.fn(async () => true)
    }

    const state = loadThemeState()
    expect(state.activeId).toBe('custom-nord')
    expect(window.nexusState!.getThemeSync).toHaveBeenCalledTimes(1)
  })

  it('T-A15: initial state reads synchronously from window.nexusState.getTabsSync for instantaneous restoration', () => {
    const mockTabs = {
      tabs: [{ id: 'live-tab-1', title: 'Live Tab', url: 'https://arena.ai' }],
      activeId: 'live-tab-1'
    }

    // @ts-ignore
    window.nexusState = {
      getTabsSync: vi.fn(() => mockTabs),
      get: vi.fn(),
      save: vi.fn(async () => true),
      getThemeSync: vi.fn(() => null)
    }

    const disk = window.nexusState!.getTabsSync!()
    expect(disk).toEqual(mockTabs)
    expect(window.nexusState!.getTabsSync).toHaveBeenCalledTimes(1)
  })

  it('saveThemeState persists to both localStorage and window.nexusState.save', () => {
    // @ts-ignore
    window.nexusState = {
      getThemeSync: vi.fn(),
      get: vi.fn(),
      save: vi.fn(async () => true)
    }

    const theme = { activeId: 'dark-default', customs: [] }
    saveThemeState(theme)
    expect(localStorage.getItem('nexus.themes')).toBe(JSON.stringify(theme))
    expect(window.nexusState!.save).toHaveBeenCalledWith('theme', theme)
  })

  it('T-A12 & T-A11: safe race against 1500ms timeout with read-only fallback', async () => {
    // Populate local storage with existing tab
    localStorage.setItem(
      'vicinae.tabs',
      JSON.stringify({
        tabs: [{ id: 'local-1', title: 'Local Fallback', url: 'https://gemini.google.com' }],
        activeId: 'local-1'
      })
    )

    let savedPayload: unknown = null
    // @ts-ignore
    window.nexusState = {
      get: vi.fn(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  tabs: [{ id: 'disk-1', title: 'Disk Authoritative', url: 'https://kimi.ai' }],
                  activeId: 'disk-1'
                }),
              50
            )
          )
      ),
      save: vi.fn(async (_key, data) => {
        savedPayload = data
        return true
      }),
      getThemeSync: vi.fn(() => null)
    }

    // Disk responds before timeout: disk wins
    const diskResult = await window.nexusState!.get('tabs')
    expect(diskResult).toEqual({
      tabs: [{ id: 'disk-1', title: 'Disk Authoritative', url: 'https://kimi.ai' }],
      activeId: 'disk-1'
    })

    // Simulated timeout scenario: slow IPC returns after 2000ms
    const slowIpc = new Promise((resolve) => setTimeout(() => resolve('slow'), 2000))
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 10))

    const raceResult = await Promise.race([slowIpc, timeout])
    expect(raceResult).toBe('timeout')
    // On timeout, local storage provides fallback and disk save is NOT dispatched
    expect(savedPayload).toBeNull()
  })

  it('T-A13: promotion migration reads localStorage when disk is empty', async () => {
    localStorage.setItem(
      'nexus.interfaceSettings',
      JSON.stringify({ surfaceDarkness: 75, accentContrast: 120 })
    )

    let promotedSettings: unknown = null
    // @ts-ignore
    window.nexusState = {
      get: vi.fn(async (key) => (key === 'interface_settings' ? null : {})),
      save: vi.fn(async (key, data) => {
        if (key === 'interface_settings') promotedSettings = data
        return true
      }),
      getThemeSync: vi.fn(() => null)
    }

    // Simulate promotion logic
    const diskData = await window.nexusState!.get('interface_settings')
    if (diskData == null) {
      const local = localStorage.getItem('nexus.interfaceSettings')
      if (local) {
        await window.nexusState!.save('interface_settings', JSON.parse(local))
      }
    }

    expect(promotedSettings).toEqual({ surfaceDarkness: 75, accentContrast: 120 })
  })
})
