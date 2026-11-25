import React, { useCallback, useEffect, useRef, useState } from 'react'
import LogsPanel from './LogsPanel'

/**
 * Settings › Navigation Trace.
 *
 * The log reader itself lives in `LogsPanel` and is shared with the Logs tab in the Diagnostics
 * pop-up, so there is one component and one buffer. What is specific to this screen is the table
 * underneath: what the main process believes each tab is doing *right now* (loading, sleeping, how many
 * listeners its webContents has). That is a different question from "what happened", and it is the one
 * that shows a leak before it becomes a bug.
 */

interface NavTraceTab {
  tabId: string
  url: string
  modelKey: string
  title: string
  active: boolean
  loading: boolean
  evicted: boolean
  pendingNavigation: string
  listeners: { stopLoading: number; failLoad: number; startNavigation: number } | null
  lastEvent: { seq: number; kind: string; message: string; t: number } | null
}

interface NavTraceResult {
  success: boolean
  tabs?: NavTraceTab[]
}

export const NavigationTraceSection: React.FC = () => {
  const [tabs, setTabs] = useState<NavTraceTab[]>([])
  const mounted = useRef(true)

  const fetchTabs = useCallback(async () => {
    try {
      const bridge = window.electron?.navigationTrace?.get
      const res = (await (bridge
        ? bridge({ limit: 1, includeText: false })
        : window.electron?.ipcRenderer?.invoke?.('nav_trace_get', {
            limit: 1,
            includeText: false
          }))) as NavTraceResult | undefined
      if (mounted.current && res?.success) setTabs(res.tabs || [])
    } catch {
      /* the panel is diagnostic; a failed poll must not throw */
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void fetchTabs()
    const timer = setInterval(() => void fetchTabs(), 2000)
    return () => {
      mounted.current = false
      clearInterval(timer)
    }
  }, [fetchTabs])

  return (
    <div className="flex flex-col gap-4">
      <LogsPanel compact height={340} />

      <div
        className="rounded-xl border overflow-hidden"
        style={{ background: 'var(--surface, #13171d)', borderColor: 'var(--border, rgba(255,255,255,0.08))' }}
      >
        <div className="px-3 py-2 text-xs font-semibold text-slate-300 border-b border-white/5">
          Live tab state
        </div>
        <table className="w-full text-left text-[11px] border-collapse">
          <thead>
            <tr className="border-b border-white/5 bg-white/5 text-slate-400 font-semibold">
              <th className="py-2 px-3">Tab</th>
              <th className="py-2 px-3">Provider</th>
              <th className="py-2 px-3">State</th>
              <th className="py-2 px-3">Pending navigation</th>
              <th className="py-2 px-3">Last line</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {tabs.map((tab) => (
              <tr key={tab.tabId} className={tab.active ? 'bg-emerald-500/5' : ''}>
                <td className="py-2 px-3 font-mono text-slate-300">
                  {tab.active ? '● ' : ''}
                  {tab.tabId}
                </td>
                <td className="py-2 px-3">{tab.modelKey || '—'}</td>
                <td className="py-2 px-3">
                  {tab.evicted && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/25 mr-1">
                      sleeping
                    </span>
                  )}
                  {tab.loading ? (
                    <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/25">
                      loading
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded bg-white/5 text-slate-400 border border-white/10">
                      idle
                    </span>
                  )}
                  {tab.listeners && tab.listeners.stopLoading > 10 && (
                    <span
                      className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/25 ml-1"
                      title="More listeners than a view should have — a leak"
                    >
                      {tab.listeners.stopLoading} listeners
                    </span>
                  )}
                </td>
                <td className="py-2 px-3 font-mono text-[10px] text-slate-400 break-all">
                  {tab.pendingNavigation || '—'}
                </td>
                <td className="py-2 px-3 text-slate-400">
                  {tab.lastEvent ? `${tab.lastEvent.kind} · ${tab.lastEvent.message}` : '—'}
                </td>
              </tr>
            ))}
            {tabs.length === 0 && (
              <tr>
                <td className="py-3 px-3 text-slate-500" colSpan={5}>
                  No AI views open.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default NavigationTraceSection
