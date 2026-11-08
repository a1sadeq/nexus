// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import VerticalTabs from './VerticalTabs'
import type { Tab } from '../lib/tabs'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const mockTabs: Tab[] = [
  {
    id: 'tab-1',
    title: 'Analyze quantum physics paper and summarize findings',
    model: 'gemini',
    url: 'https://gemini.google.com/chat/1',
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: 'tab-2',
    title: 'Code review',
    model: 'claude',
    url: 'https://claude.ai/chat/2',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
]

describe('VerticalTabs Component', () => {
  let container: HTMLDivElement
  let root: any

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('renders "No active tabs" when tabs array is empty', async () => {
    await act(async () => {
      root.render(
        <VerticalTabs
          tabs={[]}
          activeId={null}
          sidebarCollapsed={false}
          onSelect={vi.fn()}
          onClose={vi.fn()}
          onTogglePin={vi.fn()}
        />
      )
    })
    expect(container.textContent).toContain('No active tabs')
  })

  it('renders full title in expanded mode', async () => {
    await act(async () => {
      root.render(
        <VerticalTabs
          tabs={mockTabs}
          activeId="tab-1"
          sidebarCollapsed={false}
          onSelect={vi.fn()}
          onClose={vi.fn()}
          onTogglePin={vi.fn()}
        />
      )
    })
    expect(container.textContent).toContain('Analyze quantum physics paper and summarize findings')
    expect(container.textContent).toContain('Code review')
  })

  it('renders first 4 words text chip in collapsed mode (User Requirement A2)', async () => {
    await act(async () => {
      root.render(
        <VerticalTabs
          tabs={mockTabs}
          activeId="tab-1"
          sidebarCollapsed={true}
          onSelect={vi.fn()}
          onClose={vi.fn()}
          onTogglePin={vi.fn()}
        />
      )
    })
    // "Analyze quantum physics paper and summarize findings" -> first 4 words + ellipsis:
    expect(container.textContent).toContain('Analyze quantum physics paper…')
    // Short title remains whole:
    expect(container.textContent).toContain('Code review')
  })

  it('renders Herdr AI status indicator when tab is waiting for input', async () => {
    await act(async () => {
      root.render(
        <VerticalTabs
          tabs={mockTabs}
          activeId="tab-1"
          tabStatuses={{ 'tab-2': 'waiting-input' }}
          sidebarCollapsed={false}
          onSelect={vi.fn()}
          onClose={vi.fn()}
          onTogglePin={vi.fn()}
        />
      )
    })
    const statusBadges = container.querySelectorAll('[role="status"]')
    expect(statusBadges.length).toBe(2)
    const waitingBadge = container.querySelector('[aria-label*="waiting for your input"]')
    expect(waitingBadge).toBeTruthy()
    const idleBadge = container.querySelector('[aria-label*="AI is idle and ready"]')
    expect(idleBadge).toBeTruthy()
  })

  it('triggers onSelect when tab is clicked', async () => {
    const handleSelect = vi.fn()
    await act(async () => {
      root.render(
        <VerticalTabs
          tabs={mockTabs}
          activeId="tab-1"
          sidebarCollapsed={false}
          onSelect={handleSelect}
          onClose={vi.fn()}
          onTogglePin={vi.fn()}
        />
      )
    })
    const secondTab = container.querySelector('[data-vertical-tab-id="tab-2"]') as HTMLElement
    expect(secondTab).toBeTruthy()
    await act(async () => {
      secondTab.click()
    })
    expect(handleSelect).toHaveBeenCalledWith('tab-2')
  })

  it('triggers onClose when close button is clicked', async () => {
    const handleClose = vi.fn()
    await act(async () => {
      root.render(
        <VerticalTabs
          tabs={mockTabs}
          activeId="tab-1"
          sidebarCollapsed={false}
          onSelect={vi.fn()}
          onClose={handleClose}
          onTogglePin={vi.fn()}
        />
      )
    })
    const closeBtn = container.querySelector('[aria-label="Close tab Analyze quantum physics paper and summarize findings"]') as HTMLButtonElement
    expect(closeBtn).toBeTruthy()
    await act(async () => {
      closeBtn.click()
    })
    expect(handleClose).toHaveBeenCalledWith('tab-1')
  })

  it('triggers onTogglePin on right click (context menu)', async () => {
    const handlePin = vi.fn()
    await act(async () => {
      root.render(
        <VerticalTabs
          tabs={mockTabs}
          activeId="tab-1"
          sidebarCollapsed={false}
          onSelect={vi.fn()}
          onClose={vi.fn()}
          onTogglePin={handlePin}
        />
      )
    })
    const secondTab = container.querySelector('[data-vertical-tab-id="tab-2"]') as HTMLElement
    await act(async () => {
      secondTab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })
    expect(handlePin).toHaveBeenCalledWith('tab-2')
  })

  it('orders pinned tabs to the top of the sidebar list', async () => {
    await act(async () => {
      root.render(
        <VerticalTabs
          tabs={mockTabs}
          activeId="tab-1"
          pinnedIds={['tab-2']}
          sidebarCollapsed={false}
          onSelect={vi.fn()}
          onClose={vi.fn()}
          onTogglePin={vi.fn()}
        />
      )
    })
    const tabElements = container.querySelectorAll('[data-vertical-tab-id]')
    expect(tabElements).toHaveLength(2)
    // tab-2 is pinned, so it should be first in DOM order
    expect(tabElements[0].getAttribute('data-vertical-tab-id')).toBe('tab-2')
    expect(tabElements[1].getAttribute('data-vertical-tab-id')).toBe('tab-1')
  })

  it('triggers onReorder on mouse drop event', async () => {
    const handleReorder = vi.fn()
    await act(async () => {
      root.render(
        <VerticalTabs
          tabs={mockTabs}
          activeId="tab-1"
          sidebarCollapsed={false}
          onSelect={vi.fn()}
          onClose={vi.fn()}
          onTogglePin={vi.fn()}
          onReorder={handleReorder}
        />
      )
    })
    const secondTab = container.querySelector('[data-vertical-tab-id="tab-2"]') as HTMLElement
    expect(secondTab).toBeTruthy()

    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as any
    dropEvent.dataTransfer = {
      getData: (format: string) => (format === 'text/nexus-tab-id' ? 'tab-1' : '')
    }

    await act(async () => {
      secondTab.dispatchEvent(dropEvent)
    })

    expect(handleReorder).toHaveBeenCalledWith('tab-1', 'tab-2')
  })

  it('separates tabs into Active Sessions and Sleeping / Discarded sections', async () => {
    const tabsWithDiscarded: Tab[] = [
      ...mockTabs,
      {
        id: 'tab-3',
        title: 'Drafting patent proposal',
        model: 'chatgpt',
        url: 'https://chatgpt.com/c/3',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ]

    await act(async () => {
      root.render(
        <VerticalTabs
          tabs={tabsWithDiscarded}
          activeId="tab-1"
          residentTabIds={['tab-1']}
          sidebarCollapsed={false}
          onSelect={vi.fn()}
          onClose={vi.fn()}
          onTogglePin={vi.fn()}
        />
      )
    })

    // Both section headers exist
    expect(container.textContent).toContain('Active Sessions')
    expect(container.textContent).toContain('Sleeping / Discarded')

    // tab-1 is active/resident
    const tab1 = container.querySelector('[data-vertical-tab-id="tab-1"]') as HTMLElement
    expect(tab1).toBeTruthy()
    expect(tab1.getAttribute('data-tab-sleeping')).toBe('false')
    expect(tab1.classList.contains('vertical-tab-arc-reactor')).toBe(true)

    // tab-2 and tab-3 are sleeping/discarded
    const tab2 = container.querySelector('[data-vertical-tab-id="tab-2"]') as HTMLElement
    expect(tab2).toBeTruthy()
    expect(tab2.getAttribute('data-tab-sleeping')).toBe('true')
    expect(tab2.classList.contains('vertical-tab-sleeping')).toBe(true)

    const tab3 = container.querySelector('[data-vertical-tab-id="tab-3"]') as HTMLElement
    expect(tab3).toBeTruthy()
    expect(tab3.getAttribute('data-tab-sleeping')).toBe('true')
  })

  it('renders arc-reactor cockpit effects on the active tab', async () => {
    await act(async () => {
      root.render(
        <VerticalTabs
          tabs={mockTabs}
          activeId="tab-1"
          residentTabIds={['tab-1', 'tab-2']}
          sidebarCollapsed={false}
          onSelect={vi.fn()}
          onClose={vi.fn()}
          onTogglePin={vi.fn()}
        />
      )
    })

    const activeTab = container.querySelector('[data-vertical-tab-id="tab-1"]') as HTMLElement
    expect(activeTab).toBeTruthy()
    expect(activeTab.classList.contains('vertical-tab-arc-reactor')).toBe(true)

    // Active core dot with radar ripple exists
    const activeDot = activeTab.querySelector('.vertical-tab-active-core-dot')
    expect(activeDot).toBeTruthy()

    // Title has text-[13px] font-semibold styling
    const activeTitle = activeTab.querySelector('.text-\\[13px\\]')
    expect(activeTitle).toBeTruthy()
    expect(activeTitle?.classList.contains('font-semibold')).toBe(true)
  })

  it('wakes a sleeping tab when clicked', async () => {
    const handleSelect = vi.fn()
    await act(async () => {
      root.render(
        <VerticalTabs
          tabs={mockTabs}
          activeId="tab-1"
          residentTabIds={['tab-1']}
          sidebarCollapsed={false}
          onSelect={handleSelect}
          onClose={vi.fn()}
          onTogglePin={vi.fn()}
        />
      )
    })

    const sleepingTab = container.querySelector('[data-vertical-tab-id="tab-2"]') as HTMLElement
    expect(sleepingTab).toBeTruthy()
    expect(sleepingTab.getAttribute('data-tab-sleeping')).toBe('true')

    await act(async () => {
      sleepingTab.click()
    })

    expect(handleSelect).toHaveBeenCalledWith('tab-2')
  })
})
