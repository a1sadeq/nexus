import { useState, useRef, useEffect, useMemo, type ReactElement } from 'react'
import type { Tab } from '../lib/tabs'
import { getProviderGradient } from '../lib/modelVisuals'
import { providerColorFor } from '../lib/providerVisuals'
import { IconX, IconPin } from './BrandIcons'
import ProviderIcon from './ProviderIcon'
import { normaliseHexColor } from '../lib/tabColors'
import { partitionTabSections, type TabSections } from '../lib/tabSections'
import { AiStatusBadge } from './AiStatusBadge'
import { formatCollapsedTitle, type TabAiStatus } from '../lib/tabStatus'
import './VerticalTabs.css'

interface Props {
  /** Anchor for the first-run guide: the chat list is the thing a new user has to find first. */
  'data-guide'?: string
  tabs: Tab[]
  activeId: string | null
  pinnedIds?: string[]
  tabStatuses?: Record<string, TabAiStatus>
  residentTabIds?: string[]
  discardedTabIds?: string[]
  sidebarCollapsed: boolean
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onTogglePin: (id: string) => void
  onReorder?: (sourceId: string, targetId: string) => void
  modelColors?: Record<string, string>
  /** Configured per-provider SVG markup, keyed by provider key. */
  modelIcons?: Record<string, string>
  /**
   * Render pinned tabs as their own section above Active Sessions instead of sorting them to
   * the top of that list. The caller decides, because the same list is also drawn at the bottom
   * of the window and in the pinned sidebar.
   */
  pinnedSection?: boolean
  /**
   * Per-tab container mark: the colour dot and the name that make a tab's container obvious without
   * opening it. Missing entries simply draw nothing (default container with no colour).
   */
  containerMarks?: Record<string, { color?: string; name: string; isDefault: boolean }>
  /**
   * The digit that reaches each tab with `Ctrl+N`. Pinned tabs take 1…n and the rest continue, so
   * the number in the list matches the key, the way the badge on the tab does.
   */
  tabNumbers?: Record<string, number>
}

