import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers = new Map<string, (event: any, ...args: any[]) => any>()
const listeners = new Map<string, (event: any, ...args: any[]) => any>()

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/nexus-writebarrier-test'),
    on: vi.fn()
  },
  ipcMain: {
    handle: vi.fn((channel: string, fn: any) => {
      handlers.set(channel, fn)
    }),
    on: vi.fn((channel: string, fn: any) => {
      listeners.set(channel, fn)
    })
  },
  BrowserWindow: vi.fn()
}))

vi.mock('./atomicWrite', () => ({
  STATE_FILES: {
    tabs: 'tabs.json',
    pinned: 'pinned.json',
    theme: 'theme.json',
    models: 'models.json',
    providers: 'providers.json',
    interface_settings: 'interface-settings.json'
  },
  readJson: vi.fn(() => ({ tabs: [{ id: 't1', url: 'https://example.com' }] })),
  scheduleWrite: vi.fn()
}))

describe('Session Write Barrier & IPC Security (T-A7, T-A8, T-A15)', () => {
  let registerStateIpc: any
  let trustWindow: any
  let trustedSenders: Set<number>
  let hydratedSessions: Set<string>
  let validatePayload: any

  beforeEach(async () => {
    handlers.clear()
    listeners.clear()
    const stateIpc = await import('./stateIpc')
    registerStateIpc = stateIpc.registerStateIpc
    trustWindow = stateIpc.trustWindow
    trustedSenders = stateIpc.trustedSenders
    hydratedSessions = stateIpc.hydratedSessions
    validatePayload = stateIpc.validatePayload

    trustedSenders.clear()
    hydratedSessions.clear()
    registerStateIpc()
  })

  it('T-A8: rejects untrusted sender ID on get_tabs and save_tabs', async () => {
    const untrustedEvent = { sender: { id: 999 } }
    const getTabsHandler = handlers.get('get_tabs')!
    const saveTabsHandler = handlers.get('save_tabs')!

    expect(() => getTabsHandler(untrustedEvent)).toThrow(/Untrusted sender/)
    expect(() =>
      saveTabsHandler(untrustedEvent, { tabs: [{ id: '1', url: 'https://test.com' }] })
    ).toThrow(/Untrusted sender/)
  })

  it('T-A7: rejects save_tabs before get_tabs from same session; accepts after get_tabs', async () => {
    const mockWindow = { webContents: { id: 42 }, on: vi.fn() } as any
    trustWindow(mockWindow)

    const trustedEvent = { sender: { id: 42 } }
    const getTabsHandler = handlers.get('get_tabs')!
    const saveTabsHandler = handlers.get('save_tabs')!

    const validPayload = { tabs: [{ id: 'tab-1', url: 'https://gemini.google.com' }] }

    // Before get_tabs: Barrier rejects
    expect(() => saveTabsHandler(trustedEvent, validPayload)).toThrow(/Write Barrier/)

    // Hydration read occurs
    const readResult = getTabsHandler(trustedEvent)
    expect(readResult).toBeDefined()

    // After get_tabs: Barrier allows save
    expect(saveTabsHandler(trustedEvent, validPayload)).toBe(true)
  })

  it('T-A15: enforces tab cap (max 64) and blocks unsafe url schemes', () => {
    // javascript: URL rejected
    expect(() =>
      validatePayload('tabs', {
        tabs: [{ id: '1', url: 'javascript:alert(1)' }]
      })
    ).toThrow(/Blocked unsafe tab URL/)

    // Exceeding 64 tabs rejected
    const tooManyTabs = Array.from({ length: 65 }, (_, i) => ({
      id: `tab-${i}`,
      url: `https://test.com/${i}`
    }))
    expect(() => validatePayload('tabs', { tabs: tooManyTabs })).toThrow(
      /Exceeded maximum tab cap/
    )

    // Valid tabs pass
    const valid = validatePayload('tabs', {
      tabs: [{ id: 'tab-1', url: 'https://gemini.google.com' }]
    })
    expect(valid).toBeDefined()
  })
})
