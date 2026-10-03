import { useState, useRef, useEffect, useMemo } from 'react'
import type { HistoryItem, ModelKey } from '../lib/tabs'
import { fzfMatch } from '../lib/fzf'
import { BrandIcon, IconSearch, IconTrash, IconHistory, IconClock, IconImage } from './BrandIcons'
import { BRAND_IDS } from '../lib/modelVisuals'
import { matchesShortcut, getShortcutKeys } from '../lib/shortcuts'
import { useFocusLock } from '../lib/useFocusLock'

export interface ProviderDef {
  id: ModelKey
  name: string
  url: string
  desc: string
  color: string
  icon?: string
}

const KNOWN_PROVIDERS: Record<string, { desc: string; color: string }> = {
  gemini: {
    desc: 'Large context window, excellent reasoning and multimodal inputs.',
    color: '#4285F4'
  },
  chatgpt: {
    desc: 'OpenAI flagship model. Great for programming and general-purpose tasks.',
    color: '#10A37F'
  },
  deepseek: { desc: 'Fast, efficient programming and logic-oriented model.', color: '#4D6BFE' },
  qwen: { desc: 'Strong multilingual, math, and coding performance.', color: '#685CF2' },
  kimi: { desc: 'Excellent at long-document reading and Chinese NLP.', color: '#8899aa' }
}

const DEFAULT_DESC = 'Custom AI provider configured in Settings.'
const DEFAULT_COLOR = '#8899aa'

function itemDate(item: HistoryItem): string {
  const raw = item.timestamp ?? item.updatedAt
  if (!raw) return ''
  try {
    if (typeof raw === 'number') return new Date(raw).toLocaleDateString()
    const d = new Date(raw)
    if (isNaN(d.valueOf())) return ''
    return d.toLocaleDateString()
  } catch {
    return ''
  }
}

interface Props {
  models: { key: string; label: string; url: string; desc?: string; icon?: string }[]
  usageCounts: Record<string, number>
  history: HistoryItem[]
  onOpenNew: (provider: ProviderDef) => void
  onOpenHistory: (item: HistoryItem) => void
  onDeleteHistory: (id: string) => void
  onClose: () => void
}

