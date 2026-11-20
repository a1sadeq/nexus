import { describe, it, expect } from 'vitest'
import { partitionTabSections } from './tabSections'
import type { Tab } from './tabs'

const tab = (id: string, model = 'gemini'): Tab => ({ id, title: id, model, url: '' }) as Tab

const tabs: Tab[] = [tab('a'), tab('b'), tab('c'), tab('d')]

describe('pinned as its own section', () => {
  it('puts pinned tabs in their own section, above the rest', () => {
    const result = partitionTabSections({
      tabs,
      activeId: 'a',
      pinnedIds: ['c'],
      pinnedSection: true
    })
    expect(result.pinned.map((t) => t.id)).toEqual(['c'])
    expect(result.order.map((t) => t.id)[0]).toBe('c')
    expect(result.active.map((t) => t.id)).not.toContain('c')
  })

  it('never lists a pinned tab twice', () => {
    const result = partitionTabSections({
      tabs,
      activeId: 'a',
      pinnedIds: ['a', 'b'],
      pinnedSection: true
    })
    const ids = result.order.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(result.active.map((t) => t.id)).toEqual(['c', 'd'].filter((id) => result.active.some((t) => t.id === id)))
  })

  it('keeps the old behaviour when the section is off: pinned sort first, inline', () => {
    const result = partitionTabSections({
      tabs,
      activeId: 'a',
      pinnedIds: ['c'],
      pinnedSection: false
    })
    expect(result.pinned).toEqual([])
    expect(result.active.map((t) => t.id)).toEqual(['c', 'a'])
  })

  it('keeps a pinned tab awake even when it would otherwise be discarded', () => {
    // residentTabIds is the authoritative "in memory" list; an unpinned, idle, non-resident tab
    // sleeps, while the pinned one stays in the active group.
    const result = partitionTabSections({
      tabs,
      activeId: 'a',
      pinnedIds: ['d'],
      residentTabIds: ['a'],
      pinnedSection: true
    })
    expect(result.pinned.map((t) => t.id)).toEqual(['d'])
    expect(result.discarded.map((t) => t.id)).toEqual(['b', 'c'])
  })

  it('still shows a working tab in Active even when it is pinned nowhere', () => {
    const result = partitionTabSections({
      tabs,
      activeId: 'a',
      pinnedIds: [],
      tabStatuses: { d: 'working' },
      residentTabIds: ['a'],
      pinnedSection: true
    })
    expect(result.active.map((t) => t.id)).toContain('d')
  })

  it('orders the arrow-key walk the same way the screen reads', () => {
    const result = partitionTabSections({
      tabs: [tab('a'), tab('b'), tab('c'), tab('d'), tab('e')],
      activeId: 'a',
      pinnedIds: ['b', 'd'],
      residentTabIds: ['a'],
      discardedTabIds: ['e', 'c'],
      pinnedSection: true
    })
    expect(result.order.map((t) => t.id)).toEqual([
      ...result.pinned.map((t) => t.id),
      ...result.active.map((t) => t.id),
      ...result.discarded.map((t) => t.id)
    ])
  })

  it('is a no-op for an empty list', () => {
    const result = partitionTabSections({ tabs: [], activeId: null, pinnedIds: ['x'], pinnedSection: true })
    expect(result).toEqual({ pinned: [], active: [], discarded: [], order: [] })
  })
})
