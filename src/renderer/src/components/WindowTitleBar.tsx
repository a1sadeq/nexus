import { useEffect, useState, useCallback, useRef, type FC } from 'react'
import type { ModelDef } from '../lib/models'
import { ArcReactorIcon } from './BrandIcons'
import { TitlebarModelPillar } from './TitlebarModelPillar'
import './WindowTitleBar.css'

export interface WindowTitleBarProps {
  activeTabTitle?: string
  activeModelName?: string
  modelColor?: string
  maskTitle?: boolean
  showCustomControls?: boolean
  models?: ModelDef[]
  activeModelKey?: string
  onSelectModel?: (key: string) => void
  autoHideMode?: boolean
}

export const WindowTitleBar: FC<WindowTitleBarProps> = ({
  activeTabTitle,
  activeModelName,
  modelColor = 'var(--accent, #6366f1)',
  maskTitle = false,
  showCustomControls,
  models,
  activeModelKey = 'gemini',
  onSelectModel,
  autoHideMode = false
}) => {
  const [isMaximized, setIsMaximized] = useState(false)
  const [isRevealed, setIsRevealed] = useState(false)
  const isWindows = typeof window !== 'undefined' && window.electron?.platform === 'win32'
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Initialize maximize state once on mount and subscribe to push events
  useEffect(() => {
    let active = true

    // 1. Initial single-shot query
    window.electron?.windowControls?.isMaximized?.().then((max: boolean) => {
      if (active) setIsMaximized(Boolean(max))
    }).catch(() => {})

    // 2. Event-driven push listener (zero polling)
    const cleanup = window.electron?.windowControls?.onMaximizedChange?.((max: boolean) => {
      if (active) setIsMaximized(max)
    })

    return () => {
      active = false
      cleanup?.()
    }
  }, [])

  // Auto-hide window mousemove hover engine with 150ms dwell (Finding B1, B2)
  useEffect(() => {
    if (!autoHideMode) {
      setIsRevealed(false)
      return
    }

    let dwellTimer: ReturnType<typeof setTimeout> | null = null

    const handleMouseMove = (e: MouseEvent) => {
      // Cursor touches top 4px of the screen
      if (e.clientY <= 4) {
        if (!isRevealed && !dwellTimer) {
          dwellTimer = setTimeout(() => {
            setIsRevealed(true)
            dwellTimer = null
          }, 150)
        }
      } else if (e.clientY > 44 && dwellTimer) {
        // Fast cursor pass canceled
        clearTimeout(dwellTimer)
        dwellTimer = null
      }
    }

    window.addEventListener('mousemove', handleMouseMove, { passive: true })
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      if (dwellTimer) clearTimeout(dwellTimer)
    }
  }, [autoHideMode, isRevealed])

  // Keyboard shortcut Alt+Shift+T to toggle reveal (Finding L1)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault()
        setIsRevealed((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Cleanup leave timer on unmount (Finding M6)
  useEffect(() => {
    return () => {
      if (leaveTimerRef.current) {
        clearTimeout(leaveTimerRef.current)
        leaveTimerRef.current = null
      }
    }
  }, [])

  const handleMouseEnter = () => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current)
      leaveTimerRef.current = null
    }
    if (autoHideMode) setIsRevealed(true)
  }

  const handleMouseLeave = () => {
    if (!autoHideMode) return
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
    leaveTimerRef.current = setTimeout(() => {
      setIsRevealed(false)
      leaveTimerRef.current = null
    }, 300)
  }

  const handleMinimize = useCallback(() => {
    window.electron?.windowControls?.minimize()
  }, [])

  const handleMaximizeToggle = useCallback(() => {
    window.electron?.windowControls?.maximizeToggle()
  }, [])

  const handleClose = useCallback(() => {
    window.electron?.windowControls?.close()
  }, [])

  const displayTitle = maskTitle
    ? 'Nexus'
    : (activeTabTitle?.trim() || 'Nexus Workspace')

  // On Windows, native titleBarOverlay provides caption controls.
  // On other platforms, custom controls can be rendered if client-side decorations are active.
  const renderControls = showCustomControls !== undefined
    ? showCustomControls
    : !isWindows

  const isRetracted = autoHideMode && !isRevealed

  return (
    <header
      className={`nexus-inapp-titlebar drag-region ${autoHideMode ? 'autohide' : ''} ${isRevealed ? 'revealed' : ''}`}
      style={{
        paddingRight: isWindows ? '140px' : '0px'
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('.no-drag')) return
        handleMaximizeToggle()
      }}
      aria-label="Application title bar"
      inert={isRetracted ? true : undefined}
    >
      {/* Left: Brand Identity & Active Conversation Status */}
      <div className="flex items-center gap-3 px-3 h-full shrink-0">
        <div className="flex items-center gap-1.5 shrink-0">
          <ArcReactorIcon size={18} className="text-(--accent, #6366f1) shrink-0" />
          <span className="font-bold text-[11px] tracking-wider text-white uppercase font-mono">
            NEXUS
          </span>
        </div>

        {/* Conversation Title Pill (Docked on left, truncated, no-drag) */}
        <div
          className="nexus-titlebar-conv-pill"
          role="status"
          aria-live="polite"
          title={maskTitle ? 'Conversation title hidden (Privacy mode active)' : (activeTabTitle || 'Nexus Workspace')}
        >
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: modelColor }}
            aria-hidden="true"
          />
          <span className="truncate font-medium text-slate-200">
            {displayTitle}
          </span>
          {activeModelName && !maskTitle && (
            <span className="text-[10px] opacity-60 font-mono px-1 rounded bg-white/10 shrink-0">
              {activeModelName}
            </span>
          )}
        </div>
      </div>

      {/* Center: Always-Expanded AI Models Pillar */}
      <div className="flex-1 flex items-center justify-center min-w-0 px-2 pointer-events-none">
        {models && models.length > 0 && onSelectModel && (
          <div className="pointer-events-auto">
            <TitlebarModelPillar
              models={models}
              activeModelKey={activeModelKey}
              onSelectModel={onSelectModel}
            />
          </div>
        )}
      </div>

      {/* Right: Window Control Action Buttons (Non-Windows / CSD mode) */}
      {renderControls ? (
        <div className="no-drag flex items-center h-full shrink-0">
          <button
            type="button"
            onClick={handleMinimize}
            className="h-full px-3.5 flex items-center justify-center hover:bg-white/10 active:bg-white/15 text-slate-300 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-400"
            title="Minimize"
            aria-label="Minimize window"
          >
            <svg width="10" height="2" viewBox="0 0 10 2" fill="currentColor">
              <rect width="10" height="2" rx="1" />
            </svg>
          </button>

          <button
            type="button"
            onClick={handleMaximizeToggle}
            className="h-full px-3.5 flex items-center justify-center hover:bg-white/10 active:bg-white/15 text-slate-300 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-400"
            title={isMaximized ? 'Restore' : 'Maximize'}
            aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
          >
            {isMaximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
                <rect x="2.5" y="0.5" width="7" height="7" rx="0.5" />
                <path d="M0.5 2.5v7h7" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
                <rect x="0.5" y="0.5" width="9" height="9" rx="0.5" />
              </svg>
            )}
          </button>

          <button
            type="button"
            onClick={handleClose}
            className="h-full px-3.5 flex items-center justify-center hover:bg-[#e81123] active:bg-[#c90f1e] text-slate-300 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose-400"
            title="Close"
            aria-label="Close window"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <line x1="1" y1="1" x2="9" y2="9" />
              <line x1="9" y1="1" x2="1" y2="9" />
            </svg>
          </button>
        </div>
      ) : (
        <div className="w-2 shrink-0" aria-hidden="true" />
      )}
    </header>
  )
}

export default WindowTitleBar
