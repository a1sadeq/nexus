import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PreviewCaptureLoop } from './previewCaptureLoop'

describe('Phase 3 Optimization: View Resize & Capture Lifecycle', () => {
  describe('resize_view view bounds coalescing', () => {
    it('sets bounds on active view only and records lastRealBounds without thrashing inactive views', () => {
      const setBoundsMockActive = vi.fn()
      const setBoundsMockInactive1 = vi.fn()
      const setBoundsMockInactive2 = vi.fn()
      const setVisibleMockActive = vi.fn()
      const setVisibleMockInactive1 = vi.fn()
      const setVisibleMockInactive2 = vi.fn()

      const activeView = {
        webContents: { isDestroyed: () => false },
        getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
        setBounds: setBoundsMockActive,
        setVisible: setVisibleMockActive
      }

      const inactiveView1 = {
        webContents: { isDestroyed: () => false },
        getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
        setBounds: setBoundsMockInactive1,
        setVisible: setVisibleMockInactive1
      }

      const inactiveView2 = {
        webContents: { isDestroyed: () => false },
        getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
        setBounds: setBoundsMockInactive2,
        setVisible: setVisibleMockInactive2
      }

      const aiViews = new Map([
        ['tab-active', activeView],
        ['tab-inactive-1', inactiveView1],
        ['tab-inactive-2', inactiveView2]
      ])

      const activeViewId = 'tab-active'
      const lastRealBounds = new Map<string, { x: number; y: number; width: number; height: number }>()
      let themeTimer: NodeJS.Timeout | null = null
      const themedViews: string[] = []

      // Simulate the optimized handler
      const handleResizeView = (bounds: { x: number; y: number; width: number; height: number }) => {
        const hidden = bounds.width === 0 && bounds.height === 0
        if (hidden) {
          for (const [, v] of aiViews) v.setVisible(false)
          return
        }

        // Cache real bounds for all views
        for (const [tabId] of aiViews) {
          lastRealBounds.set(tabId, bounds)
        }

        const currentActive = activeViewId ? aiViews.get(activeViewId) : null
        if (currentActive && !currentActive.webContents.isDestroyed()) {
          const prev = currentActive.getBounds()
          if (prev.x !== bounds.x || prev.y !== bounds.y || prev.width !== bounds.width || prev.height !== bounds.height) {
            currentActive.setBounds(bounds)
          }
          currentActive.setVisible(true)

          if (Math.abs(prev.width - bounds.width) > 1 || Math.abs(prev.height - bounds.height) > 1) {
            if (themeTimer) clearTimeout(themeTimer)
            themeTimer = setTimeout(() => {
              if (activeViewId) themedViews.push(activeViewId)
            }, 120)
          }
        }

        for (const [tabId, v] of aiViews) {
          if (tabId !== activeViewId && !v.webContents.isDestroyed()) {
            v.setVisible(false)
          }
        }
      }

      const newBounds = { x: 0, y: 36, width: 1200, height: 900 }
      handleResizeView(newBounds)

      // Active view receives setBounds
      expect(setBoundsMockActive).toHaveBeenCalledWith(newBounds)
      expect(setVisibleMockActive).toHaveBeenCalledWith(true)

      // Inactive views DO NOT receive setBounds during window resize
      expect(setBoundsMockInactive1).not.toHaveBeenCalled()
      expect(setBoundsMockInactive2).not.toHaveBeenCalled()

      // Inactive views remain hidden
      expect(setVisibleMockInactive1).toHaveBeenCalledWith(false)
      expect(setVisibleMockInactive2).toHaveBeenCalledWith(false)

      // lastRealBounds recorded for all views
      expect(lastRealBounds.get('tab-active')).toEqual(newBounds)
      expect(lastRealBounds.get('tab-inactive-1')).toEqual(newBounds)
      expect(lastRealBounds.get('tab-inactive-2')).toEqual(newBounds)
    })
  })

  describe('previewCaptureLoop with window focus & blur', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('pauses captures when window loses focus and resumes on focus', async () => {
      let isFocused = true
      let isVisible = true
      let isMinimized = false

      const canCapture = () => isVisible && !isMinimized && isFocused
      const capture = vi.fn().mockResolvedValue('frame-data')
      const publish = vi.fn()

      const loop = new PreviewCaptureLoop({
        intervalMs: 1000,
        canCapture,
        capture,
        publish
      })

      loop.start('tab-1')
      await vi.advanceTimersByTimeAsync(0)
      expect(capture).toHaveBeenCalledTimes(1)
      expect(publish).toHaveBeenCalledWith('frame-data')

      // Window loses focus (blur)
      isFocused = false
      loop.stop() // Mirror mainWindow blur listener
      await vi.advanceTimersByTimeAsync(3000)
      expect(capture).toHaveBeenCalledTimes(1) // No new captures while blurred

      // Window regains focus
      isFocused = true
      loop.start('tab-1') // Mirror mainWindow focus listener
      await vi.advanceTimersByTimeAsync(0)
      expect(capture).toHaveBeenCalledTimes(2)
      loop.stop()
    })
  })
})
