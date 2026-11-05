import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

describe('Nexus Shell Inspector Shortcut (Ctrl+Alt+Shift+I)', () => {
  const mainSrc = readFileSync(join(__dirname, 'index.ts'), 'utf8')
  const start = mainSrc.indexOf('const DEFAULT_ACTION_KEYS')
  const end = mainSrc.indexOf('\nfunction createWindow()', start)
  const routerCode = mainSrc.slice(start, end)
  const compiled = ts.transpileModule(routerCode, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText

  let ctx: any
  let ipcHandlers: Record<string, Function>
  let mockShellWebContents: {
    isDestroyed: ReturnType<typeof vi.fn>
    openDevTools: ReturnType<typeof vi.fn>
  }
  let mockMainWindow: {
    isDestroyed: ReturnType<typeof vi.fn>
    webContents: typeof mockShellWebContents
  }
  let mockViewWebContents: {
    isDestroyed: ReturnType<typeof vi.fn>
    openDevTools: ReturnType<typeof vi.fn>
  }
  let mockView: {
    webContents: typeof mockViewWebContents
  }

  beforeEach(() => {
    mockShellWebContents = {
      isDestroyed: vi.fn(() => false),
      openDevTools: vi.fn()
    }
    mockMainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: mockShellWebContents
    }
    mockViewWebContents = {
      isDestroyed: vi.fn(() => false),
      openDevTools: vi.fn()
    }
    mockView = {
      webContents: mockViewWebContents
    }

    ipcHandlers = {}
    ctx = {
      exports: {},
      ipcMain: {
        on: vi.fn((ch, fn) => {
          ipcHandlers[ch] = fn
        })
      },
      mainWindow: mockMainWindow,
      activeViewId: 'tab-1',
      activeViewVisible: true,
      aiViews: new Map([['tab-1', mockView]]),
      viewModelKeys: new Map([['tab-1', 'gemini']]),
      sendToMainWindow: vi.fn(),
      restartActiveArenaTitleSync: vi.fn(),
      console: console
    }

    vm.runInNewContext(compiled, ctx)
  })

  it('routes Ctrl+Alt+Shift+I from window source to open detached shell DevTools', () => {
    const event = { preventDefault: vi.fn() }
    const input = {
      type: 'keyDown',
      control: true,
      meta: false,
      alt: true,
      shift: true,
      key: 'I',
      code: 'KeyI'
    }

    const handled = ctx.routeGlobalShortcut(event, input, 'window')

    expect(handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(mockShellWebContents.openDevTools).toHaveBeenCalledWith({ mode: 'detach' })
    expect(mockViewWebContents.openDevTools).not.toHaveBeenCalled()
  })

  it('routes Ctrl+Alt+Shift+I from view source to shell DevTools without touching active AI view', () => {
    const event = { preventDefault: vi.fn() }
    const input = {
      type: 'keyDown',
      control: true,
      meta: false,
      alt: true,
      shift: true,
      key: 'i',
      code: 'KeyI'
    }

    const handled = ctx.routeGlobalShortcut(event, input, 'view')

    expect(handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(mockShellWebContents.openDevTools).toHaveBeenCalledWith({ mode: 'detach' })
    expect(mockViewWebContents.openDevTools).not.toHaveBeenCalled()
  })

  it('preserves existing Ctrl+Shift+D and Ctrl+Shift+I routing to active provider AI view', () => {
    // 1. Ctrl+Shift+D
    const eventD = { preventDefault: vi.fn() }
    const inputD = {
      type: 'keyDown',
      control: true,
      meta: false,
      alt: false,
      shift: true,
      key: 'D',
      code: 'KeyD'
    }

    const handledD = ctx.routeGlobalShortcut(eventD, inputD, 'view')
    expect(handledD).toBe(true)
    expect(mockViewWebContents.openDevTools).toHaveBeenCalledWith({ mode: 'detach' })
    expect(mockShellWebContents.openDevTools).not.toHaveBeenCalled()

    vi.clearAllMocks()

    // 2. Ctrl+Shift+I (without Alt)
    const eventI = { preventDefault: vi.fn() }
    const inputI = {
      type: 'keyDown',
      control: true,
      meta: false,
      alt: false,
      shift: true,
      key: 'I',
      code: 'KeyI'
    }

    const handledI = ctx.routeGlobalShortcut(eventI, inputI, 'window')
    expect(handledI).toBe(true)
    expect(mockViewWebContents.openDevTools).toHaveBeenCalledWith({ mode: 'detach' })
    expect(mockShellWebContents.openDevTools).not.toHaveBeenCalled()
  })

  it('respects overlay keyboard ownership and suppresses shell inspector when overlaysOpen is true', () => {
    ipcHandlers['set_overlays_open']?.({}, true)

    const event = { preventDefault: vi.fn() }
    const input = {
      type: 'keyDown',
      control: true,
      meta: false,
      alt: true,
      shift: true,
      key: 'I',
      code: 'KeyI'
    }

    const handled = ctx.routeGlobalShortcut(event, input, 'window')

    expect(handled).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(mockShellWebContents.openDevTools).not.toHaveBeenCalled()
  })

  it('ignores keyUp events and non-matching modifier combinations', () => {
    const event = { preventDefault: vi.fn() }

    // keyUp should not trigger
    const inputKeyUp = {
      type: 'keyUp',
      control: true,
      meta: false,
      alt: true,
      shift: true,
      key: 'I',
      code: 'KeyI'
    }
    expect(ctx.routeGlobalShortcut(event, inputKeyUp, 'window')).toBe(false)

    // Ctrl+Alt+I without Shift should not trigger
    const inputNoShift = {
      type: 'keyDown',
      control: true,
      meta: false,
      alt: true,
      shift: false,
      key: 'I',
      code: 'KeyI'
    }
    expect(ctx.routeGlobalShortcut(event, inputNoShift, 'window')).toBe(false)
    expect(mockShellWebContents.openDevTools).not.toHaveBeenCalled()
  })

  it('honors customized keymap for shell-inspector', () => {
    // Custom keymap set via IPC handler
    ipcHandlers['set_shortcut_map']?.({}, {
      'shell-inspector': ['Ctrl', 'Shift', 'F12']
    })

    const event = { preventDefault: vi.fn() }
    const inputCustom = {
      type: 'keyDown',
      control: true,
      meta: false,
      alt: false,
      shift: true,
      key: 'F12',
      code: 'F12'
    }

    const handled = ctx.routeGlobalShortcut(event, inputCustom, 'window')

    expect(handled).toBe(true)
    expect(mockShellWebContents.openDevTools).toHaveBeenCalledWith({ mode: 'detach' })
  })
})
