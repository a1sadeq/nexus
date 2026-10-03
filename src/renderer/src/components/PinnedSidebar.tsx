import React from 'react'
import { Tab } from '../lib/tabs'
import { BRAND_IDS, modelLabel } from '../lib/modelVisuals'
import { BrandIcon, IconPin, IconPlus } from './BrandIcons'

interface Props {
  tabs: Tab[]
  pinnedIds: string[]
  activeId: string | null
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  draggedTabId: string | null
  handleDragStart: (e: React.DragEvent, id: string) => void
  handleDragOver: (e: React.DragEvent) => void
  handleDropOnTab: (e: React.DragEvent, id: string) => void
  handleDropOnContainer: (e: React.DragEvent, targetIsPinned: boolean) => void
  switchToTab: (id: string, url: string) => void
  togglePin: (id: string) => void
  colorFor: (key: string) => string
  handleOpenNewTabModal: () => void
}

export default function PinnedSidebar({
  tabs,
  pinnedIds,
  activeId,
  sidebarCollapsed,
  toggleSidebar,
  draggedTabId,
  handleDragStart,
  handleDragOver,
  handleDropOnTab,
  handleDropOnContainer,
  switchToTab,
  togglePin,
  colorFor,
  handleOpenNewTabModal
}: Props) {
  const pinnedTabs = tabs.filter((t) => pinnedIds.includes(t.id))

  return (
    <div
      className={`${
        sidebarCollapsed ? 'w-16' : 'w-52 md:w-64'
      } bg-(--surface) border-r border-(--border) flex flex-col shadow-lg z-20 shrink-0 transition-[width] duration-300 ease-in-out overflow-hidden`}
    >
      <button
        onClick={toggleSidebar}
        title={sidebarCollapsed ? 'Expand Pinned Chats' : 'Collapse Pinned Chats'}
        className={`p-4 border-b border-(--border) text-(--text2) text-xs font-bold uppercase tracking-widest flex items-center transition-colors hover:text-(--text) ${
          sidebarCollapsed ? 'justify-center' : 'justify-between'
        }`}
      >
        <div className="flex items-center gap-2">
          <IconPin size={14} className={sidebarCollapsed ? '' : 'text-(--accent)'} />
          {!sidebarCollapsed && <span>Pinned Chats</span>}
        </div>
        {!sidebarCollapsed && (
          <span className="text-[10px] opacity-60 font-mono">{pinnedTabs.length}</span>
        )}
      </button>

      <div
        className={`flex flex-col p-2 gap-1 overflow-y-auto flex-1 sidebar-chat-tabs custom-scrollbar ${
          sidebarCollapsed ? 'items-center' : ''
        }`}
        onDragOver={handleDragOver}
        onDrop={(e) => handleDropOnContainer(e, true)}
      >
        {pinnedTabs.map((t) =>
          sidebarCollapsed ? (
            <button
              key={t.id}
              className={`group relative flex items-center justify-center w-11 h-11 rounded-[6px] cursor-pointer transition-all duration-200 hud-bracket ${
                activeId === t.id
                  ? 'bg-(--border) border border-(--accent)/60 shadow-[0_0_12px_rgba(0,229,255,0.4)]'
                  : 'hover:bg-(--border) border border-transparent'
              } ${draggedTabId === t.id ? 'opacity-30' : 'opacity-100'}`}
              draggable
              onDragStart={(e) => handleDragStart(e, t.id)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDropOnTab(e, t.id)}
              onClick={(e) => {
                e.currentTarget.blur()
                if (t.url) switchToTab(t.id, t.url)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                togglePin(t.id)
              }}
              title={`${t.title || 'Pinned Chat'} (${modelLabel(t.model)}) — right-click to unpin`}
            >
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-transform group-hover:scale-110"
                style={{
                  background: `color-mix(in srgb, ${colorFor(t.model)} 25%, var(--surface2))`,
                  border: `1px solid color-mix(in srgb, ${colorFor(t.model)} 60%, transparent)`,
                  boxShadow: `0 0 10px ${colorFor(t.model)}`
                }}
              >
                {BRAND_IDS[t.model] && (
                  <BrandIcon
                    id={t.model}
                    size={20}
                    style={{
                      color: colorFor(t.model),
                      filter: `drop-shadow(0 0 4px ${colorFor(t.model)})`
                    }}
                  />
                )}
              </div>
            </button>
          ) : (
            <div
              key={t.id}
              className={`group relative flex items-center gap-3 p-2 rounded-[6px] cursor-pointer transition-all duration-200 hud-bracket ${
                activeId === t.id
                  ? 'bg-(--border) border border-(--accent)/60 shadow-[0_0_12px_rgba(0,229,255,0.4)]'
                  : 'hover:bg-(--border) border border-transparent'
              } ${draggedTabId === t.id ? 'opacity-30' : 'opacity-100'}`}
              draggable
              onDragStart={(e) => handleDragStart(e, t.id)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDropOnTab(e, t.id)}
              onClick={() => {
                if (t.url) switchToTab(t.id, t.url)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                togglePin(t.id)
              }}
              title="Right-click to unpin"
            >
              <div className="flex flex-col items-center gap-1 shrink-0 w-12">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center transition-transform group-hover:scale-110"
                  style={{
                    background: `color-mix(in srgb, ${colorFor(t.model)} 25%, var(--surface2))`,
                    border: `1px solid color-mix(in srgb, ${colorFor(t.model)} 60%, transparent)`,
                    boxShadow: `0 0 10px ${colorFor(t.model)}`
                  }}
                >
                  {BRAND_IDS[t.model] && (
                    <BrandIcon
                      id={t.model}
                      size={22}
                      style={{
                        color: colorFor(t.model),
                        filter: `drop-shadow(0 0 4px ${colorFor(t.model)})`
                      }}
                    />
                  )}
                </div>
                <span className="text-[10px] leading-none text-(--text2) truncate max-w-[50px]">
                  {modelLabel(t.model)}
                </span>
              </div>

              <div className="flex-1 min-w-0 pr-6">
                <div
                  className="text-base font-semibold text-(--text) truncate"
                  style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}
                >
                  {t.title || 'Pinned Chat'}
                </div>
                <div className="text-xs text-(--text2) uppercase tracking-wider mt-0.5">
                  {modelLabel(t.model)}
                </div>
              </div>

              <button
                className="absolute right-2 opacity-0 group-hover:opacity-100 text-(--text2) hover:text-(--accent) transition-opacity p-1"
                onClick={(e) => {
                  e.stopPropagation()
                  togglePin(t.id)
                }}
                title="Unpin"
              >
                <IconPin size={13} />
              </button>
            </div>
          )
        )}
        {pinnedTabs.length === 0 && !sidebarCollapsed && (
          <div className="flex flex-col items-center justify-center gap-2 px-3 py-6 text-center">
            <IconPin size={22} className="text-(--text2)/40" />
            <p className="text-[11px] text-(--text2)/70 leading-relaxed font-medium">
              No pinned chats
            </p>
            <p className="text-[10px] text-(--text2)/50 leading-relaxed">
              Right-click a tab
              <br />
              to pin it here
            </p>
          </div>
        )}
      </div>

      <div className="p-2 border-t border-(--border) flex items-center justify-around gap-1 bg-(--surface2)/50">
        <button
          type="button"
          onClick={handleOpenNewTabModal}
          className={`p-2 rounded-lg text-(--text2) hover:text-(--text) hover:bg-(--border) transition-all flex items-center gap-2 ${
            sidebarCollapsed ? 'justify-center w-full' : 'flex-1'
          }`}
          title="New Chat (Ctrl+T)"
        >
          <IconPlus size={14} />
          {!sidebarCollapsed && <span className="text-xs font-semibold">New Chat</span>}
        </button>
      </div>
    </div>
  )
}
