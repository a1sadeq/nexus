import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

describe('Window Controls IPC & Security Validation', () => {
  const mainSrc = readFileSync(join(__dirname, 'index.ts'), 'utf8')
  const start = mainSrc.indexOf('function isValidMainWindowSender')
  const end = mainSrc.indexOf("ipcMain.on('claim_window_focus'", start)
  const codeSlice = mainSrc.slice(start, end)
  const compiled = ts.transpileModule(codeSlice, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText

  let ctx: any
  let ipcListeners: Record<string, Function>
  let ipcHandleListeners: Record<string, Function>
  let mockMainWindow: {
    isDestroyed: ReturnType<typeof vi.fn>
    isMaximized: ReturnType<typeof vi.fn>
    minimize: ReturnType<typeof vi.fn>
    maximize: ReturnType<typeof vi.fn>
    unmaximize: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    webContents: {
      id: number
      isDestroyed: ReturnType<typeof vi.fn>
    }
  }

  beforeEach(() => {
    mockMainWindow = {
      isDestroyed: vi.fn(() => false),
      isMaximized: vi.fn(() => false),
      minimize: vi.fn(),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      close: vi.fn(),
      webContents: {
        id: 1,
        isDestroyed: vi.fn(() => false)
      }
    }

    ipcListeners = {}
    ipcHandleListeners = {}

    ctx = {
      exports: {},
      mainWindow: mockMainWindow,
      ipcMain: {
        on: vi.fn((ch, fn) => {
          ipcListeners[ch] = fn
        }),
        handle: vi.fn((ch, fn) => {
          ipcHandleListeners[ch] = fn
        })
      }
    }

    vm.runInNewContext(compiled, ctx)
  })

  it('registers window_minimize, window_maximize_toggle, window_close, and window_is_maximized', () => {
    expect(ipcListeners['window_minimize']).toBeTypeOf('function')
    expect(ipcListeners['window_maximize_toggle']).toBeTypeOf('function')
    expect(ipcListeners['window_close']).toBeTypeOf('function')
    expect(ipcHandleListeners['window_is_maximized']).toBeTypeOf('function')
  })

  it('rejects window_minimize from an unauthorized sender', () => {
    const fakeEvent = { sender: { id: 999 } }
    ipcListeners['window_minimize'](fakeEvent)
    expect(mockMainWindow.minimize).not.toHaveBeenCalled()
  })

  it('executes window_minimize when sender matches mainWindow.webContents', () => {
    const validEvent = { sender: mockMainWindow.webContents }
    ipcListeners['window_minimize'](validEvent)
    expect(mockMainWindow.minimize).toHaveBeenCalledTimes(1)
  })

  it('toggles maximize to unmaximize when currently maximized', () => {
    mockMainWindow.isMaximized.mockReturnValue(true)
    const validEvent = { sender: mockMainWindow.webContents }
    ipcListeners['window_maximize_toggle'](validEvent)
    expect(mockMainWindow.unmaximize).toHaveBeenCalledTimes(1)
    expect(mockMainWindow.maximize).not.toHaveBeenCalled()
  })

  it('toggles unmaximize to maximize when currently not maximized', () => {
    mockMainWindow.isMaximized.mockReturnValue(false)
    const validEvent = { sender: mockMainWindow.webContents }
    ipcListeners['window_maximize_toggle'](validEvent)
    expect(mockMainWindow.maximize).toHaveBeenCalledTimes(1)
    expect(mockMainWindow.unmaximize).not.toHaveBeenCalled()
  })

  it('executes window_close when valid sender requests close', () => {
    const validEvent = { sender: mockMainWindow.webContents }
    ipcListeners['window_close'](validEvent)
    expect(mockMainWindow.close).toHaveBeenCalledTimes(1)
  })

  it('handles window_is_maximized correctly and rejects invalid sender', () => {
    mockMainWindow.isMaximized.mockReturnValue(true)
    const validEvent = { sender: mockMainWindow.webContents }
    expect(ipcHandleListeners['window_is_maximized'](validEvent)).toBe(true)

    const invalidEvent = { sender: { id: 999 } }
    expect(ipcHandleListeners['window_is_maximized'](invalidEvent)).toBe(false)
  })
})
