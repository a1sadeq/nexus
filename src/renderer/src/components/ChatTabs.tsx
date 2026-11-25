import { useEffect, useRef, useState } from 'react'
import { normaliseHexColor } from '../lib/tabColors'
import { providerColorFor } from '../lib/providerVisuals'
import { createPortal } from 'react-dom'
import type { Tab } from '../lib/tabs'
import { IconX } from './BrandIcons'
import ProviderIcon from './ProviderIcon'
import './ChatTabs.css'

interface Props {
  tabs: Tab[]
  activeId: string | null
  pinnedIds?: string[]
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onTogglePin: (id: string) => void
  modelColors?: Record<string, string>
  /** Configured per-provider SVG markup, keyed by provider key. */
  modelIcons?: Record<string, string>
  alwaysShowTitles?: boolean
  /** Per-tab container mark, so horizontal tabs identify their container too. */
  containerMarks?: Record<string, { color?: string; name: string; isDefault: boolean }>
  /**
   * The number printed on each tab: the digit `Ctrl+N` uses to reach it. Pinned tabs are numbered
   * from 1 and the rest continue, so the strip reads 1, 2, 3… from left to right.
   */
  tabNumbers?: Record<string, number>
}

export default function ChatTabs({
  tabs,
  activeId,
  pinnedIds = [],
  onSelect,
  onClose,
  onTogglePin,
  modelColors,
  modelIcons,
  containerMarks,
  tabNumbers,
  alwaysShowTitles = false
}: Props) {
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null)
  const [scrollState, setScrollState] = useState({ left: false, right: false })
  const [floatingTabId, setFloatingTabId] = useState<string | null>(null)
  const [floatingBounds, setFloatingBounds] = useState<DOMRect | null>(null)
  const showTimerRef = useRef<NodeJS.Timeout | null>(null)
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Same resolver as Settings → AI Providers (lib/providerVisuals): a configured colour wins, the
  // brand colour is the fallback, and the tabs never invent a third one.
  const dotColor = (key: string) => modelColors?.[key] || providerColorFor(key)
  // Per-tab accent, when the user gave this tab one.
  const tabColor = (tab: { accentColor?: string; model: string }): string =>
    normaliseHexColor(tab.accentColor) || dotColor(tab.model)

  const updateFades = () => {
    const el = scrollRef.current
    if (!el) return
    const canLeft = el.scrollLeft > 2
    const canRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    setScrollState({ left: canLeft, right: canRight })
  }

  // Auto-scroll active tab into view on select / new tab
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const target = el.querySelector<HTMLElement>(`[data-tab-id="${activeId}"]`)
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
    }
  }, [activeId, tabs.length])

  // Track fades on scroll + resize
  useEffect(() => {
    updateFades()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', updateFades, { passive: true })
    const ro = new ResizeObserver(updateFades)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', updateFades)
      ro.disconnect()
    }
  }, [tabs.length])

  if (tabs.length === 0) {
    return (
      <div className="text-(--text2) text-sm opacity-50 px-2 italic select-none">
        No active chats
      </div>
    )
  }

  const fadeClass = [
    'chat-tabs-scroller',
    scrollState.left ? 'fade-left' : '',
    scrollState.right ? 'fade-right' : ''
  ]
    .filter(Boolean)
    .join(' ')

  const sortedTabs = [...tabs].sort((a, b) => {
    const aPinned = pinnedIds.includes(a.id) ? 1 : 0
    const bPinned = pinnedIds.includes(b.id) ? 1 : 0
    if (aPinned !== bPinned) return bPinned - aPinned // Pinned first
    return 0
  })

  return (
    <>
    <div className={fadeClass} ref={scrollRef} data-tab-strip data-guide="tabs">
      {sortedTabs.map((t) => {
        const isPinned = pinnedIds.includes(t.id)
        const isActive = activeId === t.id
        const isHovered = hoveredTabId === t.id
        const isExpanded = alwaysShowTitles || isActive || isHovered || !isPinned

        return (
          <div
            key={t.id}
            data-tab-id={t.id}
            className="relative group flex items-center shrink chat-tab-wrap"
            onMouseEnter={(e) => {
              setHoveredTabId(t.id)
              const bounds = e.currentTarget.getBoundingClientRect()
              if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
              if (showTimerRef.current) clearTimeout(showTimerRef.current)
              showTimerRef.current = setTimeout(() => {
                setFloatingTabId(t.id)
                setFloatingBounds(bounds)
              }, 300)
            }}
            onMouseLeave={() => {
              setHoveredTabId(null)
              if (showTimerRef.current) clearTimeout(showTimerRef.current)
              hideTimerRef.current = setTimeout(() => {
                setFloatingTabId(null)
              }, 50)
            }}
          >
            <div
              data-active={isActive ? 'true' : undefined}
              className={`flex items-center gap-2 py-1.5 rounded-[4px] cursor-pointer transition-all duration-300 ease-in-out border chat-tab-pill ${
                isActive
                  ? 'bg-(--border) border-(--accent) shadow-sm tab-switch-pop px-3'
                  : 'bg-(--bg) border-transparent hover:bg-(--border) ' + (isExpanded ? 'px-3' : 'px-2')
              }`}
              onClick={() => {
                onSelect(t.id)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                onTogglePin(t.id)
              }}
              title={`${t.title || 'New Chat'}${containerMarks?.[t.id] ? ` · ${containerMarks[t.id].name}` : ''} — right-click to ${isPinned ? 'unpin' : 'pin'}`}
            >
              {tabNumbers?.[t.id] !== undefined && (
                <span
                  className={`chat-tab-number${isActive ? ' is-active' : ''}`}
                  title={`${tabNumbers[t.id]} — press Ctrl+${tabNumbers[t.id]} to jump here`}
                  aria-label={`Tab ${tabNumbers[t.id]}`}
                >
                  {tabNumbers[t.id]}
                </span>
              )}
              {containerMarks?.[t.id] && !(containerMarks[t.id].isDefault && !containerMarks[t.id].color) && (
                <span
                  className="chat-tab-container-dot shrink-0 mr-1"
                  style={{
                    background: containerMarks[t.id].color ?? 'var(--text2)',
                    boxShadow: containerMarks[t.id].color ? `0 0 6px ${containerMarks[t.id].color}` : undefined
                  }}
                  title={`Container: ${containerMarks[t.id].name}`}
                  aria-label={`Container ${containerMarks[t.id].name}`}
                />
              )}
              <ProviderIcon
                modelKey={t.model}
                customSvg={modelIcons?.[t.model]}
                color={tabColor(t)}
                size={14}
                active={isActive}
              />
              
              <div 
                className={`overflow-hidden transition-all duration-300 ease-in-out flex items-center ${isExpanded ? 'max-w-[360px] opacity-100 ml-1' : 'max-w-0 opacity-0 ml-0'}`}
              >
                <span className="text-sm font-medium text-(--text) truncate chat-tab-title">
                  {t.title || 'New Chat'}
                </span>
                
                {isPinned && !isActive && (
                  <svg className="ml-1 w-3 h-3 text-(--accent) shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                )}
              </div>

              {isExpanded && (
                <button
                  className="ml-1 opacity-0 group-hover:opacity-100 text-(--text2) hover:text-(--text) transition-opacity w-4 h-4 flex items-center justify-center rounded-full chat-tab-close-btn shrink-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose(t.id)
                  }}
                >
                  <IconX size={12} />
                </button>
              )}
            </div>

            {isHovered && t.thumbnail && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-48 h-32 bg-(--bg) rounded-lg shadow-xl border border-(--border) z-[100] overflow-hidden pointer-events-none transform scale-95 origin-top animate-in fade-in zoom-in duration-150">
                <img
                  src={t.thumbnail}
                  alt="Preview"
                  className="w-full h-full object-cover opacity-90"
                />
                <div className="absolute inset-0 ring-1 ring-inset ring-white/10 rounded-lg"></div>
              </div>
            )}
          </div>
        )
      })}
    </div>
      {floatingTabId && floatingBounds && createPortal(
        (() => {
          const t = tabs.find(tab => tab.id === floatingTabId)
          if (!t) return null
          
          return (
            <div
              className="tab-floating-overlay glowing-tab-wrapper shadow-xl"
              style={{
                top: floatingBounds.top,
                left: floatingBounds.left,
                minWidth: floatingBounds.width,
                maxWidth: '400px',
                height: floatingBounds.height,
                pointerEvents: 'auto'
              }}
              onMouseEnter={() => {
                if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
              }}
              onMouseLeave={() => {
                setFloatingTabId(null)
              }}
              onClick={() => {
                onSelect(t.id)
                setFloatingTabId(null)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                onTogglePin(t.id)
                setFloatingTabId(null)
              }}
            >
              <div className="glowing-tab-content px-3 py-1.5 gap-2 cursor-pointer w-full h-full flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <ProviderIcon
                    modelKey={t.model}
                    customSvg={modelIcons?.[t.model]}
                    color={tabColor(t)}
                    size={14}
                    active={activeId === t.id}
                  />
                  <span className="text-sm font-medium text-(--text) whitespace-nowrap overflow-hidden text-ellipsis max-w-full">
                    {t.title || 'New Chat'}
                  </span>
                </div>
                
                <button
                  className="ml-2 text-(--text2) hover:text-(--text) transition-opacity w-4 h-4 flex items-center justify-center rounded-full shrink-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose(t.id)
                    setFloatingTabId(null)
                  }}
                >
                  <IconX size={12} />
                </button>
              </div>
            </div>
          )
        })(),
        document.body
      )}
    </>
  )
}