export default function NewTabOverlay({
  models,
  usageCounts,
  history,
  onOpenNew,
  onOpenHistory,
  onDeleteHistory,
  onClose
}: Props) {
  const [search, setSearch] = useState('')
  const [activePane, setActivePane] = useState<'providers' | 'history'>('providers')

  const [providerIdx, setProviderIdx] = useState(0)
  const [historyIdx, setHistoryIdx] = useState(0)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  const PROVIDERS = useMemo<ProviderDef[]>(() => {
    const seen = new Set<string>()
    const list: ProviderDef[] = []

    for (const m of models) {
      if (!m || !m.key || seen.has(m.key)) continue
      seen.add(m.key)
      const meta = KNOWN_PROVIDERS[m.key]
      list.push({
        id: m.key,
        name: m.label || m.key,
        url: m.url,
        desc: m.desc || (meta ? meta.desc : DEFAULT_DESC),
        color: meta ? meta.color : DEFAULT_COLOR,
        icon: m.icon
      })
    }

    return list
      .map((p, idx) => ({ p, idx }))
      .sort((a, b) => (usageCounts[b.p.id] ?? 0) - (usageCounts[a.p.id] ?? 0) || a.idx - b.idx)
      .map((x) => x.p)
  }, [models, usageCounts])

  // Filter Providers
  const filteredProviders = useMemo(() => {
    if (!search.trim() && activePane === 'providers') return PROVIDERS
    if (activePane !== 'providers') return PROVIDERS // Keep selected visible underneath
    return PROVIDERS.filter(
      (p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.desc.toLowerCase().includes(search.toLowerCase())
    )
  }, [search, activePane, PROVIDERS])

  const activeProvider = filteredProviders[providerIdx] || PROVIDERS[0]

  // Filter History for active provider
  const filteredHistory = useMemo(() => {
    let raw = history.filter((h) => h.model === activeProvider.id)
    if (!search.trim() || activePane === 'providers') return raw

    const results: { item: HistoryItem; score: number }[] = []
    for (const item of raw) {
      const titleMatch = fzfMatch(search, item.title)
      if (titleMatch) results.push({ item, score: 1 })
    }
    return results.map((r) => r.item)
  }, [history, activeProvider.id, search, activePane])

  // Indices are now reset explicitly on input change to avoid side-effects

  // Scroll into view
  useEffect(() => {
    const activeIdx = activePane === 'providers' ? providerIdx : historyIdx
    itemRefs.current[activeIdx]?.scrollIntoView({ block: 'nearest' })
  }, [providerIdx, historyIdx, activePane])

  // Persistent focus lock
  useFocusLock(inputRef, true)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey
      const t = e.target as HTMLElement | null
      const isInputFocused = t === inputRef.current

      if (matchesShortcut(e, getShortcutKeys('tab-new')) || e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }

      if (e.key === '/') {
        if (!isInputFocused) {
          e.preventDefault()
          inputRef.current?.focus()
          inputRef.current?.select()
          return
        }
      }

      // Pane navigation (Right / Ctrl+L) and (Left / Ctrl+H)
      if (
        (e.key === 'ArrowRight' || (isCtrl && e.key.toLowerCase() === 'l')) &&
        activePane === 'providers'
      ) {
        e.preventDefault()
        const absoluteIdx = PROVIDERS.findIndex(p => p.id === activeProvider.id)
        if (absoluteIdx !== -1) {
          setProviderIdx(absoluteIdx)
        }
        setActivePane('history')
        setSearch('') // clear search when entering history
        setHistoryIdx(0)
        return
      }

      if (
        (e.key === 'ArrowLeft' || (isCtrl && e.key.toLowerCase() === 'h')) &&
        activePane === 'history'
      ) {
        e.preventDefault()
        setActivePane('providers')
        setSearch('')
        return
      }

      // Up/Down Navigation
      if (e.key === 'ArrowDown' || (isCtrl && e.key.toLowerCase() === 'j')) {
        e.preventDefault()
        if (activePane === 'providers') {
          setProviderIdx((prev) => (prev < filteredProviders.length - 1 ? prev + 1 : prev))
        } else {
          setHistoryIdx((prev) => (prev < filteredHistory.length - 1 ? prev + 1 : prev))
        }
        return
      }

      if (e.key === 'ArrowUp' || (isCtrl && e.key.toLowerCase() === 'k')) {
        e.preventDefault()
        if (activePane === 'providers') {
          setProviderIdx((prev) => (prev > 0 ? prev - 1 : 0))
        } else {
          setHistoryIdx((prev) => (prev > 0 ? prev - 1 : 0))
        }
        return
      }

      // Enter to Select
      if (e.key === 'Enter') {
        e.preventDefault()
        if (activePane === 'providers' && filteredProviders[providerIdx]) {
          onOpenNew(filteredProviders[providerIdx])
        } else if (activePane === 'history' && filteredHistory[historyIdx]) {
          onOpenHistory(filteredHistory[historyIdx])
        }
        return
      }

      // Delete History (Ctrl+D / Ctrl+Delete)
      if (isCtrl && (e.key === 'Delete' || e.key.toLowerCase() === 'd')) {
        e.preventDefault()
        if (activePane === 'history' && filteredHistory[historyIdx]) {
          const targetItem = filteredHistory[historyIdx]
          const targetId = targetItem.id
          if (!targetId) return
          if (deleteConfirmId === targetId) {
            onDeleteHistory(targetId)
            setDeleteConfirmId(null)
            // shift index up if we deleted the last item
            setHistoryIdx((prev) => Math.max(0, prev > 0 ? prev - 1 : 0))
          } else {
            setDeleteConfirmId(targetId)
            setTimeout(() => setDeleteConfirmId(null), 3000)
          }
        }
        return
      }
    }

    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [activePane, providerIdx, historyIdx, filteredProviders, filteredHistory, deleteConfirmId])

  return (
    <div
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-md cosmic-backdrop-fade"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={`${activePane === 'history' ? 'w-[85vw] max-w-5xl h-[70vh]' : 'w-[900px] h-[500px]'} bg-(--bg) border border-(--border) rounded-xl shadow-2xl flex flex-col overflow-hidden transition-all duration-200 cosmic-modal-pop hud-bracket`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search header */}
        <div className="flex items-center border-b border-(--border) px-4 py-3 bg-(--surface)">
          <IconSearch size={20} className="text-(--text2) mr-3 shrink-0" />
          <input
            ref={inputRef}
            autoFocus
            type="text"
            className="flex-1 bg-transparent border-none text-(--text) outline-none placeholder-[#8899aa]"
            placeholder={
              activePane === 'providers'
                ? 'Search AI Providers... (Press → or Ctrl+L for History)'
                : `Search ${activeProvider.name} History... (Press ← or Ctrl+H to go back)`
            }
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setProviderIdx(0)
              setHistoryIdx(0)
            }}
          />
          <div className="text-xs text-(--text2) font-mono flex gap-3">
            <span>UP/DOWN to move</span>
            {activePane === 'history' && <span>CTRL+D delete</span>}
            <span>ENTER to select</span>
          </div>
        </div>

        {/* Dynamic Dual Pane Layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Pane: Providers (hidden in history mode) */}
          <div
            className={`${activePane === 'providers' ? 'flex w-1/2 order-1' : 'hidden'} flex-col border-r border-(--border) overflow-y-auto custom-scrollbar transition-opacity duration-200`}
          >
            {filteredProviders.length === 0 ? (
              <div className="p-8 text-center text-(--text2)">No providers found.</div>
            ) : (
              filteredProviders.map((p, idx) => {
                const isSelected = activePane === 'providers' && providerIdx === idx
                const isPassiveActive = activePane === 'history' && p.id === activeProvider.id

                return (
                  <div
                    key={p.id}
                    ref={(el) => {
                      if (activePane === 'providers') itemRefs.current[idx] = el
                    }}
                    onClick={() => {
                      setActivePane('providers')
                      setProviderIdx(idx)
                      onOpenNew(p)
                    }}
                    className={`p-4 border-b border-(--border)/50 cursor-pointer flex items-start gap-4 transition-colors group ${
                      isSelected
                        ? 'bg-(--border)'
                        : isPassiveActive
                          ? 'bg-(--surface)'
                          : 'hover:bg-(--surface)'
                    }`}
                  >
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),inset_0_-6px_12px_rgba(0,0,0,0.25),0_2px_6px_rgba(0,0,0,0.4)] transition-all duration-150 ${
                        isSelected
                          ? 'ring-2 ring-white/80 ring-offset-2 ring-offset-(--bg) scale-105'
                          : isPassiveActive
                            ? 'ring-1 ring-white/30'
                            : 'group-hover:ring-1 group-hover:ring-white/20 group-hover:shadow-lg'
                      }`}
                      style={{
                        background: `linear-gradient(135deg, ${p.color} 0%, ${p.color}99 100%)`
                      }}
                    >
                      {p.icon || BRAND_IDS[p.id] ? (
                        <BrandIcon id={p.id} size={20} customSvg={p.icon} />
                      ) : (
                        <span className="text-sm font-black tracking-tight">{p.name.charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-(--text) font-medium mb-1 flex items-center">
                        {p.name}
                        {isSelected && (
                          <span className="ml-auto text-[10px] bg-(--accent)/20 text-(--accent) px-2 py-0.5 rounded flex items-center gap-1">
                            Press <span className="font-mono bg-(--accent)/30 px-1 rounded">→</span>{' '}
                            for History
                          </span>
                        )}
                      </div>
                      <div className="text-(--text2) text-xs leading-relaxed truncate">
                        {p.desc}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* History Pane: right+dimmed in providers mode, left+full in history mode */}
          <div
            className={`${activePane === 'history' ? 'order-1 border-r border-(--border)' : 'order-2'} w-1/2 flex flex-col bg-(--surface)/30 overflow-y-auto custom-scrollbar transition-all duration-200 ${activePane === 'providers' ? 'opacity-40 grayscale pointer-events-none' : 'opacity-100'}`}
          >
            <div className="p-3 text-xs font-bold text-(--text2) uppercase tracking-wider border-b border-(--border) bg-(--bg) sticky top-0 z-10 flex justify-between">
              <span>{activeProvider.name} History</span>
              <span className="font-mono font-normal">ESC / ← / Ctrl+H to return</span>
            </div>

            {history.filter((h) => h.model === activeProvider.id).length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                <div className="w-12 h-12 rounded-full bg-(--border) flex items-center justify-center mb-3">
                  <IconHistory size={20} className="text-(--text2)" />
                </div>
                <div className="text-(--text2)">No history available for this model yet.</div>
              </div>
            ) : filteredHistory.length === 0 ? (
              <div className="p-8 text-center text-(--text2)">No matches found.</div>
            ) : (
              filteredHistory.map((item, idx) => {
                const isSelected = activePane === 'history' && historyIdx === idx
                const itemKey = item.id ? `${item.id}-${idx}` : `${item.url}-${item.timestamp ?? idx}`
                return (
                  <div
                    key={itemKey}
                    ref={(el) => {
                      if (activePane === 'history') itemRefs.current[idx] = el
                    }}
                    onClick={() => {
                      setActivePane('history')
                      setHistoryIdx(idx)
                      onOpenHistory(item)
                    }}
                    onDoubleClick={() => onOpenHistory(item)}
                    className={`p-3 border-b border-(--border)/50 cursor-pointer group transition-colors flex items-center ${
                      isSelected
                        ? 'bg-(--border) border-l-2 border-l-[#e94560]'
                        : 'hover:bg-(--surface) border-l-2 border-l-transparent'
                    }`}
                  >
                    <div className="flex-1 min-w-0 pr-4">
                      <div
                        className={`truncate ${isSelected ? 'text-(--text)' : 'text-(--text2) group-hover:text-(--text)'}`}
                      >
                        {item.title || 'New Chat'}
                      </div>
                      <div className="text-[10px] text-(--text2)/60 mt-1 flex items-center gap-1">
                        <IconClock size={10} className="shrink-0" />
                        <span>
                          {item.timestamp ? new Date(item.timestamp).toLocaleString() : ''}
                        </span>
                      </div>
                    </div>

                    {/* Delete Button / Status */}
                    {deleteConfirmId === item.id ? (
                      <span className="text-(--accent) text-xs font-bold shrink-0">
                        Press Ctrl+D{' '}
                      </span>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setActivePane('history')
                          setHistoryIdx(idx)
                          if (item.id) setDeleteConfirmId(item.id)
                          setTimeout(() => setDeleteConfirmId(null), 3000)
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-(--accent)/20 hover:text-(--accent) rounded text-(--text2) shrink-0 transition-all"
                        title="Delete (Ctrl+D)"
                      >
                        <IconTrash size={14} />
                      </button>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* Preview Pane (history mode only) */}
          {activePane === 'history' && (
            <div className="order-2 w-1/2 bg-(--bg) flex-col relative overflow-hidden hidden md:flex">
              {filteredHistory[historyIdx] ? (
                <>
                  {filteredHistory[historyIdx].thumbnail ? (
                    <img
                      src={filteredHistory[historyIdx].thumbnail}
                      alt="Preview"
                      className="w-full h-full object-cover opacity-60"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-(--text2) flex-col gap-4 opacity-50">
                      <IconImage size={48} />
                      <span className="text-sm font-medium tracking-wide uppercase">
                        No Web Snapshot
                      </span>
                    </div>
                  )}

                  {/* Gradient overlay for text legibility */}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0f172a] via-[#0f172a]/40 to-transparent pointer-events-none" />

                  <div className="absolute bottom-0 left-0 right-0 p-8 flex flex-col items-start gap-3 pointer-events-none">
                    <span className="bg-(--accent) px-3 py-1 rounded text-white text-[10px] uppercase font-bold tracking-widest shadow-lg">
                      {filteredHistory[historyIdx].model}
                    </span>
                    <div className="text-white text-2xl font-bold line-clamp-3 leading-snug drop-shadow-lg">
                      {filteredHistory[historyIdx].title || 'Untitled Chat'}
                    </div>
                    <div className="text-(--text2) text-xs font-semibold tracking-wider">
                      {itemDate(filteredHistory[historyIdx])}
                    </div>
                  </div>
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-(--text2) text-sm tracking-wide">
                  Select a chat to preview
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
