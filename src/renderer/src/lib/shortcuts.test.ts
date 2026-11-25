import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_SHORTCUTS,
  getShortcutKeys,
  setShortcutKeys,
  resetShortcutKeys,
  resetAllShortcuts,
  getEffectiveShortcuts,
  loadCustomShortcuts,
  findShortcutCollision,
  matchesShortcut,
  parseKeyEventToKeys
} from './shortcuts'

const storageMap = new Map<string, string>()

const mockLocalStorage = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, val: string) => storageMap.set(key, val),
  removeItem: (key: string) => storageMap.delete(key),
  clear: () => storageMap.clear()
}

// @ts-ignore
globalThis.localStorage = mockLocalStorage

describe('shortcuts module', () => {
  beforeEach(() => {
    mockLocalStorage.clear()
  })

  it('loads default shortcut keys when none customized', () => {
    const keys = getShortcutKeys('tab-new')
    expect(keys).toEqual(['Ctrl', 'T'])
    expect(getShortcutKeys('skills-palette')).toEqual(['Ctrl', 'S'])
    expect(getShortcutKeys('skills-base-modal')).toEqual(['Ctrl', 'Shift', 'S'])
    expect(getShortcutKeys('shell-inspector')).toEqual(['Ctrl', 'Alt', 'Shift', 'I'])
  })

  it('allows customizing a shortcut and retrieves the custom key', () => {
    setShortcutKeys('tab-new', ['Ctrl', 'N'])
    expect(getShortcutKeys('tab-new')).toEqual(['Ctrl', 'N'])

    const effective = getEffectiveShortcuts()
    const tabNew = effective.find((s) => s.id === 'tab-new')
    expect(tabNew?.keys).toEqual(['Ctrl', 'N'])
    expect(tabNew?.isCustom).toBe(true)
  })

  it('resets a single custom shortcut to default', () => {
    setShortcutKeys('tab-close', ['Ctrl', 'Q'])
    expect(getShortcutKeys('tab-close')).toEqual(['Ctrl', 'Q'])

    resetShortcutKeys('tab-close')
    expect(getShortcutKeys('tab-close')).toEqual(['Ctrl', 'W'])
  })

  it('resets all custom shortcuts', () => {
    setShortcutKeys('tab-new', ['Ctrl', 'N'])
    setShortcutKeys('tab-close', ['Ctrl', 'Q'])
    resetAllShortcuts()

    expect(getShortcutKeys('tab-new')).toEqual(['Ctrl', 'T'])
    expect(getShortcutKeys('tab-close')).toEqual(['Ctrl', 'W'])
  })

  it('detects shortcut collisions', () => {
    // tab-close is default Ctrl+W. Trying to set tab-new to Ctrl+W should collide with tab-close.
    const collision = findShortcutCollision('tab-new', ['Ctrl', 'W'])
    expect(collision).not.toBeNull()
    expect(collision?.id).toBe('tab-close')
  })

  it('matches keyboard events accurately', () => {
    const eventCtrlT = {
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      key: 't',
      code: 'KeyT'
    } as unknown as KeyboardEvent

    expect(matchesShortcut(eventCtrlT, ['Ctrl', 'T'])).toBe(true)
    expect(matchesShortcut(eventCtrlT, ['Ctrl', 'W'])).toBe(false)
    expect(matchesShortcut(eventCtrlT, ['Ctrl', 'Shift', 'T'])).toBe(false)

    const eventCtrlShiftT = {
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: true,
      key: 'T',
      code: 'KeyT'
    } as unknown as KeyboardEvent

    expect(matchesShortcut(eventCtrlShiftT, ['Ctrl', 'Shift', 'T'])).toBe(true)
    expect(matchesShortcut(eventCtrlShiftT, ['Ctrl', 'T'])).toBe(false)

    // Ctrl+B: Standard key
    const eventCtrlB = {
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      key: 'b',
      code: 'KeyB'
    } as unknown as KeyboardEvent
    expect(matchesShortcut(eventCtrlB, ['Ctrl', 'B'])).toBe(true)

    // Ctrl+B: Localized layout (e.g. Arabic layout emits Arabic char, but physical code is KeyB)
    const eventCtrlBLocalized = {
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      key: 'لا',
      code: 'KeyB'
    } as unknown as KeyboardEvent
    expect(matchesShortcut(eventCtrlBLocalized, ['Ctrl', 'B'])).toBe(true)

    // Ctrl+B: Control character \x02 on Linux
    const eventCtrlBControlChar = {
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      key: '\x02',
      code: 'KeyB'
    } as unknown as KeyboardEvent
    expect(matchesShortcut(eventCtrlBControlChar, ['Ctrl', 'B'])).toBe(true)
  })

  it('parses key event into structured keys', () => {
    const event = {
      ctrlKey: true,
      altKey: false,
      shiftKey: true,
      metaKey: false,
      key: 'P'
    } as unknown as KeyboardEvent

    expect(parseKeyEventToKeys(event)).toEqual(['Ctrl', 'Shift', 'P'])
  })

  it('returns null when only modifier keys are pressed', () => {
    const event = {
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      key: 'Control'
    } as unknown as KeyboardEvent

    expect(parseKeyEventToKeys(event)).toBeNull()
  })

  it('matches shell-inspector shortcut with Ctrl+Alt+Shift+I', () => {
    const event = {
      ctrlKey: true,
      metaKey: false,
      altKey: true,
      shiftKey: true,
      key: 'I',
      code: 'KeyI'
    } as unknown as KeyboardEvent

    expect(matchesShortcut(event, ['Ctrl', 'Alt', 'Shift', 'I'])).toBe(true)
    expect(matchesShortcut(event, ['Ctrl', 'Shift', 'I'])).toBe(false)
    expect(matchesShortcut(event, ['Ctrl', 'Shift', 'D'])).toBe(false)
  })

  it('gives Ctrl+. to the container switcher and moves stop-generation off it', () => {
    const picker = DEFAULT_SHORTCUTS.find((s) => s.id === 'containers-picker')
    const stop = DEFAULT_SHORTCUTS.find((s) => s.id === 'stop-generation')
    expect(picker?.defaultKeys).toEqual(['Ctrl', '.'])
    expect(stop?.defaultKeys).toEqual(['Ctrl', 'Shift', '.'])

    const plainDot = {
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      key: '.',
      code: 'Period'
    } as unknown as KeyboardEvent
    const shiftDot = {
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: true,
      key: '.',
      code: 'Period'
    } as unknown as KeyboardEvent

    expect(matchesShortcut(plainDot, picker!.defaultKeys)).toBe(true)
    expect(matchesShortcut(plainDot, stop!.defaultKeys)).toBe(false)
    // The old key must not still stop a generation, or one press would do two things.
    expect(matchesShortcut(plainDot, ['Ctrl', '.'])).toBe(true)
    expect(matchesShortcut(shiftDot, stop!.defaultKeys)).toBe(true)
    expect(matchesShortcut(shiftDot, picker!.defaultKeys)).toBe(false)
  })
})

