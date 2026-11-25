import { describe, it, expect } from 'vitest'

import {
  AURA_RING_INSET,
  auraRingWidth,
  DEFAULT_CONTAINER_ID,
  auraRingStyle,
  canMoveContainerInList,
  moveContainerInList,
  containerColorOf,
  containerForShortcutIndex,
  containerIdOf,
  containerNameOf,
  defaultContainerInfo,
  findContainer,
  hexToRgba,
  insetRectForAura,
  shortcutLabelForIndex,
  tabContainerMark,
  tabCountsByContainer,
  type ContainerInfo
} from './containers'

const work: ContainerInfo = {
  id: 'work',
  name: 'Work',
  color: '#f43f5e',
  accountId: 'work',
  createdAt: 1
}
const lab: ContainerInfo = { id: 'lab', name: 'Lab', accountId: 'work', createdAt: 2 }
const list = [defaultContainerInfo(), work, lab]

describe('containerIdOf', () => {
  it('treats a tab without a container as the default one', () => {
    expect(containerIdOf({})).toBe(DEFAULT_CONTAINER_ID)
    expect(containerIdOf({ containerId: '' })).toBe(DEFAULT_CONTAINER_ID)
    expect(containerIdOf(null)).toBe(DEFAULT_CONTAINER_ID)
    expect(containerIdOf({ containerId: 'work' })).toBe('work')
  })
})

describe('findContainer', () => {
  it('finds by id and falls back to the default container', () => {
    expect(findContainer(list, 'work').name).toBe('Work')
    expect(findContainer(list, 'deleted-container')).toMatchObject({
      id: DEFAULT_CONTAINER_ID,
      name: 'Default'
    })
    expect(findContainer([], 'work').id).toBe(DEFAULT_CONTAINER_ID)
  })
})

describe('colours and names', () => {
  it('normalises a colour and refuses junk', () => {
    expect(containerColorOf(work)).toBe('#f43f5e')
    expect(containerColorOf(lab)).toBeUndefined()
    expect(containerColorOf({ ...work, color: 'red; }' })).toBeUndefined()
  })

  it('never shows an empty name', () => {
    expect(containerNameOf({ ...work, name: '   ' })).toBe('Default')
    expect(containerNameOf(work)).toBe('Work')
  })
})

describe('shortcuts', () => {
  it('maps Ctrl+Alt+N to the Nth container, default first', () => {
    expect(containerForShortcutIndex(list, 1)?.id).toBe(DEFAULT_CONTAINER_ID)
    expect(containerForShortcutIndex(list, 2)?.id).toBe('work')
    expect(containerForShortcutIndex(list, 3)?.id).toBe('lab')
  })

  it('does nothing for an unused digit instead of guessing', () => {
    expect(containerForShortcutIndex(list, 4)).toBeNull()
    expect(containerForShortcutIndex(list, 0)).toBeNull()
    expect(containerForShortcutIndex(list, Number.NaN)).toBeNull()
  })

  it('labels the default container as both 1 and 0', () => {
    expect(shortcutLabelForIndex(1)).toBe('Ctrl+Alt+1 (or 0)')
    expect(shortcutLabelForIndex(3)).toBe('Ctrl+Alt+3')
  })
})

describe('tabCountsByContainer', () => {
  it('counts per container, defaulting absent fields', () => {
    expect(
      tabCountsByContainer([{}, { containerId: 'work' }, { containerId: 'work' }])
    ).toEqual({ default: 1, work: 2 })
  })
})

