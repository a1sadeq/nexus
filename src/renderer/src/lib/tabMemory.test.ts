import { describe, it, expect } from 'vitest'
import {
  adoptTabMemory,
  applyRememberedPinnedPosition,
  applyRememberedPosition,
  memoryKeyForUrl,
  readTabMemory,
  rememberTabs,
  serializeTabMemory,
  TAB_MEMORY_LIMIT,
  type TabMemory
} from './tabMemory'
import type { Tab } from './tabs'

/**
 * Build 48 — the tab is remembered, not the row.
 *
 * Closing a tab and opening the same conversation again used to produce a stranger: unpinned, no
 * accent, no aura, at the bottom of the list. These are the rules that stop that, and the ones that make
 * remembering *safe*: nothing is invented, nothing from disk reaches a CSS string unvalidated, and the
 * memory may never override a choice the user has already made by hand.
 */

const tab = (over: Partial<Tab> = {}): Tab => ({
  id: over.id ?? 'tab-1',
  title: over.title ?? 'A chat',
  model: over.model ?? 'gemini',
  url: over.url ?? 'https://gemini.google.com/app/abc',
  createdAt: 1,
  updatedAt: 2,
  ...over
})

describe('the address a memory is filed under', () => {
  it('treats the same conversation reached by different links as one thing', () => {
    const canonical = memoryKeyForUrl('https://gemini.google.com/app/abc')
    expect(memoryKeyForUrl('https://gemini.google.com/app/abc/')).toBe(canonical)
    expect(memoryKeyForUrl('https://GEMINI.google.com/app/abc')).toBe(canonical)
    expect(memoryKeyForUrl('https://www.gemini.google.com/app/abc#bottom')).toBe(canonical)
    expect(memoryKeyForUrl('  https://gemini.google.com/app/abc  ')).toBe(canonical)
  })

  it('keeps a query string — providers put the conversation in it', () => {
    expect(memoryKeyForUrl('https://chatgpt.com/c/1?model=4o')).not.toBe(
      memoryKeyForUrl('https://chatgpt.com/c/1')
    )
  })

  it('has nothing to file for an empty address', () => {
    expect(memoryKeyForUrl('')).toBe('')
    expect(memoryKeyForUrl(undefined)).toBe('')
    expect(memoryKeyForUrl(null)).toBe('')
  })
})

describe('reading what was stored', () => {
  it('drops records that would put arbitrary text into a colours value', () => {
    const raw = JSON.stringify({
      'https://gemini.google.com/app/abc': {
        key: 'https://gemini.google.com/app/abc',
        pinned: true,
        accentColor: 'red; } body { display:none',
        auraColor: '#8b5cf6',
        position: 2,
        updatedAt: 10
      }
    })
    const memory = readTabMemory(raw)
    const entry = memory['https://gemini.google.com/app/abc']
    expect(entry.pinned).toBe(true)
    expect(entry.accentColor).toBeUndefined()
    expect(entry.auraColor).toBe('#8b5cf6')
  })

  it('survives rubbish instead of throwing', () => {
    expect(readTabMemory('not json')).toEqual({})
    expect(readTabMemory('[]')).toEqual({})
    expect(readTabMemory(null)).toEqual({})
    expect(readTabMemory(JSON.stringify({ a: 5 }))).toEqual({})
  })
})

describe('remembering the open tabs', () => {
  it('stores pin, both colours and position per address', () => {
    const tabs = [
      tab({ id: 'tab-1', url: 'https://a.example/1' }),
      tab({ id: 'tab-2', url: 'https://a.example/2', accentColor: '#f43f5e', auraColor: '#0ea5e9' })
    ]
    const memory = rememberTabs({}, tabs, ['tab-2'], 1000)
    expect(memory['https://a.example/1'].pinned).toBe(false)
    expect(memory['https://a.example/1'].position).toBe(0)
    expect(memory['https://a.example/2'].pinned).toBe(true)
    expect(memory['https://a.example/2'].accentColor).toBe('#f43f5e')
    expect(memory['https://a.example/2'].auraColor).toBe('#0ea5e9')
    expect(memory['https://a.example/2'].position).toBe(1)
  })

  it('keeps the entry for an address that is no longer open — that is the point', () => {
    const first = rememberTabs({}, [tab({ id: 'tab-1', url: 'https://a.example/1' })], ['tab-1'], 1000)
    const second = rememberTabs(first, [], [], 2000)
    expect(second['https://a.example/1']).toBeTruthy()
    expect(second['https://a.example/1'].pinned).toBe(true)
  })

  it('does not erase a colour a tab has not been given yet', () => {
    const withColour = rememberTabs(
      {},
      [tab({ id: 'tab-1', url: 'https://a.example/1', accentColor: '#10b981' })],
      [],
      1000
    )
    // A freshly restored row is colourless for the moment before it is adopted.
    const afterRestore = rememberTabs(withColour, [tab({ id: 'tab-9', url: 'https://a.example/1' })], [], 2000)
    expect(afterRestore['https://a.example/1'].accentColor).toBe('#10b981')
  })

  it('is bounded', () => {
    const many: Tab[] = []
    for (let i = 0; i < TAB_MEMORY_LIMIT + 20; i += 1) {
      many.push(tab({ id: `tab-${i}`, url: `https://a.example/${i}` }))
    }
    const memory = rememberTabs({}, many, [], 5000)
    expect(Object.keys(memory).length).toBe(TAB_MEMORY_LIMIT)
  })
})

