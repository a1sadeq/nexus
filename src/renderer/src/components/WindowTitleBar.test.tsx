// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { WindowTitleBar } from './WindowTitleBar'
import { DEFAULT_MODELS } from '../lib/models'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe('WindowTitleBar Component', () => {
  let container: HTMLDivElement
  let root: any
  let mockWindowControls: {
    minimize: ReturnType<typeof vi.fn>
    maximizeToggle: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    isMaximized: ReturnType<typeof vi.fn>
    onMaximizedChange: ReturnType<typeof vi.fn>
  }
  let maximizedChangeCallback: ((isMax: boolean) => void) | null = null
  let cleanupMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    cleanupMock = vi.fn()
    maximizedChangeCallback = null

    mockWindowControls = {
      minimize: vi.fn(),
      maximizeToggle: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn().mockResolvedValue(false),
      onMaximizedChange: vi.fn((cb) => {
        maximizedChangeCallback = cb
        return cleanupMock
      })
    }

    ;(window as any).electron = {
      platform: 'linux',
      windowControls: mockWindowControls
    }
  })

  afterEach(() => {
    try {
      root?.unmount()
    } catch {}
    container?.remove()
  })

  const renderBar = async (props: any) => {
    await act(async () => {
      root.render(<WindowTitleBar {...props} />)
    })
    await act(async () => {
      await Promise.resolve()
    })
  }

  it('renders titlebar with conversation title and model pill', async () => {
    await renderBar({
      activeTabTitle: 'Quantum Machine Learning Discussion',
      activeModelName: 'Gemini Pro',
      modelColor: '#4ade80',
      maskTitle: false,
      showCustomControls: true,
      models: DEFAULT_MODELS,
      activeModelKey: 'gemini',
      onSelectModel: () => {}
    })

    expect(container.textContent).toContain('NEXUS')
    expect(container.textContent).toContain('Quantum Machine Learning Discussion')
    expect(container.textContent).toContain('Gemini Pro')
  })

  it('masks sensitive conversation title when maskTitle is true (Privacy)', async () => {
    await renderBar({
      activeTabTitle: 'Top Secret Security Audit Report',
      activeModelName: 'Claude 3.5 Sonnet',
      maskTitle: true,
      showCustomControls: true,
      models: DEFAULT_MODELS,
      activeModelKey: 'claude',
      onSelectModel: () => {}
    })

    expect(container.textContent).toContain('NEXUS')
    expect(container.textContent).not.toContain('Top Secret Security Audit Report')
    expect(container.textContent).toContain('Nexus')
  })

  it('invokes window controls on button clicks', async () => {
    await renderBar({
      activeTabTitle: 'Active Chat',
      showCustomControls: true,
      models: DEFAULT_MODELS,
      activeModelKey: 'gemini',
      onSelectModel: () => {}
    })

    const minBtn = container.querySelector('button[aria-label="Minimize window"]') as HTMLButtonElement
    const maxBtn = container.querySelector('button[aria-label="Maximize window"]') as HTMLButtonElement
    const closeBtn = container.querySelector('button[aria-label="Close window"]') as HTMLButtonElement

    expect(minBtn).toBeTruthy()
    expect(maxBtn).toBeTruthy()
    expect(closeBtn).toBeTruthy()

    minBtn.click()
    expect(mockWindowControls.minimize).toHaveBeenCalledTimes(1)

    maxBtn.click()
    expect(mockWindowControls.maximizeToggle).toHaveBeenCalledTimes(1)

    closeBtn.click()
    expect(mockWindowControls.close).toHaveBeenCalledTimes(1)
  })

  it('updates maximize icon reactively when push event arrives', async () => {
    await renderBar({
      activeTabTitle: 'Active Chat',
      showCustomControls: true,
      models: DEFAULT_MODELS,
      activeModelKey: 'gemini',
      onSelectModel: () => {}
    })

    expect(container.querySelector('button[aria-label="Maximize window"]')).toBeTruthy()

    // Trigger event-driven maximize state push
    await act(async () => {
      maximizedChangeCallback?.(true)
    })

    expect(container.querySelector('button[aria-label="Restore window"]')).toBeTruthy()
  })

  it('cleans up push event listener on unmount (zero leak)', async () => {
    await renderBar({
      activeTabTitle: 'Active Chat',
      showCustomControls: true,
      models: DEFAULT_MODELS,
      activeModelKey: 'gemini',
      onSelectModel: () => {}
    })

    expect(mockWindowControls.onMaximizedChange).toHaveBeenCalledTimes(1)

    await act(async () => {
      root.unmount()
    })

    expect(cleanupMock).toHaveBeenCalledTimes(1)
  })

  it('invokes onOpenDiagnostics when diagnostics button is clicked', async () => {
    const onOpenDiagnostics = vi.fn()
    await renderBar({
      activeTabTitle: 'Active Chat',
      models: DEFAULT_MODELS,
      activeModelKey: 'gemini',
      onSelectModel: () => {},
      onOpenDiagnostics
    })

    const diagBtn = container.querySelector('button[aria-label="Open System Diagnostics"]') as HTMLButtonElement
    expect(diagBtn).toBeTruthy()
    diagBtn.click()
    expect(onOpenDiagnostics).toHaveBeenCalledTimes(1)
  })

  it('omits custom control buttons on Windows to prevent duplicate caption controls', async () => {
    ;(window as any).electron.platform = 'win32'

    await renderBar({
      activeTabTitle: 'Windows Chat',
      models: DEFAULT_MODELS,
      activeModelKey: 'gemini',
      onSelectModel: () => {}
    })

    expect(container.querySelector('button[aria-label="Minimize window"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Maximize window"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Close window"]')).toBeNull()
  })

  // Auto-Hide Mode Tests (Task 4)
  describe('Auto-Hide Mode', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.clearAllTimers()
      vi.useRealTimers()
    })

    it('renders inert attribute when retracted in autoHideMode', async () => {
      await renderBar({
        autoHideMode: true,
        models: DEFAULT_MODELS,
        activeModelKey: 'gemini',
        onSelectModel: () => {}
      })

      const header = container.querySelector('header')!
      expect(header.hasAttribute('inert') || (header as any).inert).toBeTruthy()
      expect(header.className).toContain('autohide')
      expect(header.className).not.toContain('revealed')
    })

    it('reveals titlebar after 150ms dwell and cancels inert', async () => {
      await renderBar({
        autoHideMode: true,
        models: DEFAULT_MODELS,
        activeModelKey: 'gemini',
        onSelectModel: () => {}
      })

      const header = container.querySelector('header')!

      // Mouse reaches top 4px
      await act(async () => {
        window.dispatchEvent(new MouseEvent('mousemove', { clientY: 2 }))
      })

      // Before dwell expires: still retracted
      expect(header.className).not.toContain('revealed')

      // Advance past 150ms dwell
      await act(async () => {
        vi.advanceTimersByTime(160)
      })

      expect(header.className).toContain('revealed')
      expect(header.hasAttribute('inert') || (header as any).inert).toBeFalsy()
    })

    it('toggles reveal state via Alt+Shift+T keyboard shortcut', async () => {
      await renderBar({
        autoHideMode: true,
        models: DEFAULT_MODELS,
        activeModelKey: 'gemini',
        onSelectModel: () => {}
      })

      const header = container.querySelector('header')!
      expect(header.className).not.toContain('revealed')

      // Press Alt+Shift+T
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', altKey: true, shiftKey: true }))
      })

      expect(header.className).toContain('revealed')

      // Press again to toggle off
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', altKey: true, shiftKey: true }))
      })

      expect(header.className).not.toContain('revealed')
    })
  })
})
