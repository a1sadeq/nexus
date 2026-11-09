import { describe, it, expect } from 'vitest'
import {
  getOrderedVisualTabs,
  getNextVisualTab,
  type Tab
} from './tabs'

function makeTab(id: string, title: string = id): Tab {
  return {
    id,
    title,
    model: 'gemini',
    url: `https://gemini.google.com/${id}`,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
}

describe('visualTabShortcuts', () => {
  const tab1 = makeTab('tab-1', 'ChatGPT')
  const tab2 = makeTab('tab-2', 'Claude')
  const tab3 = makeTab('tab-3', 'Gemini')
  const tab4 = makeTab('tab-4', 'Perplexity')
  const tab5 = makeTab('tab-5', 'DeepSeek')
  const allTabs = [tab1, tab2, tab3, tab4, tab5]

  it('orders tabs matching the exact visual sidebar layout', () => {
    // tab-2 is pinned, tab-1 is active, tab-3 is working
    const pinnedIds = ['tab-2']
    const activeId = 'tab-1'
    const tabStatuses = { 'tab-3': 'working' }
    const residentTabIds = ['tab-1', 'tab-2', 'tab-3']

    const visual = getOrderedVisualTabs(allTabs, activeId, pinnedIds, tabStatuses, residentTabIds)
    // Active group: pinned (tab-2) comes first, then unpinned active (tab-1, tab-3)
    // Discarded group: tab-4, tab-5
    expect(visual.map((t) => t.id)).toEqual(['tab-2', 'tab-1', 'tab-3', 'tab-4', 'tab-5'])
  })

  it('resolves Ctrl+1..4 to the exact 1st, 2nd, 3rd, and 4th visual tabs', () => {
    const visual = getOrderedVisualTabs(allTabs, 'tab-1', [], {}, ['tab-1', 'tab-2', 'tab-3', 'tab-4', 'tab-5'])
    expect(visual[0].id).toBe('tab-1') // Ctrl+1
    expect(visual[1].id).toBe('tab-2') // Ctrl+2
    expect(visual[2].id).toBe('tab-3') // Ctrl+3
    expect(visual[3].id).toBe('tab-4') // Ctrl+4
  })

  it('resolves Ctrl+9 to the last tab in the visual list', () => {
    const visual = getOrderedVisualTabs(allTabs, 'tab-1', [], {}, ['tab-1', 'tab-2', 'tab-3', 'tab-4', 'tab-5'])
    const lastTab = visual[visual.length - 1]
    expect(lastTab.id).toBe('tab-5') // Ctrl+9
  })

  it('cycles smoothly forward without ping-ponging (Ctrl+Tab)', () => {
    const visual = allTabs

    // 1 -> 2
    let next = getNextVisualTab(visual, 'tab-1', false)
    expect(next?.id).toBe('tab-2')

    // 2 -> 3
    next = getNextVisualTab(visual, 'tab-2', false)
    expect(next?.id).toBe('tab-3')

    // 3 -> 4
    next = getNextVisualTab(visual, 'tab-3', false)
    expect(next?.id).toBe('tab-4')

    // 4 -> 5
    next = getNextVisualTab(visual, 'tab-4', false)
    expect(next?.id).toBe('tab-5')

    // 5 -> wrap around to 1
    next = getNextVisualTab(visual, 'tab-5', false)
    expect(next?.id).toBe('tab-1')
  })

  it('cycles smoothly backward on Ctrl+Shift+Tab', () => {
    const visual = allTabs

    // 1 -> wrap around to 5
    let prev = getNextVisualTab(visual, 'tab-1', true)
    expect(prev?.id).toBe('tab-5')

    // 5 -> 4
    prev = getNextVisualTab(visual, 'tab-5', true)
    expect(prev?.id).toBe('tab-4')

    // 4 -> 3
    prev = getNextVisualTab(visual, 'tab-4', true)
    expect(prev?.id).toBe('tab-3')
  })
})
