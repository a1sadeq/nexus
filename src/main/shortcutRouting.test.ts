import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

describe('Global Shortcut Routing (Ctrl+1..4, Ctrl+9, Ctrl+Tab)', () => {
  const mainSrc = readFileSync(join(__dirname, 'index.ts'), 'utf8')
  const start = mainSrc.indexOf('const DEFAULT_ACTION_KEYS')
  const end = mainSrc.indexOf('\nfunction createWindow()', start)
  const routerCode = mainSrc.slice(start, end)
  const compiled = ts.transpileModule(routerCode, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText

  let ctx: any
  let sendMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sendMock = vi.fn()
    ctx = {
      exports: {},
      ipcMain: { on: vi.fn() },
      mainWindow: { isDestroyed: () => false, webContents: { openDevTools: vi.fn() } },
      activeViewId: 'tab-1',
      activeViewVisible: true,
      aiViews: new Map(),
      viewModelKeys: new Map(),
      sendToMainWindow: sendMock,
      restartActiveArenaTitleSync: vi.fn(),
      console: console
    }
    vm.runInNewContext(compiled, ctx)
  })

  it('routes physical Digit1..4 correctly even if key is non-digit (international layout)', () => {
    const event = { preventDefault: vi.fn() }
    const input = {
      type: 'keyDown',
      control: true,
      meta: false,
      alt: false,
      shift: false,
      key: '&', // French AZERTY layout produces '&' for top row 1
      code: 'Digit1'
    }

    const handled = ctx.routeGlobalShortcut(event, input, 'view')
    expect(handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(sendMock).toHaveBeenCalledWith('execute-global-action', {
      action: 'switch_tab_index',
      index: 0,
      isPinned: false
    })
  })

  it('routes Numpad1..4 correctly to switch tab index', () => {
    const event = { preventDefault: vi.fn() }
    const input = {
      type: 'keyDown',
      control: true,
      meta: false,
      alt: false,
      shift: false,
      key: '1',
      code: 'Numpad2'
    }

    const handled = ctx.routeGlobalShortcut(event, input, 'view')
    expect(handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(sendMock).toHaveBeenCalledWith('execute-global-action', {
      action: 'switch_tab_index',
      index: 1, // Numpad2 -> index 1
      isPinned: false
    })
  })

  it('routes Ctrl+9 to index -1 (jump to last tab)', () => {
    const event = { preventDefault: vi.fn() }
    const input = {
      type: 'keyDown',
      control: true,
      meta: false,
      alt: false,
      shift: false,
      key: '9',
      code: 'Digit9'
    }

    const handled = ctx.routeGlobalShortcut(event, input, 'view')
    expect(handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(sendMock).toHaveBeenCalledWith('execute-global-action', {
      action: 'switch_tab_index',
      index: -1,
      isPinned: false
    })
  })

  it('routes Ctrl+Tab to trigger_tab_cycle with shift: false', () => {
    const event = { preventDefault: vi.fn() }
    const input = {
      type: 'keyDown',
      control: true,
      meta: false,
      alt: false,
      shift: false,
      key: 'Tab',
      code: 'Tab'
    }

    const handled = ctx.routeGlobalShortcut(event, input, 'view')
    expect(handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(sendMock).toHaveBeenCalledWith('trigger_tab_cycle', { shift: false })
  })

  it('routes Ctrl+Shift+Tab to trigger_tab_cycle with shift: true', () => {
    const event = { preventDefault: vi.fn() }
    const input = {
      type: 'keyDown',
      control: true,
      meta: false,
      alt: false,
      shift: true,
      key: 'Tab',
      code: 'Tab'
    }

    const handled = ctx.routeGlobalShortcut(event, input, 'view')
    expect(handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(sendMock).toHaveBeenCalledWith('trigger_tab_cycle', { shift: true })
  })
})
