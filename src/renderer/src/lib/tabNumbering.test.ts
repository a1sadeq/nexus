import { describe, it, expect } from 'vitest'

import {
  MAX_TAB_SHORTCUT_NUMBER,
  numberableTabs,
  numberedTabOrder,
  pinnedTabForShortcutNumber,
  shortcutTabCount,
  tabForShortcutNumber,
  tabNumberMap
} from './tabNumbering'

const tab = (id: string) => ({ id, title: id })
// Two pinned tabs, three normal ones, deliberately not in id order so a sort bug would show.
const tabs = [tab('a'), tab('b'), tab('c'), tab('d'), tab('e')]
const pinned = ['c', 'a']

describe('tab numbering', () => {
  it('puts pinned tabs first, then the normal tabs, each in drawn order', () => {
    // Pinned tabs keep the order they have in the list — the strips do not re-sort them either.
    expect(numberedTabOrder(tabs, pinned).map((t) => t.id)).toEqual(['a', 'c', 'b', 'd', 'e'])
  })

  it('numbers from the pinned tabs, continuing into the normal ones', () => {
    expect(tabNumberMap(tabs, pinned)).toEqual({ a: 1, c: 2, b: 3, d: 4, e: 5 })
  })

  it('is identical for Ctrl+N resolution, so a badge can never lie', () => {
    const map = tabNumberMap(tabs, pinned)
    for (const [id, number] of Object.entries(map)) {
      expect(tabForShortcutNumber(tabs, pinned, number)?.id).toBe(id)
    }
  })

  it('stops at nine, because there are nine digits', () => {
    const many = Array.from({ length: 12 }, (_, i) => tab(`t${i}`))
    expect(numberableTabs(many, []).length).toBe(MAX_TAB_SHORTCUT_NUMBER)
    const map = tabNumberMap(many, [])
    expect(map.t8).toBe(9)
    expect(map.t9).toBeUndefined()
    expect(tabForShortcutNumber(many, [], 9)?.id).toBe('t8')
    expect(tabForShortcutNumber(many, [], 10)).toBeNull()
    expect(shortcutTabCount(many, [])).toBe(9)
  })

  it('returns null for a digit with no tab behind it, instead of wrapping', () => {
    expect(tabForShortcutNumber(tabs, pinned, 7)).toBeNull()
    expect(tabForShortcutNumber(tabs, pinned, 0)).toBeNull()
    expect(tabForShortcutNumber(tabs, pinned, Number.NaN)).toBeNull()
  })

  it('keeps one ordering rule for an empty list', () => {
    expect(tabNumberMap([], [])).toEqual({})
    expect(tabForShortcutNumber([], pinned, 1)).toBeNull()
  })

  it('never numbers a pinned id that is not in the list', () => {
    const map = tabNumberMap(tabs, ['c', 'gone'])
    expect(map.gone).toBeUndefined()
    // Only `c` is a real tab, so only `c` is lifted to the front: 1, then the rest in order.
    expect(map.c).toBe(1)
    expect(map.a).toBe(2)
  })

  it('still resolves Alt+1…9 against the pinned tabs only', () => {
    expect(pinnedTabForShortcutNumber(tabs, pinned, 1)?.id).toBe('a')
    expect(pinnedTabForShortcutNumber(tabs, pinned, 2)?.id).toBe('c')
    expect(pinnedTabForShortcutNumber(tabs, pinned, 3)).toBeNull()
  })
})