export default function VerticalTabs({
  'data-guide': dataGuide,
  tabs,
  activeId,
  pinnedIds = [],
  tabStatuses = {},
  residentTabIds,
  discardedTabIds,
  sidebarCollapsed,
  onSelect,
  onClose,
  onTogglePin,
  onReorder,
  modelColors,
  modelIcons,
  pinnedSection = false,
  containerMarks,
  tabNumbers
}: Props): ReactElement {
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null)
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null)
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null)
  const [previewPos, setPreviewPos] = useState<{ top: number; left: number } | null>(null)
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Same resolver as Settings → AI Providers (lib/providerVisuals): configured colour, else brand.
  const dotColor = (key: string): string => modelColors?.[key] || providerColorFor(key)

  // The rule lives in lib/tabSections so the keyboard order and the rendered order cannot drift
  // apart, and so it can be tested without a DOM.
  const { pinned: pinnedTabs, active: activeTabs, discarded: discardedTabs, order: orderedTabs } =
    useMemo(
      (): TabSections =>
        partitionTabSections({
          tabs,
          activeId,
          pinnedIds,
          tabStatuses,
          residentTabIds,
          discardedTabIds,
          pinnedSection
        }),
      [tabs, activeId, pinnedIds, tabStatuses, residentTabIds, discardedTabIds, pinnedSection]
    )

  // Auto-scroll active tab into view
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const activeEl = el.querySelector<HTMLElement>(`[data-vertical-tab-id="${activeId}"]`)
    if (activeEl && typeof activeEl.scrollIntoView === 'function') {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [activeId])

  if (orderedTabs.length === 0) {
    return (
      <div className="text-(--text2) text-xs opacity-50 p-4 text-center italic select-none">
        No active tabs
      </div>
    )
  }

  const renderTab = (t: Tab, isSleeping: boolean): ReactElement => {
    const isActive = activeId === t.id
    const isPinned = pinnedIds.includes(t.id)
    const status = tabStatuses[t.id] || 'idle'
    // A tab that carries its own accent paints it — that is the whole point of the colour.
    const tabAccent = normaliseHexColor(t.accentColor)
    const color = tabAccent || dotColor(t.model)
    const gradient = tabAccent ? { start: tabAccent, end: tabAccent } : getProviderGradient(t.model, color)
    const isHovered = hoveredTabId === t.id
    const isDragging = draggingTabId === t.id
    const isDragOver = dragOverTabId === t.id

    return (
      <div
        key={t.id}
        data-vertical-tab-id={t.id}
        data-tab-sleeping={isSleeping ? 'true' : 'false'}
        role="tab"
        aria-selected={isActive}
        tabIndex={isActive ? 0 : -1}
        draggable={true}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/nexus-tab-id', t.id)
          setDraggingTabId(t.id)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          if (dragOverTabId !== t.id) setDragOverTabId(t.id)
        }}
        onDragLeave={() => {
          if (dragOverTabId === t.id) setDragOverTabId(null)
        }}
        onDrop={(e) => {
          e.preventDefault()
          const sourceId = e.dataTransfer.getData('text/nexus-tab-id')
          if (sourceId && sourceId !== t.id && onReorder) {
            onReorder(sourceId, t.id)
          }
          setDraggingTabId(null)
          setDragOverTabId(null)
        }}
        onDragEnd={() => {
          setDraggingTabId(null)
          setDragOverTabId(null)
        }}
        title={`${t.title || 'New Chat'} (${t.model})${containerMarks?.[t.id] ? ` · ${containerMarks[t.id].name}` : ''} ${isSleeping ? '— Sleeping / Hibernated (click to wake)' : ''} — Right-click to ${isPinned ? 'unpin' : 'pin'}`}
        style={
          // Every row carries its provider's colour, selected or not: the list is meant to read as a map of
          // what is open — Gemini teal, ChatGPT green, your own provider in its own accent — not as a
          // column of identical grey rows with coloured text inside.
          {
            '--provider-color': color,
            '--provider-gradient-start': gradient.start,
            '--provider-gradient-end': gradient.end
          } as React.CSSProperties
        }
        className={`group relative flex items-center justify-between rounded-lg cursor-pointer transition-all duration-150 border ${
          isActive
            ? 'vertical-tab-arc-reactor text-white shadow-lg font-semibold border-white/30'
            : isSleeping
              ? 'vertical-tab-provider vertical-tab-sleeping bg-(--surface)/40 border-white/5 text-(--text2) hover:text-(--text)'
              : 'vertical-tab-provider bg-(--surface2)/50 text-(--text)'
        } ${sidebarCollapsed ? 'px-2 py-1.5' : 'px-2.5 py-2'} ${
          isDragging ? 'opacity-40 border-dashed border-(--accent)' : ''
        } ${isDragOver ? 'border-t-2 border-t-(--accent) shadow-lg' : ''}`}
        onClick={() => onSelect(t.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          onTogglePin(t.id)
        }}
        onMouseEnter={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
          hoverTimerRef.current = setTimeout(() => {
            setHoveredTabId(t.id)
            setPreviewPos({ top: rect.top, left: rect.right + 8 })
          }, 350)
        }}
        onMouseLeave={() => {
          if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
          setHoveredTabId(null)
          setPreviewPos(null)
        }}
      >
        {/* Left: number, container mark, Brand Icon & Tab Title */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {tabNumbers?.[t.id] !== undefined && (
            <span
              className={`vertical-tab-number shrink-0${isActive ? ' is-active' : ''}`}
              title={`Press Ctrl+${tabNumbers[t.id]} to jump here`}
              aria-label={`Tab ${tabNumbers[t.id]}`}
            >
              {tabNumbers[t.id]}
            </span>
          )}
          {(() => {
            const mark = containerMarks?.[t.id]
            if (!mark || (mark.isDefault && !mark.color)) return null
            return (
              <span
                className="vertical-tab-container-dot shrink-0"
                style={
                  mark.color
                    ? { background: mark.color, boxShadow: `0 0 6px ${mark.color}` }
                    : { background: 'var(--text2)' }
                }
                title={`Container: ${mark.name}`}
                aria-label={`Container ${mark.name}`}
              />
            )
          })()}
          <ProviderIcon
            modelKey={t.model}
            customSvg={modelIcons?.[t.model]}
            color={color}
            size={16}
            active={isActive}
          />

          {/* Title representation: 13px font-semibold for active tabs with provider colors */}
          {sidebarCollapsed ? (
            <span
              className={`text-[11px] font-medium tracking-tight truncate leading-tight flex-1 min-w-0 ${
                isActive ? 'text-white font-semibold' : ''
              }`}
              style={!isActive ? { color } : undefined}
            >
              {formatCollapsedTitle(t.title, 4)}
            </span>
          ) : (
            <span
              className={`tracking-tight truncate flex-1 min-w-0 ${
                isSleeping
                  ? 'text-xs font-normal'
                  : 'text-[13px] font-semibold leading-snug'
              }`}
              style={
                isActive
                  ? { color: '#ffffff' }
                  : { color: isSleeping ? `color-mix(in srgb, ${color} 70%, var(--text2))` : color }
              }
            >
              {t.title || 'New Chat'}
            </span>
          )}
        </div>

        {/* Right: Herdr AI Status Indicator & Actions */}
        <div className="flex items-center gap-1.5 shrink-0 ml-1">
          {/* Active Arc-Reactor Core Dot */}
          {isActive && (
            <span className="vertical-tab-active-core-dot shrink-0" aria-hidden="true" />
          )}

          {/* Sleeping Moon Indicator */}
          {isSleeping && (
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-(--text2)/60 shrink-0"
              aria-label="Sleeping to save RAM"
            >
              <title>Sleeping to save RAM</title>
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
            </svg>
          )}

          {/* Herdr status badge (working spin, waiting-input amber pulse, done green dot) */}
          <AiStatusBadge status={status} modelColor={color} />

          {/* Pinned Icon Indicator */}
          {isPinned && !sidebarCollapsed && (
            <IconPin size={11} className="text-(--accent) opacity-80" />
          )}

          {/* Close Button on Hover */}
          <button
            type="button"
            aria-label={`Close tab ${t.title || 'New Chat'}`}
            className="opacity-0 group-hover:opacity-100 hover:bg-(--border) p-0.5 rounded text-(--text2) hover:text-(--text) transition-opacity shrink-0 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation()
              onClose(t.id)
            }}
          >
            <IconX size={12} />
          </button>
        </div>

        {/* Hover snapshot preview floating beside the sidebar */}
        {isHovered && previewPos && t.thumbnail && (
          <div
            style={{
              position: 'fixed',
              top: Math.max(10, Math.min(window.innerHeight - 170, previewPos.top - 20)),
              left: previewPos.left
            }}
            className="w-56 h-36 bg-(--bg) rounded-lg shadow-2xl border border-(--border) z-50 overflow-hidden pointer-events-none animate-in fade-in zoom-in-95 duration-150"
          >
            <img
              src={t.thumbnail}
              alt="Tab preview"
              className="w-full h-full object-cover opacity-90"
            />
            <div className="absolute inset-0 ring-1 ring-inset ring-white/10 rounded-lg pointer-events-none" />
            <div className="absolute bottom-0 inset-x-0 bg-black/75 backdrop-blur-xs p-1.5 text-[10px] text-white truncate">
              {t.title || 'New Chat'}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      data-guide={dataGuide}
      className="flex flex-col gap-1 w-full px-2 py-1 overflow-y-auto overflow-x-hidden flex-1 select-none focus:outline-none"
      role="tablist"
      aria-label="Browser Tabs"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const navList = activeTabs.length > 0 ? activeTabs : orderedTabs
          const currentIdx = navList.findIndex((t) => t.id === activeId)
          if (currentIdx === -1) return
          const nextIdx =
            e.key === 'ArrowDown'
              ? (currentIdx + 1) % navList.length
              : (currentIdx - 1 + navList.length) % navList.length
          onSelect(navList[nextIdx].id)
        }
      }}
    >
      {/* 0. PINNED SECTION — above Active Sessions, so the tabs you chose to keep sit where
          the eye lands first instead of below the fold. */}
      {pinnedSection && pinnedTabs.length > 0 && (
        <div className="flex flex-col gap-1" data-pinned-section="true">
          <div className="flex items-center justify-between px-2 pt-1 pb-1 text-[10px] font-mono font-bold tracking-wider uppercase text-amber-300/90 select-none">
            <div className="flex items-center gap-1.5">
              <IconPin size={10} className="text-amber-400" />
              {!sidebarCollapsed && <span>Pinned</span>}
            </div>
            {!sidebarCollapsed && (
              <span className="text-[9px] font-mono bg-amber-500/15 px-1.5 py-0.5 rounded text-amber-200/90">
                {pinnedTabs.length}
              </span>
            )}
          </div>
          {pinnedTabs.map((t) => renderTab(t, false))}
          <div className="border-t border-(--border)/60 my-1" />
        </div>
      )}

      {/* 1. ACTIVE SESSIONS SECTION */}
      {activeTabs.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between px-2 pt-1 pb-1 text-[10px] font-mono font-bold tracking-wider uppercase text-(--text2) select-none">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
              {!sidebarCollapsed && <span>Active Sessions</span>}
            </div>
            {!sidebarCollapsed && (
              <span className="text-[9px] font-mono bg-white/10 px-1.5 py-0.5 rounded text-white/80">
                {activeTabs.length}
              </span>
            )}
          </div>
          {activeTabs.map((t) => renderTab(t, false))}
        </div>
      )}

      {/* 2. SLEEPING / DISCARDED SECTION */}
      {discardedTabs.length > 0 && (
        <div className="flex flex-col gap-1 mt-2">
          <div className="border-t border-(--border)/60 my-1" />
          <div className="flex items-center justify-between px-2 pb-1 text-[10px] font-mono font-medium tracking-wider uppercase text-(--text2)/70 select-none">
            <div className="flex items-center gap-1.5">
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="opacity-60"
              >
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
              </svg>
              {!sidebarCollapsed && <span>Sleeping / Discarded</span>}
            </div>
            {!sidebarCollapsed && (
              <span className="text-[9px] font-mono bg-white/5 px-1.5 py-0.5 rounded text-white/50">
                {discardedTabs.length}
              </span>
            )}
          </div>
          {discardedTabs.map((t) => renderTab(t, true))}
        </div>
      )}
    </div>
  )
}
