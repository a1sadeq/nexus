import { useState, useRef, useEffect, useMemo } from 'react'
import type { Tab } from '../lib/tabs'
import { BRAND_IDS, DOT_COLOR, getEffectiveProviderColor, getProviderGradient } from '../lib/modelVisuals'
import { BrandIcon, IconX, IconPin } from './BrandIcons'
import { AiStatusBadge } from './AiStatusBadge'
import { formatCollapsedTitle, type TabAiStatus } from '../lib/tabStatus'
import './VerticalTabs.css'

interface Props {
  tabs: Tab[]
  activeId: string | null
  pinnedIds?: string[]
  tabStatuses?: Record<string, TabAiStatus>
  residentTabIds?: string[]
  sidebarCollapsed: boolean
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onTogglePin: (id: string) => void
  onReorder?: (sourceId: string, targetId: string) => void
  modelColors?: Record<string, string>
}

export default function VerticalTabs({
  tabs,
  activeId,
  pinnedIds = [],
  tabStatuses = {},
  residentTabIds,
  sidebarCollapsed,
  onSelect,
  onClose,
  onTogglePin,
  onReorder,
  modelColors
}: Props) {
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null)
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null)
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null)
  const [previewPos, setPreviewPos] = useState<{ top: number; left: number } | null>(null)
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const dotColor = (key: string) =>
    modelColors?.[key] || getEffectiveProviderColor(key, DOT_COLOR[key] || '#888')

  // Partition into Active (Resident / In-Memory / Working) vs Sleeping / Discarded (Hibernated)
  const { activeTabs, discardedTabs } = useMemo(() => {
    const activeList: Tab[] = []
    const discardedList: Tab[] = []

    for (const tab of tabs) {
      const isCurrentlyActive = tab.id === activeId
      const isWorkingOrWaiting =
        tabStatuses[tab.id] === 'working' || tabStatuses[tab.id] === 'waiting-input'
      const isResident = residentTabIds
        ? residentTabIds.includes(tab.id)
        : isCurrentlyActive || pinnedIds.includes(tab.id)

      if (isCurrentlyActive || isWorkingOrWaiting || isResident) {
        activeList.push(tab)
      } else {
        discardedList.push(tab)
      }
    }

    const sortGroup = (list: Tab[]) => {
      const pinned = list.filter((t) => pinnedIds.includes(t.id))
      const unpinned = list.filter((t) => !pinnedIds.includes(t.id))
      return [...pinned, ...unpinned]
    }

    return {
      activeTabs: sortGroup(activeList),
      discardedTabs: sortGroup(discardedList)
    }
  }, [tabs, activeId, pinnedIds, tabStatuses, residentTabIds])

  const orderedTabs = useMemo(() => [...activeTabs, ...discardedTabs], [activeTabs, discardedTabs])

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

  const renderTab = (t: Tab, isSleeping: boolean) => {
    const isActive = activeId === t.id
    const isPinned = pinnedIds.includes(t.id)
    const status = tabStatuses[t.id] || 'idle'
    const color = dotColor(t.model)
    const gradient = getProviderGradient(t.model, color)
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
        title={`${t.title || 'New Chat'} (${t.model}) ${isSleeping ? '— Sleeping / Hibernated (click to wake)' : ''} — Right-click to ${isPinned ? 'unpin' : 'pin'}`}
        style={
          isActive
            ? ({
                '--provider-color': color,
                '--provider-gradient-start': gradient.start,
                '--provider-gradient-end': gradient.end
              } as React.CSSProperties)
            : undefined
        }
        className={`group relative flex items-center justify-between rounded-lg cursor-pointer transition-all duration-150 border ${
          isActive
            ? 'vertical-tab-arc-reactor text-white shadow-lg font-semibold border-white/30'
            : isSleeping
              ? 'vertical-tab-sleeping bg-(--surface)/40 hover:bg-(--surface2)/50 border-white/5 hover:border-white/15 text-(--text2) hover:text-(--text)'
              : 'bg-(--surface2)/50 hover:bg-(--surface2) border-white/10 hover:border-white/20 text-(--text)'
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
        {/* Left: Brand Icon & Tab Title */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div
            className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
            style={
              BRAND_IDS[t.model]
                ? { boxShadow: `0 0 6px ${color}` }
                : { background: color, boxShadow: `0 0 6px ${color}` }
            }
          >
            {BRAND_IDS[t.model] && (
              <BrandIcon id={t.model} size={11} className="text-(--text) drop-shadow-xs" />
            )}
          </div>

          {/* Title representation: 13px font-semibold for active tabs with provider colors */}
          {sidebarCollapsed ? (
            <span
              className={`text-[11px] font-medium tracking-tight truncate leading-tight flex-1 min-w-0 ${
                isActive ? 'text-white font-semibold' : ''
              }`}
              style={!isActive && !isSleeping ? { color } : undefined}
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
                  : !isSleeping
                    ? { color }
                    : undefined
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
