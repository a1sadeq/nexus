import { describe, it, expect, beforeEach } from 'vitest'
import {
  getShortcutKeys,
  setShortcutKeys,
  resetShortcutKeys,
  resetAllShortcuts,
  getEffectiveShortcuts,
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
})
