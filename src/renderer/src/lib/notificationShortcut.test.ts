import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findShortcutCollision, getShortcutMap, setShortcutKeys } from './shortcuts'

describe('latest notification shortcut setting', () => {
  const values = new Map<string, string>()
  beforeEach(() => {
    values.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        values.set(key, value)
      },
      removeItem: (key: string): void => {
        values.delete(key)
      }
    })
  })
  afterEach(() => vi.unstubAllGlobals())
  it('provides an unclaimed default through the effective keymap', () => {
    expect(getShortcutMap()['notification-latest']).toEqual(['Ctrl', 'Shift', 'Y'])
    expect(findShortcutCollision('notification-latest', ['Ctrl', 'Shift', 'Y'])).toBeNull()
  })
  it('exports a customized key through the same effective keymap', () => {
    setShortcutKeys('notification-latest', ['Alt', 'Y'])
    expect(getShortcutMap()['notification-latest']).toEqual(['Alt', 'Y'])
  })
})
