import React, { useEffect, useRef } from 'react'
import { BRAND_IDS, DOT_COLOR } from '../lib/modelVisuals'
import { BrandIcon, IconX } from './BrandIcons'

export interface AiNotificationItem {
  id: string
  tabId: string
  tabTitle: string
  model: string
  status: 'done' | 'waiting-input'
  snippet?: string
  timestamp: number
}

interface Props {
  notifications: AiNotificationItem[]
  onDismiss: (id: string) => void
  onSelectTab: (tabId: string) => void
}

export const AiNotificationToast: React.FC<Props> = ({
  notifications,
  onDismiss,
  onSelectTab
}) => {
  const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map())

  useEffect(() => {
    // Schedule auto-dismiss for any new notification
    notifications.forEach((item) => {
      if (!timersRef.current.has(item.id)) {
        const timer = setTimeout(() => {
          timersRef.current.delete(item.id)
          onDismiss(item.id)
        }, 7000)
        timersRef.current.set(item.id, timer)
      }
    })

    // Clean up timers for dismissed items
    const activeIds = new Set(notifications.map((n) => n.id))
    for (const [id, timer] of timersRef.current.entries()) {
      if (!activeIds.has(id)) {
        clearTimeout(timer)
        timersRef.current.delete(id)
      }
    }
  }, [notifications, onDismiss])

  if (!notifications || notifications.length === 0) return null

  return (
    <aside
      aria-label="AI Notifications"
      className="fixed bottom-6 right-6 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-auto select-none"
    >
      {notifications.map((item) => {
        const isWaitingInput = item.status === 'waiting-input'
        const color = DOT_COLOR[item.model] || '#10b981'

        return (
          <div
            key={item.id}
            role="alert"
            tabIndex={0}
            aria-live="polite"
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelectTab(item.tabId)
                onDismiss(item.id)
              }
            }}
            onClick={() => {
              onSelectTab(item.tabId)
              onDismiss(item.id)
            }}
            className={`group relative overflow-hidden rounded-xl border backdrop-blur-xl p-3.5 transition-all duration-200 cursor-pointer shadow-2xl hover:scale-[1.01] ${
              isWaitingInput
                ? 'bg-(--surface)/95 border-red-500/70 shadow-[0_8px_32px_rgba(220,38,38,0.35)]'
                : 'bg-(--surface)/95 border-(--accent)/50 shadow-[0_8px_32px_rgba(0,0,0,0.45)]'
            }`}
          >
            {/* Top row: Status indicator + Tab title + Close button */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {/* Status Dot */}
                {isWaitingInput ? (
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-80" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-600 shadow-[0_0_8px_rgba(220,38,38,1)] border border-amber-400" />
                  </span>
                ) : (
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.9)] border border-emerald-400/40" />
                  </span>
                )}

                {/* Model / Brand icon */}
                <div
                  className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                  style={
                    BRAND_IDS[item.model]
                      ? { boxShadow: `0 0 6px ${color}` }
                      : { background: color, boxShadow: `0 0 6px ${color}` }
                  }
                >
                  {BRAND_IDS[item.model] && (
                    <BrandIcon id={item.model} size={11} className="text-(--text) drop-shadow-xs" />
                  )}
                </div>

                {/* Title */}
                <span className="text-xs font-semibold text-(--text) truncate tracking-tight">
                  {item.tabTitle || 'AI Session'}
                </span>
              </div>

              {/* Status pill badge & Dismiss button */}
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                    isWaitingInput
                      ? 'bg-red-500/20 text-red-300 border-red-500/40'
                      : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  }`}
                >
                  {isWaitingInput ? 'Needs Input' : 'Done'}
                </span>

                <button
                  type="button"
                  aria-label="Dismiss notification"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDismiss(item.id)
                  }}
                  className="text-(--text2) hover:text-(--text) p-1 rounded-md hover:bg-(--surface2) transition-colors"
                >
                  <IconX size={12} />
                </button>
              </div>
            </div>

            {/* Snippet / message body */}
            <p className="mt-1.5 text-xs text-(--text2) line-clamp-2 leading-relaxed">
              {item.snippet
                ? item.snippet
                : isWaitingInput
                ? 'AI is waiting for your choice or confirmation.'
                : 'Finished generating response.'}
            </p>

            {/* Action footer */}
            <div className="mt-2.5 flex items-center justify-between text-[11px] text-(--accent)">
              <span className="font-medium group-hover:underline flex items-center gap-1">
                Switch to tab →
              </span>
              <span className="text-[10px] text-(--text2)/60">Click to view</span>
            </div>
          </div>
        )
      })}
    </aside>
  )
}
