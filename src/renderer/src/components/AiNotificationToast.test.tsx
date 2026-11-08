// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { AiNotificationToast, type AiNotificationItem } from './AiNotificationToast'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe('AiNotificationToast', () => {
  let container: HTMLDivElement
  let root: any

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.useFakeTimers()
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('renders nothing when notifications list is empty', async () => {
    await act(async () => {
      root.render(<AiNotificationToast notifications={[]} onDismiss={() => {}} onSelectTab={() => {}} />)
    })
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('renders notification card with done status and triggers click onSelectTab', async () => {
    const onDismiss = vi.fn()
    const onSelectTab = vi.fn()

    const item: AiNotificationItem = {
      id: 'test-1',
      tabId: 'tab-101',
      tabTitle: 'Claude Code Session',
      model: 'claude',
      status: 'done',
      snippet: 'Done refactoring your codebase.',
      timestamp: Date.now()
    }

    await act(async () => {
      root.render(
        <AiNotificationToast
          notifications={[item]}
          onDismiss={onDismiss}
          onSelectTab={onSelectTab}
        />
      )
    })

    const card = container.querySelector('[role="alert"]')
    expect(card).toBeTruthy()
    expect(card?.textContent).toContain('Claude Code Session')
    expect(card?.textContent).toContain('Done refactoring your codebase.')
    expect(card?.textContent).toContain('Done')

    // Click card to open tab
    await act(async () => {
      card?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onSelectTab).toHaveBeenCalledWith('tab-101')
    expect(onDismiss).toHaveBeenCalledWith('test-1')
  })

  it('renders Iron Man red card for waiting-input status', async () => {
    const onDismiss = vi.fn()
    const onSelectTab = vi.fn()

    const item: AiNotificationItem = {
      id: 'test-2',
      tabId: 'tab-102',
      tabTitle: 'DeepSeek Coding',
      model: 'deepseek',
      status: 'waiting-input',
      snippet: 'Which database do you prefer: SQLite or PostgreSQL?',
      timestamp: Date.now()
    }

    await act(async () => {
      root.render(
        <AiNotificationToast
          notifications={[item]}
          onDismiss={onDismiss}
          onSelectTab={onSelectTab}
        />
      )
    })

    const card = container.querySelector('[role="alert"]')
    expect(card).toBeTruthy()
    expect(card?.textContent).toContain('DeepSeek Coding')
    expect(card?.textContent).toContain('Needs Input')
    expect(card?.textContent).toContain('Which database do you prefer')
  })

  it('auto-dismisses after 7000ms timeout', async () => {
    const onDismiss = vi.fn()
    const item: AiNotificationItem = {
      id: 'test-3',
      tabId: 'tab-103',
      tabTitle: 'Gemini Research',
      model: 'gemini',
      status: 'done',
      timestamp: Date.now()
    }

    await act(async () => {
      root.render(
        <AiNotificationToast
          notifications={[item]}
          onDismiss={onDismiss}
          onSelectTab={() => {}}
        />
      )
    })

    expect(onDismiss).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(7000)
    })

    expect(onDismiss).toHaveBeenCalledWith('test-3')
  })
})