/**
 * The environment that broke `ShortcutKeys.test.tsx` on a real machine.
 *
 * Node 22.4+ defines a `localStorage` global, and it is unusable unless the process was started with
 * `--localstorage-file`: every read returns null and every write throws. When that global shadows the
 * window's storage, a customised shortcut is written nowhere and read back as the default — which is
 * exactly what a badge on a button must never do.
 */
describe('shortcuts storage resolution', () => {
  it('saves the customisation where it will be read, when the ambient localStorage is the Node stub', () => {
    const scope = globalThis as unknown as { window?: unknown; localStorage?: unknown }
    const savedWindow = scope.window
    const savedStorage = scope.localStorage

    const unavailable = (): never => {
      throw new Error('localStorage is not available because --localstorage-file was not provided')
    }
    const windowStore = new Map<string, string>()

    scope.localStorage = {
      getItem: unavailable,
      setItem: unavailable,
      removeItem: unavailable,
      clear: unavailable,
      key: unavailable,
      get length(): number {
        return unavailable()
      }
    }
    scope.window = {
      localStorage: {
        getItem: (key: string) => windowStore.get(key) ?? null,
        setItem: (key: string, value: string) => void windowStore.set(key, value),
        removeItem: (key: string) => void windowStore.delete(key),
        clear: () => windowStore.clear(),
        key: () => null,
        length: 0
      },
      dispatchEvent: () => true
    }

    try {
      setShortcutKeys('tab-colours', ['Ctrl', 'Alt', 'K'])
      expect(getShortcutKeys('tab-colours')).toEqual(['Ctrl', 'Alt', 'K'])
      expect(windowStore.size).toBe(1)

      resetShortcutKeys('tab-colours')
      expect(getShortcutKeys('tab-colours')).toEqual(
        DEFAULT_SHORTCUTS.find((shortcut) => shortcut.id === 'tab-colours')!.defaultKeys
      )
      // The map is rewritten without the entry rather than removed, so an empty object is the empty state.
      expect(JSON.parse(windowStore.get('nexus.custom_shortcuts') ?? '{}')).toEqual({})
    } finally {
      scope.window = savedWindow
      scope.localStorage = savedStorage
    }
  })

  it('keeps the customisation in memory when there is no storage at all', () => {
    const scope = globalThis as unknown as { window?: unknown; localStorage?: unknown }
    const savedWindow = scope.window
    const savedStorage = scope.localStorage
    scope.window = undefined
    scope.localStorage = undefined
    try {
      expect(() => setShortcutKeys('tab-colours', ['Ctrl', 'Alt', 'K'])).not.toThrow()
      // Nowhere to persist, so the session keeps it in memory rather than silently reverting under the
      // user's fingers — the badge and the keymap still agree with each other.
      expect(getShortcutKeys('tab-colours')).toEqual(['Ctrl', 'Alt', 'K'])
      expect(loadCustomShortcuts()).toEqual({ 'tab-colours': ['Ctrl', 'Alt', 'K'] })
    } finally {
      resetShortcutKeys('tab-colours')
      scope.window = savedWindow
      scope.localStorage = savedStorage
    }
  })
})
