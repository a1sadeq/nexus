// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { AiStatusBadge } from './AiStatusBadge'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe('AiStatusBadge', () => {
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

  it('renders blue indicator when status is idle', async () => {
    await act(async () => {
      root.render(<AiStatusBadge status="idle" />)
    })
    const el = container.querySelector('[role="status"]')
    expect(el).toBeTruthy()
    expect(el?.getAttribute('title')).toBe('Ready')
    expect(el?.getAttribute('aria-label')).toContain('AI is idle and ready')
    expect(container.innerHTML).toContain('bg-sky-400')
  })

  it('renders purple thinking beacon when status is working', async () => {
    await act(async () => {
      root.render(<AiStatusBadge status="working" />)
    })
    const el = container.querySelector('[role="status"]')
    expect(el).toBeTruthy()
    expect(el?.getAttribute('title')).toContain('Thinking / Generating')
    expect(el?.getAttribute('aria-label')).toContain('AI is thinking')
    expect(container.innerHTML).toContain('bg-purple-500')
  })

  it('renders Iron Man red beacon with gold border when status is waiting-input', async () => {
    await act(async () => {
      root.render(<AiStatusBadge status="waiting-input" />)
    })
    const el = container.querySelector('[role="status"]')
    expect(el).toBeTruthy()
    expect(el?.getAttribute('title')).toContain('waiting for your input')
    expect(el?.getAttribute('aria-label')).toContain('waiting for your input')
    expect(container.innerHTML).toContain('bg-red-600')
    expect(container.innerHTML).toContain('border-amber-400')
  })

  it('renders green done state when AI completes', async () => {
    await act(async () => {
      root.render(<AiStatusBadge status="done" />)
    })
    const el = container.querySelector('[role="status"]')
    expect(el).toBeTruthy()
    expect(el?.getAttribute('title')).toBe('Finished')
    expect(container.innerHTML).toContain('bg-emerald-500')
  })
})
