import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import * as overlayWatchdog from './overlayWatchdog'

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
      // Reached by the stop-generation / site-new-chat branches; they only need to not throw.
      clickActiveViewFeature: vi.fn(() => Promise.resolve()),
      // The Escape deadline: the router arms it, so it needs the module and a timer that never fires.
      ...overlayWatchdog,
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
      reconcileViewPresentation: vi.fn(),
      focusPromptInView: vi.fn(),
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
      number: 1,
      pinnedOnly: false
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
      number: 2, // Numpad2 -> the second numbered tab
      pinnedOnly: false
    })
  })

  it('routes Ctrl+9 to the ninth numbered tab, not to "last"', () => {
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
      number: 9,
      pinnedOnly: false
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

  it('routes Ctrl+. to the container switcher, and lets the switcher close itself with it', () => {
    // The switcher is itself an overlay: if the overlay guard ran first, the key that opened it could
    // not close it again. Main therefore tracks the switcher separately from the other overlays.
    vm.runInNewContext('overlaysOpen = true; containerMenuOpen = true', ctx)
    const event = { preventDefault: vi.fn() }
    const input = {
      type: 'keyDown',
      control: true,
      meta: false,
      alt: false,
      shift: false,
      key: '.',
      code: 'Period'
    }

    const handled = ctx.routeGlobalShortcut(event, input, 'window')
    vm.runInNewContext('overlaysOpen = false; containerMenuOpen = false', ctx)

    expect(handled).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(sendMock).toHaveBeenCalledWith('execute-global-action', {
      action: 'toggle_container_menu'
    })
    // And it must not also stop a generation, now that Ctrl+dot is not what stops one.
    expect(sendMock).not.toHaveBeenCalledWith('execute-global-action', {
      action: 'stop_generation'
    })
  })

  it('leaves Ctrl+. to any other open overlay, so Settings can record it as a shortcut', () => {
    vm.runInNewContext('overlaysOpen = true; containerMenuOpen = false', ctx)
    const event = { preventDefault: vi.fn() }
    const input = {
      type: 'keyDown',
      control: true,
      meta: false,
      alt: false,
      shift: false,
      key: '.',
      code: 'Period'
    }

    expect(ctx.routeGlobalShortcut(event, input, 'window')).toBe(false)
    vm.runInNewContext('overlaysOpen = false', ctx)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('leaves Ctrl+Shift+. to stop-generation', () => {
    const event = { preventDefault: vi.fn() }
    const input = {
      type: 'keyDown',
      control: true,
      meta: false,
      alt: false,
      shift: true,
      key: '.',
      code: 'Period'
    }

    // Stop generation is clicked in main, so the proof is the feature call, not an IPC message.
    expect(ctx.routeGlobalShortcut(event, input, 'view')).toBe(true)
    expect(ctx.clickActiveViewFeature).toHaveBeenCalledWith('stopGenerationSelector')
    expect(sendMock).not.toHaveBeenCalledWith('execute-global-action', {
      action: 'toggle_container_menu'
    })
  })

  it('sends Alt+2 as pinnedOnly, and Ctrl+2 as the whole numbered list', () => {
    const alt = { preventDefault: vi.fn() }
    ctx.routeGlobalShortcut(
      alt,
      { type: 'keyDown', control: false, meta: false, alt: true, shift: false, key: '2', code: 'Digit2' },
      'view'
    )
    expect(sendMock).toHaveBeenCalledWith('execute-global-action', {
      action: 'switch_tab_index',
      number: 2,
      pinnedOnly: true
    })

    sendMock.mockClear()
    const ctrl = { preventDefault: vi.fn() }
    ctx.routeGlobalShortcut(
      ctrl,
      { type: 'keyDown', control: true, meta: false, alt: false, shift: false, key: '2', code: 'Digit2' },
      'view'
    )
    expect(sendMock).toHaveBeenCalledWith('execute-global-action', {
      action: 'switch_tab_index',
      number: 2,
      pinnedOnly: false
    })
  })

  it('turns Escape into a close request with a deadline, even mid-overlay', () => {
    vm.runInNewContext('overlaysOpen = true', ctx)
    const event = { preventDefault: vi.fn() }
    const input = {
      type: 'keyDown',
      control: false,
      meta: false,
      alt: false,
      shift: false,
      key: 'Escape',
      code: 'Escape'
    }

    const handled = ctx.routeGlobalShortcut(event, input, 'window')
    vm.runInNewContext('overlaysOpen = false', ctx)

    // Non-consuming, as before: the overlay may still run its own cancel logic.
    expect(handled).toBe(false)
    expect(sendMock).toHaveBeenCalledWith('execute-global-action', { action: 'close_overlay' })
    // ...but now the close also has a deadline, so a request that lands nowhere cannot leave the
    // window unreachable by every shortcut.
    expect(ctx.setTimeout).toHaveBeenCalled()
  })
})
