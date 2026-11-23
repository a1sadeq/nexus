import { describe, it, expect } from 'vitest'

import {
  AURA_RING_INSET,
  DEFAULT_CONTAINER_ID,
  auraRingStyle,
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
