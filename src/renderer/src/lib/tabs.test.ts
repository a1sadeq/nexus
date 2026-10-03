import { describe, it, expect } from 'vitest'
import {
  createTab,
  openHistoryTab,
  switchToModel,
  closeTab,
  addNewChat,
  serializeState,
  deserializeState,
  isProviderHomeUrl,
  isIgnoredHistoryUrl,
  isDefaultOrGenericTitle,
  sanitizeHistory,
  pushClosedTab,
  reopenClosedTab,
  type Tab,
  type ModelKey,
  type HistoryItem
} from './tabs'

const urlOf: Record<ModelKey, string> = {
  gemini: 'https://gemini.google.com',
  qwen: 'https://chat.qwen.ai',
  kimi: 'https://kimi.moonshot.cn'
}

function tab(over: Partial<Tab> = {}): Tab {
  return {
    id: 't1',
    title: 'New Chat',
    model: 'gemini',
    url: urlOf.gemini,
    createdAt: 1,
    updatedAt: 1,
    ...over
  }
}

describe('createTab', () => {
  it('builds a tab with unique id and timestamps', () => {
    const a = createTab('gemini', 'New Chat', urlOf.gemini)
    const b = createTab('gemini', 'New Chat', urlOf.gemini)
    expect(a.id).not.toBe(b.id)
    expect(a.model).toBe('gemini')
    expect(a.title).toBe('New Chat')
    expect(a.url).toBe(urlOf.gemini)
    expect(a.createdAt).toBeGreaterThan(0)
    expect(a.updatedAt).toBeGreaterThan(0)
  })
})

describe('switchToModel', () => {
  it('creates a fresh tab for the model (reuse is the caller\u2019s job, see handleDeployModel)', () => {
    const tabs = [
      tab({ id: 'g1', model: 'gemini' }),
      tab({ id: 'q1', model: 'qwen', title: 'Qwen chat' })
    ]
    const res = switchToModel(tabs, 'qwen', 'New Chat', urlOf.qwen)
    expect(res.tabs).toHaveLength(3)
    expect(res.activeId).not.toBe('q1')
    const created = res.tabs.find((t) => t.title === 'New Chat' && t.model === 'qwen')
    expect(created).toBeDefined()
  })

  it('creates a New Chat tab when model has none', () => {
    const tabs = [tab({ id: 'g1', model: 'gemini' })]
    const res = switchToModel(tabs, 'kimi', 'New Chat', urlOf.kimi)
    expect(res.tabs).toHaveLength(2)
    expect(res.activeId).not.toBe('g1')
    const created = res.tabs.find((t) => t.model === 'kimi')!
    expect(created.title).toBe('New Chat')
    expect(created.url).toBe(urlOf.kimi)
  })
})

describe('openHistoryTab', () => {
  it('creates a tab from history item', () => {
    const item: HistoryItem = {
      id: 'h1',
      title: 'Rust borrow checker',
      url: 'https://gemini.google.com/app/abc123',
      model: 'gemini',
      timestamp: 100
    }
    const res = openHistoryTab([], item)
    expect(res.tabs).toHaveLength(1)
    expect(res.tabs[0].title).toBe('Rust borrow checker')
    expect(res.tabs[0].url).toBe('https://gemini.google.com/app/abc123')
    expect(res.activeId).toBe(res.tabs[0].id)
  })

  it('dedupes: same URL activates existing tab instead of duplicating', () => {
    const existing = tab({ id: 'g1', title: 'Rust borrow checker' })
    const item: HistoryItem = {
      id: 'h1',
      title: 'Rust borrow checker',
      url: existing.url,
      model: 'gemini',
      timestamp: 100
    }
    const res = openHistoryTab([existing], item)
    expect(res.tabs).toHaveLength(1)
    expect(res.activeId).toBe('g1')
  })
})

