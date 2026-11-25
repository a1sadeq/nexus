import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * The log reader.
 *
 * The first version of this was a table and a wall of JSON, which is technically a log viewer and
 * practically unusable: 300 lines where four lines matter. This one is built to answer a question —
 * "what moved this tab?" — at a glance:
 *
 *   · one row per event, in order, with sequence, relative time, a coloured kind chip and the tab;
 *   · repeats folded into `×N` (the trace itself folds them, so this only displays it);
 *   · a search box, kind filters and a tab filter, sticky so they never scroll away;
 *   · `data` collapsed to one line, expandable when it is what you need;
 *   · live tail that follows new events, with a pause.
 *
 * It reads the same store as the Settings panel (`nav_trace_get`), so there is one buffer, not two.
 */

interface LogEvent {
  seq: number
  at: number
  t: number
  tabId: string
  kind: string
  message: string
  data?: Record<string, unknown>
  count?: number
}

interface LogTab {
  tabId: string
  url: string
  modelKey: string
  title: string
  active: boolean
  loading: boolean
  evicted: boolean
  pendingNavigation: string
  lastEvent: { seq: number; kind: string; message: string; t: number } | null
}

interface LogResult {
  success: boolean
  verbose?: boolean
  events?: LogEvent[]
  tabs?: LogTab[]
  text?: string
}

const KIND_COLORS: Record<string, { fg: string; bg: string; border: string }> = {
  request: { fg: '#7dd3fc', bg: 'rgba(56,189,248,0.12)', border: 'rgba(56,189,248,0.34)' },
  load: { fg: '#a5b4fc', bg: 'rgba(129,140,248,0.13)', border: 'rgba(129,140,248,0.34)' },
  prog: { fg: '#f0abfc', bg: 'rgba(232,121,249,0.13)', border: 'rgba(232,121,249,0.36)' },
  abort: { fg: '#fda4af', bg: 'rgba(244,63,94,0.13)', border: 'rgba(244,63,94,0.36)' },
  settle: { fg: '#6ee7b7', bg: 'rgba(16,185,129,0.13)', border: 'rgba(16,185,129,0.34)' },
  event: { fg: '#cbd5e1', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.24)' },
  intent: { fg: '#fcd34d', bg: 'rgba(245,158,11,0.13)', border: 'rgba(245,158,11,0.34)' },
  view: { fg: '#d8b4fe', bg: 'rgba(168,85,247,0.13)', border: 'rgba(168,85,247,0.34)' },
  repair: { fg: '#fdba74', bg: 'rgba(249,115,22,0.13)', border: 'rgba(249,115,22,0.34)' },
  overlay: { fg: '#67e8f9', bg: 'rgba(6,182,212,0.13)', border: 'rgba(6,182,212,0.34)' },
  note: { fg: '#94a3b8', bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.18)' }
}

const KIND_ORDER = [
  'request',
  'prog',
  'load',
  'abort',
  'settle',
  'overlay',
  'view',
  'repair',
  'intent',
  'event',
  'note'
]

function kindColor(kind: string): { fg: string; bg: string; border: string } {
  return KIND_COLORS[kind] || KIND_COLORS.note
}

function dataText(data?: Record<string, unknown>): string {
  if (!data) return ''
  return Object.entries(data)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join('   ')
}

/** Buttons in this panel are always half-width pairs, like the Tab Colours button. */
const buttonBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '7px 10px',
  borderRadius: 9,
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  border: '1px solid rgba(255,255,255,0.10)',
  background: 'rgba(255,255,255,0.05)',
  color: 'var(--text, #e2e8f0)',
  transition: 'background 140ms ease, border-color 140ms ease, color 140ms ease'
}

const buttonGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 8
}

export interface LogsPanelProps {
  /** Inside the Diagnostics pop-up there is no room for the intro copy. */
  compact?: boolean
  /** Height of the scrolling log body. */
  height?: number
}

