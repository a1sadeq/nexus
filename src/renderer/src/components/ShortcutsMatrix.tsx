import React, { useState, useEffect } from 'react'
import {
  type ShortcutCategory,
  getEffectiveShortcuts,
  setShortcutKeys,
  resetShortcutKeys,
  resetAllShortcuts,
  findShortcutCollision,
  parseKeyEventToKeys,
  onShortcutsChanged
} from '../lib/shortcuts'
import {
  IconSearch,
  IconX,
  IconSparkles,
  IconMonitor,
  IconZap,
  IconCheck
} from './BrandIcons'

interface Props {
  className?: string
  searchPlaceholder?: string
}

export function ShortcutsMatrix({ className = '', searchPlaceholder = 'Search shortcuts by action, description or key...' }: Props) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<'all' | ShortcutCategory>('all')
  const [shortcuts, setShortcuts] = useState(() => getEffectiveShortcuts())
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [collisionWarning, setCollisionWarning] = useState<{ id: string; otherAction: string } | null>(null)
  const [successId, setSuccessId] = useState<string | null>(null)

  // Reload shortcuts when changed
  useEffect(() => {
    return onShortcutsChanged(() => {
      setShortcuts(getEffectiveShortcuts())
    })
  }, [])

  // Listen for keys when in recording mode
  useEffect(() => {
    if (!recordingId) return

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        setRecordingId(null)
        setCollisionWarning(null)
        return
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        // Reset to default
        resetShortcutKeys(recordingId)
        setRecordingId(null)
        setCollisionWarning(null)
        setSuccessId(recordingId)
        setTimeout(() => setSuccessId(null), 1500)
        return
      }

      const parsed = parseKeyEventToKeys(e)
      if (!parsed) {
        // Waiting for non-modifier key
        return
      }

      // Check collision
      const collision = findShortcutCollision(recordingId, parsed)
      if (collision) {
        setCollisionWarning({ id: recordingId, otherAction: collision.action })
      } else {
        setCollisionWarning(null)
      }

      // If global shortcut, sync with main process
      if (recordingId === 'summon-nexus') {
        const combo = parsed.join('+')
        // @ts-ignore
        window.electron?.ipcRenderer?.invoke?.('set_global_hotkey', combo).then((ok: boolean) => {
          if (ok) {
            setShortcutKeys(recordingId, parsed)
            setRecordingId(null)
            setSuccessId(recordingId)
            setTimeout(() => setSuccessId(null), 1500)
          } else {
            alert(`Could not register "${combo}". It may be taken by another app.`)
          }
        }).catch(() => {})
        return
      }

      setShortcutKeys(recordingId, parsed)
      setRecordingId(null)
      setSuccessId(recordingId)
      setTimeout(() => setSuccessId(null), 1500)
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [recordingId])

  const filtered = shortcuts.filter((s) => {
    if (category !== 'all' && s.category !== category) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      s.action.toLowerCase().includes(q) ||
      s.desc.toLowerCase().includes(q) ||
      s.keys.join('+').toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q)
    )
  })

  const hasAnyCustom = shortcuts.some((s) => s.isCustom)

  const categories: Array<{ id: 'all' | ShortcutCategory; label: string; icon: React.ComponentType<any> }> = [
    { id: 'all', label: 'All Shortcuts', icon: IconSparkles },
    { id: 'tabs', label: 'Tabs & Navigation', icon: IconMonitor },
    { id: 'models', label: 'AI Switching & Webview', icon: IconZap },
    { id: 'skills', label: 'SuperAntigravity Skills', icon: IconSparkles },
    { id: 'system', label: 'System & Studio', icon: IconSparkles }
  ]

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {/* Top Controls: Search + Categories */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Search Bar */}
        <div className="relative flex-1 max-w-md">
          <IconSearch size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-(--text2) pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            spellCheck={false}
            className="w-full pl-9 pr-8 py-2 rounded-xl border text-xs outline-none transition-all"
            style={{
              background: 'var(--bg, rgba(0,0,0,0.4))',
              borderColor: 'rgba(255,255,255,0.1)',
              color: 'var(--text)'
            }}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-(--text2) hover:text-(--text) p-1 rounded-md cursor-pointer"
            >
              <IconX size={13} />
            </button>
          )}
        </div>

        {/* Reset All Shortcuts Button */}
        {hasAnyCustom && (
          <button
            type="button"
            onClick={() => {
              if (confirm('Reset all custom shortcuts back to their default key combinations?')) {
                resetAllShortcuts()
              }
            }}
            className="px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 text-amber-400 border-amber-500/30 hover:bg-amber-500/10 transition-colors shrink-0 cursor-pointer shadow-sm"
          >
            <span>↺ Reset All to Defaults</span>
          </button>
        )}
      </div>

      {/* Category Filter Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
        {categories.map((c) => {
          const IconComp = c.icon
          const isActive = category === c.id
          const count = c.id === 'all' ? shortcuts.length : shortcuts.filter((s) => s.category === c.id).length
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all shrink-0 cursor-pointer"
              style={{
                background: isActive ? 'var(--accent, #6366f1)' : 'rgba(0,0,0,0.3)',
                borderColor: isActive ? 'var(--accent, #6366f1)' : 'rgba(255,255,255,0.08)',
                color: isActive ? '#fff' : 'var(--text2)',
                boxShadow: isActive ? '0 2px 10px color-mix(in srgb, var(--accent, #6366f1) 40%, transparent)' : 'none'
              }}
            >
              <IconComp size={13} />
              <span>{c.label}</span>
              <span
                className="text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold"
                style={{
                  background: isActive ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)',
                  color: isActive ? '#fff' : 'var(--text2)'
                }}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Collision Warning Banner */}
      {collisionWarning && (
        <div className="p-3 rounded-xl border border-amber-500/40 bg-amber-500/15 text-amber-300 text-xs flex items-center justify-between gap-3 shadow-md animate-pulse">
          <div className="flex items-center gap-2">
            <span className="text-sm">⚠️</span>
            <span>
              <strong>Key Collision Detected:</strong> This key combination is already used by <strong>{collisionWarning.otherAction}</strong>.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setCollisionWarning(null)}
            className="text-amber-400 hover:text-amber-200 text-xs underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Shortcuts Grid */}
      {filtered.length === 0 ? (
        <div className="text-xs py-12 text-center border rounded-2xl bg-black/20" style={{ color: 'var(--text2)', borderColor: 'rgba(255,255,255,0.06)' }}>
          No shortcuts match “{search}” in {category === 'all' ? 'any category' : categories.find((c) => c.id === category)?.label}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-stretch">
          {filtered.map((s) => {
            const isRecording = recordingId === s.id
            const isJustSaved = successId === s.id

            return (
              <div
                key={s.id}
                className="p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all relative overflow-hidden group shadow-sm"
                style={{
                  background: isRecording
                    ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.18) 0%, rgba(15, 17, 26, 0.95) 100%)'
                    : s.isCustom
                    ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, rgba(15, 17, 26, 0.9) 100%)'
                    : 'linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0%, rgba(15, 17, 26, 0.85) 100%)',
                  borderColor: isRecording
                    ? 'var(--accent, #6366f1)'
                    : s.isCustom
                    ? 'rgba(245, 158, 11, 0.35)'
                    : 'rgba(255, 255, 255, 0.08)'
                }}
              >
                {/* Left: Action Title, Badges & Description */}
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-xs sm:text-sm text-white">{s.action}</span>
                    {s.badge && (
                      <span
                        className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-full uppercase"
                        style={{
                          background: s.isGlobal ? 'rgba(244, 63, 94, 0.18)' : 'color-mix(in srgb, var(--accent, #6366f1) 20%, transparent)',
                          color: s.isGlobal ? '#fb7185' : 'var(--accent, #6366f1)',
                          border: `1px solid ${s.isGlobal ? 'rgba(244, 63, 94, 0.3)' : 'color-mix(in srgb, var(--accent, #6366f1) 30%, transparent)'}`
                        }}
                      >
                        {s.badge}
                      </span>
                    )}
                    {s.isCustom && (
                      <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-full border bg-amber-500/20 text-amber-400 border-amber-500/40 flex items-center gap-1">
                        <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" />
                        <span>Custom</span>
                      </span>
                    )}
                    {isJustSaved && (
                      <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center gap-1">
                        <IconCheck size={10} />
                        <span>Saved</span>
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] opacity-75 leading-relaxed mt-0.5" style={{ color: 'var(--text2)' }}>
                    {s.desc}
                  </span>
                </div>

                {/* Right: Keycaps Button & Reset Control */}
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  {/* Reset Shortcut Button */}
                  {s.isCustom && !isRecording && (
                    <button
                      type="button"
                      onClick={() => resetShortcutKeys(s.id)}
                      className="p-1.5 rounded-lg border text-amber-400 border-amber-500/30 hover:bg-amber-500/15 transition-colors cursor-pointer"
                      title="Reset to default key combination"
                    >
                      <span className="text-xs font-mono">↺</span>
                    </button>
                  )}

                  {/* Interactive Keycap Trigger */}
                  {isRecording ? (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-(--accent) bg-(--accent)/20 text-white animate-pulse shadow-lg">
                      <span className="text-xs font-mono font-bold">Press keys…</span>
                      <span className="text-[10px] opacity-75">(Esc to cancel)</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setRecordingId(s.id)}
                      className="flex items-center gap-1 p-1 rounded-xl border transition-all hover:scale-105 active:scale-95 cursor-pointer"
                      style={{
                        background: 'rgba(0, 0, 0, 0.4)',
                        borderColor: 'rgba(255, 255, 255, 0.12)'
                      }}
                      title="Click to re-bind or customize this shortcut"
                    >
                      {s.keys.map((k, kIdx) => (
                        <span
                          key={k + kIdx}
                          className={`zen-keycap ${['Ctrl', 'Alt', 'Shift', 'Meta', 'F1'].includes(k) ? 'zen-keycap-mod' : ''}`}
                        >
                          {k}
                        </span>
                      ))}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