describe('closeTab', () => {
  it('removes the tab', () => {
    const tabs = [tab({ id: 'g1', model: 'gemini' }), tab({ id: 'q1', model: 'qwen' })]
    const res = closeTab(tabs, 'g1', 'q1')
    expect(res.tabs.map((t) => t.id)).toEqual(['g1'])
  })

  it('activates right neighbor when closing active tab', () => {
    const tabs = [
      tab({ id: 'g1', model: 'gemini' }),
      tab({ id: 'q1', model: 'qwen' }),
      tab({ id: 'k1', model: 'kimi' })
    ]
    const res = closeTab(tabs, 'q1', 'q1')
    expect(res.activeId).toBe('k1')
  })

  it('activates left neighbor when closing active last tab', () => {
    const tabs = [tab({ id: 'g1', model: 'gemini' }), tab({ id: 'q1', model: 'qwen' })]
    const res = closeTab(tabs, 'q1', 'q1')
    expect(res.activeId).toBe('g1')
  })

  it('replaces last tab with a fresh New Chat for that model', () => {
    const tabs = [tab({ id: 'g1', model: 'gemini', title: 'Old chat' })]
    const res = closeTab(tabs, 'g1', 'g1')
    expect(res.tabs).toHaveLength(1)
    expect(res.tabs[0].title).toBe('New Chat')
    expect(res.tabs[0].model).toBe('gemini')
    expect(res.tabs[0].id).not.toBe('g1')
    expect(res.activeId).toBe(res.tabs[0].id)
  })

  it('ignores unknown tab id (no-op)', () => {
    const tabs = [tab({ id: 'g1', model: 'gemini' })]
    const res = closeTab(tabs, 'g1', 'nope')
    expect(res.tabs).toHaveLength(1)
    expect(res.activeId).toBe('g1')
  })
})

describe('addNewChat', () => {
  it('appends a New Chat tab for the model and activates it', () => {
    const tabs = [tab({ id: 'g1', model: 'gemini' })]
    const res = addNewChat(tabs, 'gemini', urlOf.gemini)
    expect(res.tabs).toHaveLength(2)
    expect(res.activeId).not.toBe('g1')
    const created = res.tabs.find((t) => t.id === res.activeId)!
    expect(created.title).toBe('New Chat')
    expect(created.model).toBe('gemini')
  })
})

describe('serializeState / deserializeState', () => {
  it('round-trips tabs and activeId', () => {
    const tabs = [tab({ id: 'g1', model: 'gemini' })]
    const raw = serializeState(tabs, 'g1')
    const res = deserializeState(raw)!
    expect(res.tabs).toEqual(tabs)
    expect(res.activeId).toBe('g1')
  })

  it('returns null on invalid JSON', () => {
    expect(deserializeState('not json')).toBeNull()
  })

  it('returns null on null input', () => {
    expect(deserializeState(null)).toBeNull()
  })
})

describe('isProviderHomeUrl', () => {
  it('detects kimi home', () => {
    expect(isProviderHomeUrl('https://www.kimi.com/')).toBe(true)
  })

  it('detects gemini /app home', () => {
    expect(isProviderHomeUrl('https://gemini.google.com/app')).toBe(true)
  })

  it('rejects kimi chat uuid', () => {
    expect(
      isProviderHomeUrl('https://www.kimi.com/chat/19fd7c00-4982-8792-8000-097925baae0f')
    ).toBe(false)
  })

  it('rejects qwen chat path', () => {
    expect(isProviderHomeUrl('https://www.qwen.ai/chat/some-id')).toBe(false)
  })

  it('rejects unknown hosts', () => {
    expect(isProviderHomeUrl('https://example.com/')).toBe(false)
  })

  it('rejects invalid urls', () => {
    expect(isProviderHomeUrl('not a url')).toBe(false)
  })
})