export const LogsPanel: React.FC<LogsPanelProps> = ({ compact = false, height = 420 }) => {
  const [result, setResult] = useState<LogResult | null>(null)
  const [live, setLive] = useState(true)
  const [query, setQuery] = useState('')
  const [selectedTab, setSelectedTab] = useState('')
  const [hiddenKinds, setHiddenKinds] = useState<string[]>([])
  const [expanded, setExpanded] = useState<number[]>([])
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [follow, setFollow] = useState(true)
  const mounted = useRef(true)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  const fetchTrace = useCallback(async () => {
    try {
      const bridge = window.electron?.navigationTrace?.get
      const res = (await (bridge
        ? bridge({ tabId: selectedTab || undefined, limit: 500, includeText: true })
        : window.electron?.ipcRenderer?.invoke?.('nav_trace_get', {
            tabId: selectedTab || undefined,
            limit: 500,
            includeText: true
          }))) as LogResult | undefined
      if (mounted.current && res?.success) setResult(res)
    } catch (err) {
      console.error('Failed to read the log buffer:', err)
    }
  }, [selectedTab])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    void fetchTrace()
  }, [fetchTrace])

  useEffect(() => {
    if (!live) return
    const timer = setInterval(() => void fetchTrace(), 1500)
    return () => clearInterval(timer)
  }, [live, fetchTrace])

  const events = result?.events || []
  const tabs = result?.tabs || []

  const counts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const event of events) map[event.kind] = (map[event.kind] || 0) + (event.count ?? 1)
    return map
  }, [events])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return events.filter((event) => {
      if (hiddenKinds.includes(event.kind)) return false
      if (!needle) return true
      const haystack = `${event.message} ${event.tabId} ${dataText(event.data)}`.toLowerCase()
      return haystack.includes(needle)
    })
  }, [events, hiddenKinds, query])

  // Follow the tail only when the reader has not scrolled away from it.
  useEffect(() => {
    if (!follow || !bodyRef.current) return
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [follow, visible.length])

  const toggleKind = (kind: string): void => {
    setHiddenKinds((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]))
  }

  const copy = async (): Promise<void> => {
    const text =
      result?.text ||
      visible
        .map(
          (event) =>
            `#${event.seq} +${event.t}ms ${event.kind} [${event.tabId || '—'}] ${event.message}${
              event.count && event.count > 1 ? ` ×${event.count}` : ''
            } ${dataText(event.data)}`
        )
        .join('\n')
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2200)
    } catch (err) {
      console.error('Failed to copy the log:', err)
    }
  }

  const toggleVerbose = async (): Promise<void> => {
    setBusy(true)
    try {
      const next = !(result?.verbose ?? false)
      const bridge = window.electron?.navigationTrace?.setVerbose
      await (bridge
        ? bridge(next)
        : window.electron?.ipcRenderer?.invoke?.('nav_trace_set_verbose', next))
      await fetchTrace()
    } finally {
      setBusy(false)
    }
  }

  const clear = async (): Promise<void> => {
    setBusy(true)
    try {
      const bridge = window.electron?.navigationTrace?.clear
      await (bridge ? bridge() : window.electron?.ipcRenderer?.invoke?.('nav_trace_clear'))
      setExpanded([])
      await fetchTrace()
    } finally {
      setBusy(false)
    }
  }

  const surface = 'var(--surface, #13171d)'
  const border = 'var(--border, rgba(255,255,255,0.08))'
  const dim = 'var(--text2, #94a3b8)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header card */}
      <div
        style={{
          borderRadius: 14,
          border: `1px solid ${border}`,
          background: `linear-gradient(160deg, rgba(34,211,238,0.07), transparent 55%), ${surface}`,
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: '1 1 220px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: live ? '#34d399' : '#64748b',
                  boxShadow: live ? '0 0 9px #34d39999' : 'none'
                }}
              />
              <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text, #f1f5f9)', margin: 0 }}>
                Logs
              </h3>
              <span
                style={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: 10,
                  padding: '1px 7px',
                  borderRadius: 999,
                  background: 'rgba(34,211,238,0.14)',
                  color: '#a5f3fc',
                  border: '1px solid rgba(34,211,238,0.28)'
                }}
              >
                {events.length} lines
              </span>
              {live && (
                <span style={{ fontSize: 10, color: '#6ee7b7', fontWeight: 600 }}>live</span>
              )}
            </div>
            {!compact && (
              <p style={{ fontSize: 11.5, color: dim, margin: '6px 0 0', lineHeight: 1.5 }}>
                Every navigation, in order: the request, the programmatic call that touched the tab and
                the line that made it, the abort, the repair. When a tab ignores the address bar, the
                line before the abort is the answer.
              </p>
            )}
          </div>

          {/* Two-wide buttons, same shape as the Tab Colours tile */}
          <div style={{ ...buttonGrid, flex: '0 1 300px', minWidth: 240 }}>
            <button
              type="button"
              onClick={() => setLive((v) => !v)}
              style={{
                ...buttonBase,
                ...(live
                  ? {
                      background: 'rgba(16,185,129,0.14)',
                      borderColor: 'rgba(16,185,129,0.34)',
                      color: '#6ee7b7'
                    }
                  : {})
              }}
              title={live ? 'Stop following new lines' : 'Follow new lines'}
            >
              {live ? '● Live' : 'Paused'}
            </button>
            <button
              type="button"
              onClick={() => void fetchTrace()}
              style={buttonBase}
              title="Read the buffer now"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void copy()}
              style={{ ...buttonBase, ...(copied ? { color: '#6ee7b7' } : {}) }}
              title="Copy the visible lines"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={() => void clear()}
              disabled={busy}
              style={{
                ...buttonBase,
                background: 'rgba(244,63,94,0.10)',
                borderColor: 'rgba(244,63,94,0.28)',
                color: '#fda4af'
              }}
              title="Empty the buffer (recording continues)"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => void toggleVerbose()}
              disabled={busy}
              style={{
                ...buttonBase,
                gridColumn: '1 / -1',
                ...(result?.verbose
                  ? { background: 'rgba(34,211,238,0.12)', borderColor: 'rgba(34,211,238,0.32)', color: '#a5f3fc' }
                  : {})
              }}
              title="Mirror every line to the terminal as well"
            >
              {result?.verbose ? 'Printing to console ✓' : 'Print to console'}
            </button>
          </div>
        </div>

        {/* Sticky filter bar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter lines — url, tab id, message…"
              style={{
                flex: '1 1 200px',
                minWidth: 160,
                padding: '7px 10px',
                borderRadius: 9,
                fontSize: 11.5,
                fontFamily: 'ui-monospace, monospace',
                background: 'rgba(0,0,0,0.28)',
                border: `1px solid ${border}`,
                color: 'var(--text, #e2e8f0)',
                outline: 'none'
              }}
            />
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11,
                color: dim,
                cursor: 'pointer',
                padding: '6px 9px',
                borderRadius: 9,
                border: `1px solid ${border}`,
                background: 'rgba(255,255,255,0.03)'
              }}
            >
              <input
                type="checkbox"
                checked={follow}
                onChange={(event) => setFollow(event.target.checked)}
                style={{ accentColor: '#22d3ee' }}
              />
              follow tail
            </label>
            <select
              value={selectedTab}
              onChange={(event) => setSelectedTab(event.target.value)}
              style={{
                padding: '7px 9px',
                borderRadius: 9,
                fontSize: 11,
                background: 'rgba(0,0,0,0.28)',
                border: `1px solid ${border}`,
                color: 'var(--text, #e2e8f0)',
                maxWidth: 220
              }}
            >
              <option value="">All tabs</option>
              {tabs.map((tab) => (
                <option key={tab.tabId} value={tab.tabId}>
                  {tab.active ? '● ' : ''}
                  {tab.modelKey || 'tab'} · {tab.tabId.slice(-6)}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {KIND_ORDER.filter((kind) => counts[kind]).map((kind) => {
              const color = kindColor(kind)
              const off = hiddenKinds.includes(kind)
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => toggleKind(kind)}
                  title={off ? `Show ${kind}` : `Hide ${kind}`}
                  style={{
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 10,
                    padding: '2px 7px',
                    borderRadius: 7,
                    cursor: 'pointer',
                    color: off ? 'rgba(148,163,184,0.55)' : color.fg,
                    background: off ? 'transparent' : color.bg,
                    border: `1px solid ${off ? 'rgba(148,163,184,0.18)' : color.border}`,
                    textDecoration: off ? 'line-through' : 'none'
                  }}
                >
                  {kind}
                  <span style={{ opacity: 0.7 }}> {counts[kind]}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* The log body */}
      <div
        style={{
          borderRadius: 14,
          border: `1px solid ${border}`,
          background: 'linear-gradient(180deg, rgba(255,255,255,0.02), transparent 40%), #0d1117',
          overflow: 'hidden'
        }}
      >
        <div
          ref={bodyRef}
          onScroll={(event) => {
            const el = event.currentTarget
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
            if (atBottom !== follow) setFollow(atBottom)
          }}
          style={{ maxHeight: height, overflow: 'auto', padding: '4px 0' }}
        >
          {visible.length === 0 && (
            <div style={{ padding: 18, fontSize: 11.5, color: '#64748b', lineHeight: 1.6 }}>
              Nothing recorded yet. Open a tab, press Ctrl+L, and the lines appear here — the trace is
              always on, it is only hidden.
            </div>
          )}

          {visible.map((event) => {
            const color = kindColor(event.kind)
            const isOpen = expanded.includes(event.seq)
            const details = dataText(event.data)
            return (
              <div
                key={`${event.seq}-${event.at}`}
                onClick={() =>
                  details &&
                  setExpanded((prev) =>
                    prev.includes(event.seq) ? prev.filter((s) => s !== event.seq) : [...prev, event.seq]
                  )
                }
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 8,
                  padding: '4px 12px',
                  borderTop: '1px solid rgba(255,255,255,0.035)',
                  cursor: details ? 'pointer' : 'default',
                  background: isOpen ? 'rgba(255,255,255,0.035)' : 'transparent'
                }}
              >
                <span
                  style={{
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 10,
                    color: '#475569',
                    width: 42,
                    textAlign: 'right',
                    flexShrink: 0
                  }}
                >
                  {event.seq}
                </span>
                <span
                  style={{
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 10,
                    color: '#64748b',
                    width: 58,
                    flexShrink: 0
                  }}
                >
                  +{event.t}ms
                </span>
                <span
                  style={{
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 9.5,
                    letterSpacing: 0.2,
                    padding: '1px 6px',
                    borderRadius: 6,
                    flexShrink: 0,
                    width: 56,
                    textAlign: 'center',
                    color: color.fg,
                    background: color.bg,
                    border: `1px solid ${color.border}`
                  }}
                >
                  {event.kind}
                </span>
                <span
                  style={{
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 9.5,
                    color: '#475569',
                    flexShrink: 0,
                    maxWidth: 96,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  title={event.tabId || 'no tab'}
                >
                  {event.tabId ? event.tabId.slice(-12) : '—'}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 11.5, color: '#e2e8f0', wordBreak: 'break-word' }}>
                    {event.message}
                    {event.count && event.count > 1 && (
                      <span
                        style={{
                          marginLeft: 6,
                          fontFamily: 'ui-monospace, monospace',
                          fontSize: 10,
                          padding: '0 5px',
                          borderRadius: 5,
                          background: 'rgba(148,163,184,0.16)',
                          color: '#cbd5e1'
                        }}
                      >
                        ×{event.count}
                      </span>
                    )}
                  </span>
                  {details && (
                    <span
                      style={{
                        display: 'block',
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: 10,
                        color: '#64748b',
                        marginTop: 1,
                        whiteSpace: isOpen ? 'pre-wrap' : 'nowrap',
                        overflow: 'hidden',
                        textOverflow: isOpen ? 'clip' : 'ellipsis',
                        wordBreak: 'break-word'
                      }}
                    >
                      {isOpen
                        ? JSON.stringify(event.data, null, 2)
                        : details}
                    </span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {!compact && (
        <p style={{ fontSize: 10.5, color: '#64748b', margin: 0, lineHeight: 1.6 }}>
          The same lines print to the terminal in development. <code>NEXUS_NAV_TRACE=0</code> silences
          them. Recording never stops — Clear only empties the buffer.
        </p>
      )}
    </div>
  )
}

export default LogsPanel