describe('giving a new tab what it had before', () => {
  it('restores both colours and the pinned state', () => {
    const memory: TabMemory = {
      'https://a.example/1': {
        key: 'https://a.example/1',
        pinned: true,
        accentColor: '#f59e0b',
        auraColor: '#14b8a6',
        position: 3,
        pinnedPosition: 1,
        updatedAt: 1
      }
    }
    const adopted = adoptTabMemory(tab({ id: 'tab-new', url: 'https://a.example/1/' }), memory)
    expect(adopted.pinned).toBe(true)
    expect(adopted.tab.accentColor).toBe('#f59e0b')
    expect(adopted.tab.auraColor).toBe('#14b8a6')
    expect(adopted.position).toBe(3)
    // The original object is not mutated — it may still be in React state.
    expect(tab({ id: 'tab-new' }).accentColor).toBeUndefined()
  })

  it('changes nothing when the address has never been seen', () => {
    const incoming = tab({ id: 'tab-new', url: 'https://unknown.example/x' })
    const adopted = adoptTabMemory(incoming, {})
    expect(adopted.tab).toBe(incoming)
    expect(adopted.pinned).toBe(false)
    expect(adopted.position).toBeNull()
  })

  it('puts a tab back where it was, and clamps a place that no longer exists', () => {
    const tabs = [
      tab({ id: 'a', url: 'https://a.example/a' }),
      tab({ id: 'b', url: 'https://a.example/b' }),
      tab({ id: 'c', url: 'https://a.example/c' })
    ]
    expect(applyRememberedPosition(tabs, 'c', 0).map((t) => t.id)).toEqual(['c', 'a', 'b'])
    expect(applyRememberedPosition(tabs, 'a', 99).map((t) => t.id)).toEqual(['b', 'c', 'a'])
    expect(applyRememberedPosition(tabs, 'a', null)).toBe(tabs)
    expect(applyRememberedPosition(tabs, 'a', 0)).toBe(tabs)
  })
})

describe('the pinned section has its own place', () => {
  const pinnedSet = ['p1', 'p2', 'p3']
  const list: Tab[] = [
    tab({ id: 'p1', url: 'https://a.example/p1' }),
    tab({ id: 'p2', url: 'https://a.example/p2' }),
    tab({ id: 'p3', url: 'https://a.example/p3' }),
    tab({ id: 's1', url: 'https://a.example/s1' })
  ]

  it('records where a pinned tab sits among the pinned ones', () => {
    const memory = rememberTabs({}, [list[0], list[2], list[1]], ['p1', 'p3', 'p2'], 10)
    expect(memory['https://a.example/p3'].pinnedPosition).toBe(1)
    expect(memory['https://a.example/p2'].pinnedPosition).toBe(2)
  })

  it('puts a pinned tab back in the middle of the pinned list, above the sessions', () => {
    const tabsNow: Tab[] = [
      tab({ id: 'p1', url: 'https://a.example/p1' }),
      tab({ id: 'p3', url: 'https://a.example/p3' }),
      tab({ id: 'p2', url: 'https://a.example/p2' }),
      tab({ id: 's1', url: 'https://a.example/s1' })
    ]
    const restored = applyRememberedPinnedPosition(tabsNow, 'p2', 1, pinnedSet)
    expect(restored.map((t) => t.id)).toEqual(['p1', 'p2', 'p3', 's1'])
  })

  it('pins at the top when it is the only pinned tab, and at the end when the place is beyond it', () => {
    const only: Tab[] = [
      tab({ id: 'p1', url: 'https://a.example/p1' }),
      tab({ id: 's1', url: 'https://a.example/s1' })
    ]
    expect(applyRememberedPinnedPosition(only, 'p1', 0, ['p1']).map((t) => t.id)).toEqual(['p1', 's1'])
    const three = list.map((t) => tab({ id: t.id, url: t.url }))
    expect(applyRememberedPinnedPosition(three, 'p1', 9, pinnedSet).map((t) => t.id)).toEqual([
      'p2',
      'p3',
      'p1',
      's1'
    ])
  })

  it('says nothing about a pinned place for a tab that is not pinned', () => {
    const memory = rememberTabs({}, [tab({ id: 's1', url: 'https://a.example/s1' })], [], 10)
    const adopted = adoptTabMemory(tab({ id: 's1b', url: 'https://a.example/s1' }), memory)
    expect(adopted.pinned).toBe(false)
    expect(adopted.pinnedPosition).toBeNull()
  })
})

describe('the stored form', () => {
  it('round-trips', () => {
    const tabs = [tab({ id: 'tab-1', url: 'https://a.example/1', accentColor: '#84cc16' })]
    const memory = rememberTabs({}, tabs, ['tab-1'], 1234)
    const back = readTabMemory(serializeTabMemory(memory))
    expect(back['https://a.example/1'].accentColor).toBe('#84cc16')
    expect(back['https://a.example/1'].pinned).toBe(true)
  })
})
