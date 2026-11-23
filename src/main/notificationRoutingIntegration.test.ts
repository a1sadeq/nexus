import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import * as overlayWatchdog from './overlayWatchdog'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatNotificationContent } from '../shared/notificationContent'
import { createNotificationRecorder } from './notificationDiagnostics'
import { applyNotificationPreferenceChange } from './notificationPreferences'

const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')
function section(start: string, end: string): string {
  const first = source.indexOf(start)
  const last = source.indexOf(end, first)
  if (first < 0 || last < 0) throw new Error(`Missing fixture section: ${start}`)
  return source.slice(first, last)
}
const code = ts.transpileModule(
  [
    section('const lastDesktopNotifications', 'function buildNotificationHtml'),
    section('function triggerDesktopNotification', 'const aiToastManager ='),
    section('function showInAppToast', 'function dismissInAppToast'),
    section('const DEFAULT_ACTION_KEYS', '\nfunction createWindow()')
  ].join('\n'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText

class NativeNotification extends EventEmitter {
  static created: NativeNotification[] = []
  static supported = true
  shown = false
  static isSupported(): boolean {
    return this.supported
  }
  constructor(public options: Record<string, unknown>) {
    super()
    NativeNotification.created.push(this)
  }
  show(): void {
    this.shown = true
  }
}

describe('completion notifications and latest-notification shortcut', () => {
  let context: vm.Context
  let send: ReturnType<typeof vi.fn>
  let toast: {
    show: ReturnType<typeof vi.fn>
    getCurrentData: ReturnType<typeof vi.fn>
    getIsVisible: ReturnType<typeof vi.fn>
  }
  let dismissed: ReturnType<typeof vi.fn>
  let win: {
    isDestroyed: () => boolean
    isVisible: () => boolean
    isMinimized: () => boolean
    isFocused: () => boolean
    focus: ReturnType<typeof vi.fn>
    contentView: {
      addChildView: ReturnType<typeof vi.fn>
      removeChildView: ReturnType<typeof vi.fn>
    }
    webContents: { isDestroyed: () => boolean }
  }
  const data = {
    id: 'id',
    tabId: 'background',
    tabTitle: 'private title',
    model: 'arena',
    status: 'done',
    snippet: 'private text'
  }

  beforeEach(() => {
    vi.useFakeTimers()
    NativeNotification.created = []
    NativeNotification.supported = true
    send = vi.fn()
    dismissed = vi.fn()
    toast = { show: vi.fn(), getCurrentData: vi.fn(() => data), getIsVisible: vi.fn(() => true) }
    win = {
      isDestroyed: () => false,
      isVisible: () => true,
      isMinimized: () => false,
      isFocused: () => true,
      focus: vi.fn(),
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
      webContents: { isDestroyed: () => false }
    }
    context = vm.createContext({
      exports: {},
      Notification: NativeNotification,
      console,
      Date,
      setTimeout,
      clearTimeout,
      join,
      existsSync: () => false,
      __dirname: '/nexus/main',
      app: { getAppPath: () => '/nexus', getPath: () => '/tmp/nexus-test' },
      process: { platform: 'linux' },
      mainWindow: win,
      aiNotificationView: {},
      activeViewId: 'active',
      activeViewVisible: true,
      aiViews: new Map([
        ['active', {}],
        ['background', {}]
      ]),
      tabDiscardManager: { hasView: () => false, isTabEvicted: () => false },
      currentNotificationData: null,
      isAiNotificationVisible: false,
      aiToastManager: toast,
      downloadNotificationOverlay: null,
      // Real implementations: the wording and the recorder are what this harness is checking,
      // so stubbing them would test nothing.
      formatNotificationContent,
      createNotificationRecorder,
      applyNotificationPreferenceChange,
      loadNotificationPreferences: () => ({ detail: 'standard', desktopEnabled: true }),
      saveNotificationPreferences: () => true,
      sendToMainWindow: send,
      dismissInAppToast: dismissed,
      ipcMain: { on: vi.fn() },
      restartActiveArenaTitleSync: vi.fn(),
      // The router's Escape deadline lives in its own module; the harness supplies it as-is.
      ...overlayWatchdog,
      reconcileViewPresentation: vi.fn(),
      focusPromptInView: vi.fn(),
      viewModelKeys: new Map()
    })
    vm.runInContext(code, context)
  })
  afterEach(() => vi.useRealTimers())

  it('shows both OS and in-app alerts for a background tab while Nexus is focused', () => {
    context.showInAppToast(data)
    expect(NativeNotification.created).toHaveLength(1)
    expect(NativeNotification.created[0].shown).toBe(true)
    // Detail level `standard`: the tab title and the model are in the notification, the prompt
    // text is not. This is the deliberate change from the previous title-less wording.
    const options = NativeNotification.created[0].options as { title: string; body: string }
    expect(options.body).toContain('private title')
    expect(options.body).not.toContain('private text')
    expect(options.title).toContain('response ready')
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining(data))
    expect(win.contentView.addChildView).toHaveBeenCalledOnce()
    expect(win.contentView.removeChildView).not.toHaveBeenCalled()
    expect(win.focus).not.toHaveBeenCalled()
    expect(vm.runInContext('nativeNotificationTimers.size', context)).toBe(1)
  })
  it('suppresses duplicate alerts when user is already viewing the finished tab', () => {
    context.showInAppToast({ ...data, tabId: 'active' })
    expect(NativeNotification.created).toHaveLength(0)
    expect(toast.show).not.toHaveBeenCalled()
    expect(dismissed).toHaveBeenCalledWith(true)
  })
  it('shows native but not in-app toast while the window is unfocused', () => {
    win.isFocused = () => false
    context.showInAppToast(data)
    expect(NativeNotification.created).toHaveLength(1)
    expect(toast.show).not.toHaveBeenCalled()
  })
  it('releases retained notifications on failure and routes click to the original tab', () => {
    context.showInAppToast(data)
    const native = NativeNotification.created[0]
    native.emit('click')
    expect(send).toHaveBeenCalledWith('notification_switch_to_tab', 'background')
    expect(vm.runInContext('nativeNotificationTimers.size', context)).toBe(0)
    vi.advanceTimersByTime(2001)
    context.showInAppToast(data)
    NativeNotification.created[1].emit('failed')
    expect(vm.runInContext('nativeNotificationTimers.size', context)).toBe(0)
  })
  it('keeps a bounded number of native objects and releases them by timeout', () => {
    for (let i = 0; i < 70; i++) context.showInAppToast({ ...data, tabId: `tab-${i}` })
    expect(vm.runInContext('nativeNotificationTimers.size', context)).toBe(64)
    vi.advanceTimersByTime(15 * 60 * 1000)
    expect(vm.runInContext('nativeNotificationTimers.size', context)).toBe(0)
  })
  it('routes the default and a configured shortcut to the latest tab, guarding autorepeat', () => {
    context.showInAppToast(data)
    const event = { preventDefault: vi.fn() }
    const input = {
      type: 'keyDown',
      control: true,
      meta: false,
      alt: false,
      shift: true,
      key: 'Y',
      code: 'KeyY',
      isAutoRepeat: false
    }
    expect(context.routeGlobalShortcut(event, input, 'view')).toBe(true)
    expect(send).toHaveBeenCalledWith('notification_switch_to_tab', 'background')
    send.mockClear()
    context.routeGlobalShortcut(event, { ...input, isAutoRepeat: true }, 'view')
    expect(send).not.toHaveBeenCalled()
    context.setCustomKeymapForTesting({ 'notification-latest': ['Alt', 'Y'] })
    expect(
      context.routeGlobalShortcut(
        event,
        { ...input, control: false, shift: false, alt: true },
        'window'
      )
    ).toBe(true)
    expect(send).toHaveBeenCalledWith('notification_switch_to_tab', 'background')
  })
  it('does not consume a shortcut when the target is gone or an overlay is open', () => {
    context.showInAppToast(data)
    context.aiViews.delete('background')
    const event = { preventDefault: vi.fn() }
    const input = {
      type: 'keyDown',
      control: true,
      meta: false,
      alt: false,
      shift: true,
      key: 'Y',
      code: 'KeyY'
    }
    expect(context.routeGlobalShortcut(event, input, 'view')).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
    context.showInAppToast(data)
    context.setOverlaysOpenForTesting(true)
    expect(context.routeGlobalShortcut(event, input, 'window')).toBe(false)
  })
  it('sets only the toast view not to focus on navigation and routes its keyboard', () => {
    expect(source).toMatch(
      /aiNotificationView = new WebContentsView\(\{[\s\S]*?focusOnNavigation: false[\s\S]*?\}\)/
    )
    expect(source).toMatch(/aiNotificationView\.webContents\.on\('before-input-event'/)
  })
  it('opens the most recent of multiple notified tabs', () => {
    context.aiViews.set('newer', {})
    context.showInAppToast(data)
    context.showInAppToast({ ...data, tabId: 'newer' })
    const event = { preventDefault: vi.fn() }
    const input = {
      type: 'keyDown',
      control: true,
      meta: false,
      alt: false,
      shift: true,
      key: 'ن',
      code: 'KeyY',
      isAutoRepeat: false
    }
    expect(context.routeGlobalShortcut(event, input, 'view')).toBe(true)
    expect(send).toHaveBeenCalledWith('notification_switch_to_tab', 'newer')
  })
  it('still shows the in-app toast if the OS reports notifications unsupported', () => {
    NativeNotification.supported = false
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    context.showInAppToast(data)
    context.showInAppToast(data)
    expect(NativeNotification.created).toHaveLength(0)
    expect(toast.show).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