describe('pushClosedTab & reopenClosedTab', () => {
  it('pushes and restores closed tabs in LIFO order', () => {
    const t1 = tab({ id: 't1', title: 'Tab 1', url: 'https://gemini.google.com/1' })
    const t2 = tab({ id: 't2', title: 'Tab 2', url: 'https://gemini.google.com/2' })
    let stack = pushClosedTab([], t1, 0, false)
    stack = pushClosedTab(stack, t2, 1, true)

    expect(stack).toHaveLength(2)
    expect(stack[0].tab.id).toBe('t2')
    expect(stack[0].isPinned).toBe(true)

    const initialTabs = [tab({ id: 't0', title: 'Tab 0' })]
    const restored1 = reopenClosedTab(initialTabs, stack)
    expect(restored1.tabs).toHaveLength(2)
    expect(restored1.tabs[1].id).toBe('t2')
    expect(restored1.activeId).toBe('t2')
    expect(restored1.restoredEntry?.isPinned).toBe(true)

    const restored2 = reopenClosedTab(restored1.tabs, restored1.nextStack)
    expect(restored2.tabs).toHaveLength(3)
    expect(restored2.tabs[0].id).toBe('t1')
    expect(restored2.activeId).toBe('t1')
    expect(restored2.nextStack).toHaveLength(0)
  })

  it('caps closed tabs stack at MAX_CLOSED_TABS (30)', () => {
    let stack: any[] = []
    for (let i = 0; i < 40; i++) {
      stack = pushClosedTab(stack, tab({ id: `tab-${i}` }), i)
    }
    expect(stack).toHaveLength(30)
    expect(stack[0].tab.id).toBe('tab-39')
  })
})

describe('isIgnoredHistoryUrl', () => {
  it('identifies OAuth and search and home URLs as ignored', () => {
    expect(isIgnoredHistoryUrl('https://accounts.google.com/v3/signin/rejected')).toBe(true)
    expect(isIgnoredHistoryUrl('https://www.google.com/webhp?authuser=1')).toBe(true)
    expect(isIgnoredHistoryUrl('https://www.google.com/search?q=test')).toBe(true)
    expect(isIgnoredHistoryUrl('https://gemini.google.com/app')).toBe(true)
    expect(isIgnoredHistoryUrl('https://chat.deepseek.com/authorized?provider=GOOGLE')).toBe(true)
    expect(isIgnoredHistoryUrl('https://gemini.google.com/app/f37aece556ccec43')).toBe(false)
    expect(isIgnoredHistoryUrl('https://www.kimi.ai/chat/19fd7c00-4982-8792-8000-097925baae0f')).toBe(false)
  })
})

describe('isDefaultOrGenericTitle', () => {
  it('detects default/generic titles', () => {
    expect(isDefaultOrGenericTitle('New Chat')).toBe(true)
    expect(isDefaultOrGenericTitle('Google')).toBe(true)
    expect(isDefaultOrGenericTitle('Google Gemini')).toBe(true)
    expect(isDefaultOrGenericTitle('gemini', 'gemini')).toBe(true)
    expect(isDefaultOrGenericTitle('DeepSeek - Into the Unknown')).toBe(true)
    expect(isDefaultOrGenericTitle("Couldn't sign you in")).toBe(true)
    expect(isDefaultOrGenericTitle('Abliteration AI', 'albert', ['Abliteration AI'])).toBe(true)
    expect(isDefaultOrGenericTitle('Rust Borrow Checker', 'gemini')).toBe(false)
    expect(isDefaultOrGenericTitle('Abliteration Console', 'albert', ['Abliteration AI'])).toBe(false)
  })
})

describe('sanitizeHistory', () => {
  it('purges duplicates, OAuth/login artifacts, and assigns unique ids', () => {
    const raw: HistoryItem[] = [
      { id: 'tab-1', title: 'Google', url: 'https://www.google.com/webhp', model: 'gemini' },
      { id: 'tab-1', title: 'Google', url: 'https://accounts.google.com/signin', model: 'gemini' },
      { id: 'tab-1', title: 'Real Chat 1', url: 'https://gemini.google.com/app/123', model: 'gemini' },
      { id: 'tab-2', title: 'Real Chat 1', url: 'https://gemini.google.com/app/123', model: 'gemini' },
      { id: 'tab-3', title: 'Real Chat 2', url: 'https://kimi.ai/chat/abc', model: 'kimi' }
    ]

    const clean = sanitizeHistory(raw)
    expect(clean).toHaveLength(2)
    expect(clean[0].title).toBe('Real Chat 1')
    expect(clean[1].title).toBe('Real Chat 2')
    expect(clean[0].id).not.toBe(clean[1].id)
  })
})