describe('the aura ring', () => {
  it('leaves the view alone when there is no colour to paint', () => {
    const rect = { x: 10, y: 20, width: 400, height: 300 }
    expect(insetRectForAura(rect, false)).toEqual(rect)
  })

  it('insets the view by the ring width on every side', () => {
    expect(insetRectForAura({ x: 10, y: 20, width: 400, height: 300 }, true)).toEqual({
      x: 10 + AURA_RING_INSET,
      y: 20 + AURA_RING_INSET,
      width: 400 - AURA_RING_INSET * 2,
      height: 300 - AURA_RING_INSET * 2
    })
  })

  it('never collapses a tiny view to nothing', () => {
    const tiny = insetRectForAura({ x: 0, y: 0, width: 4, height: 4 }, true)
    expect(tiny.width).toBe(1)
    expect(tiny.height).toBe(1)
  })

  it('paints a ring in the container colour, and nothing at all without one', () => {
    expect(auraRingStyle(undefined)).toEqual({})
    expect(auraRingStyle('not-a-colour')).toEqual({})

    const style = auraRingStyle('#f43f5e')
    expect(style.boxShadow).toContain('rgba(244, 63, 94')
    expect(style.boxShadow).toContain('inset')
  })

  it('scales the ring with the configured strength — build 33', () => {
    const rect = { x: 0, y: 0, width: 400, height: 300 }
    // 0 = no ring at all, so the page fills the frame instead of leaving a hidden gap.
    expect(insetRectForAura(rect, true, 0)).toEqual(rect)
    expect(auraRingWidth(0)).toBe(0)
    expect(auraRingStyle('#f43f5e', 0)).toEqual({})
    // 100 is the historical ring, unchanged, so an existing install looks exactly the same.
    expect(auraRingWidth(100)).toBe(AURA_RING_INSET)
    expect(insetRectForAura(rect, true, 100)).toEqual(insetRectForAura(rect, true))
    // Above 100 the ring reaches further rather than only getting more opaque.
    expect(auraRingWidth(200)).toBeGreaterThan(AURA_RING_INSET)
    expect(auraRingWidth(300)).toBeGreaterThan(auraRingWidth(200))
    // Clamped, so a stale localStorage value cannot produce a negative-sized view.
    expect(auraRingWidth(-50)).toBe(0)
    expect(auraRingWidth(10_000)).toBe(auraRingWidth(300))
    const huge = insetRectForAura(rect, true, 300)
    expect(huge.width).toBeGreaterThan(0)
    expect(huge.width).toBeLessThan(rect.width)
  })

  it('keeps the painted ring and the view inset in step', () => {
    // The glow used to live twice — hardcoded alphas in App.tsx and different ones here — so the veil
    // the user saw was not the one the maths described. Both now come from auraRingStyle().
    const soft = auraRingStyle('#f43f5e', 40)
    const bold = auraRingStyle('#f43f5e', 240)
    const alpha = (shadow?: string): number => Number(/(?:rgba\([^)]*,\s*)([\d.]+)\)/.exec(shadow || '')?.[1] ?? 0)
    expect(alpha(bold.boxShadow)).toBeGreaterThan(alpha(soft.boxShadow))
    expect(bold.boxShadow).not.toEqual(soft.boxShadow)
  })

  it('converts hex to rgba without leaking the raw string', () => {
    expect(hexToRgba('#000000', 0.5)).toBe('rgba(0, 0, 0, 0.5)')
    expect(hexToRgba('#ffffff', 2)).toBe('rgba(255, 255, 255, 1)')
    expect(hexToRgba('bogus', 0.3)).toBe('rgba(0, 0, 0, 0.3)')
  })
})

describe('tabContainerMark', () => {
  it('describes the tab container for the strip', () => {
    expect(tabContainerMark({ containerId: 'work' }, list)).toEqual({
      color: '#f43f5e',
      name: 'Work',
      isDefault: false
    })
    expect(tabContainerMark({}, list)).toEqual({
      color: undefined,
      name: 'Default',
      isDefault: true
    })
  })
})

describe('moveContainerInList', () => {
  const ids = (list: ContainerInfo[]): string[] => list.map((c) => c.id)

  it('moves a container up and down', () => {
    expect(ids(moveContainerInList(list, 'lab', -1))).toEqual([DEFAULT_CONTAINER_ID, 'lab', 'work'])
    expect(ids(moveContainerInList(list, 'work', 1))).toEqual([DEFAULT_CONTAINER_ID, 'lab', 'work'])
  })

  it('can move the default container, because the list is the numbering', () => {
    expect(ids(moveContainerInList(list, DEFAULT_CONTAINER_ID, 1))).toEqual(['work', DEFAULT_CONTAINER_ID, 'lab'])
  })

  it('returns the same list when the move would fall off either end', () => {
    expect(moveContainerInList(list, DEFAULT_CONTAINER_ID, -1)).toBe(list)
    expect(moveContainerInList(list, 'lab', 1)).toBe(list)
  })

  it('returns the same list for an unknown container or a no-op delta', () => {
    expect(moveContainerInList(list, 'missing', 1)).toBe(list)
    expect(moveContainerInList(list, 'work', 0)).toBe(list)
    expect(moveContainerInList(list, 'work', Number.NaN)).toBe(list)
  })

  it('does not mutate the list it was given', () => {
    const before = ids(list)
    moveContainerInList(list, 'lab', -2)
    expect(ids(list)).toEqual(before)
  })

  it('reports whether a row has somewhere to go', () => {
    expect(canMoveContainerInList(list, DEFAULT_CONTAINER_ID, -1)).toBe(false)
    expect(canMoveContainerInList(list, DEFAULT_CONTAINER_ID, 1)).toBe(true)
    expect(canMoveContainerInList(list, 'lab', 1)).toBe(false)
    expect(canMoveContainerInList(list, 'lab', -1)).toBe(true)
    expect(canMoveContainerInList(list, 'missing', 1)).toBe(false)
  })
})
