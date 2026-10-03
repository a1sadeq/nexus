import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { fzfMatch } from '../lib/fzf'
import type { HistoryItem, ModelKey } from '../lib/tabs'
import { BrandIcon, IconSearch, IconHistory, IconTrash, IconPencil } from './BrandIcons'
import { BRAND_IDS, modelColor, type ModelDef } from '../lib/modelVisuals'
import './HistoryOverlay.css'
import { useFocusLock } from '../lib/useFocusLock'

interface Props {
  history: HistoryItem[]
  models?: ModelDef[]
  onOpen: (item: HistoryItem) => void
  onClose: () => void
  onDelete?: (id: string, url: string) => void
  onRename?: (id: string, url: string, newTitle: string) => void
}

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

export default function HistoryOverlay({ history, models, onOpen, onClose, onDelete, onRename }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | ModelKey>('all')
  const [selected, setSelected] = useState(0)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const filterRefs = useRef<(HTMLButtonElement | null)[]>([])

  const FILTERS = useMemo<{ key: 'all' | string; label: string; icon?: string }[]>(() => {
    const base: { key: 'all' | string; label: string; icon?: string }[] = [
      { key: 'all', label: 'All', icon: undefined }
    ]
    
    // Calculate last used timestamp for each model from history
    const lastUsed = new Map<string, number>()
    for (const h of history) {
      let ts = Number(h.timestamp) || 0
      if (!ts && h.updatedAt) ts = new Date(h.updatedAt).getTime()
      if (!lastUsed.has(h.model) || ts > (lastUsed.get(h.model) || 0)) {
        lastUsed.set(h.model, ts)
      }
    }

    const providerList: { key: string; label: string; icon?: string; ts: number }[] = []

    if (models && models.length > 0) {
      const seen = new Set<string>()
      for (const m of models) {
        if (!m || !m.key || seen.has(m.key)) continue
        seen.add(m.key)
        providerList.push({ 
          key: m.key, 
          label: m.label || m.key, 
          icon: m.icon,
          ts: lastUsed.get(m.key) || 0
        })
      }
    } else {
      const defaultKeys = ['gemini', 'chatgpt', 'claude', 'deepseek', 'kimi', 'qwen', 'grok', 'mistral', 'perplexity']
      for (const key of defaultKeys) {
        providerList.push({ key, label: key.charAt(0).toUpperCase() + key.slice(1), ts: lastUsed.get(key) || 0 })
      }
    }
    
    // Sort providers by last used (descending), then alphabetically
    providerList.sort((a, b) => {
      if (b.ts !== a.ts) return b.ts - a.ts
      return a.label.localeCompare(b.label)
    })
    
    for (const p of providerList) {
      base.push({ key: p.key, label: p.label, icon: p.icon })
    }

    return base
  }, [models, history])

  useFocusLock(inputRef, true)

  useEffect(() => {
    inputRef.current?.focus()
    // @ts-ignore
    window.electron?.ipcRenderer.send('claim_window_focus')
  }, [])

  const results = useMemo(() => {
    let filtered = filter === 'all' ? history : history.filter((h) => h.model === filter)

    if (search.trim()) {
      filtered = filtered.filter((h) => fzfMatch(search, h.title))
    }
    return filtered.slice(0, 50)
  }, [history, search, filter])

  useEffect(() => {
    setSelected(0)
  }, [search, filter])

  useEffect(() => {
    itemRefs.current[selected]?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const handleCycleFilter = useCallback(
    (direction: -1 | 1) => {
      const currentIndex = FILTERS.findIndex((f) => f.key === filter)
      const nextIndex = (currentIndex + direction + FILTERS.length) % FILTERS.length
      const nextFilter = FILTERS[nextIndex]
      if (nextFilter) {
        setFilter(nextFilter.key)
        filterRefs.current[nextIndex]?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
      }
    },
    [filter, FILTERS]
  )

  const handleDeleteSelected = useCallback(() => {
    if (!results[selected] || !onDelete) return
    const itemToDelete = results[selected]
    const targetId = itemToDelete.id || itemToDelete.url
    if (!targetId) return

    if (deleteConfirmId === targetId) {
      onDelete(itemToDelete.id || '', itemToDelete.url)
      setDeleteConfirmId(null)
      if (selected >= results.length - 1 && selected > 0) {
        setSelected((s) => s - 1)
      }
    } else {
      setDeleteConfirmId(targetId)
      setTimeout(() => setDeleteConfirmId(null), 2000)
    }
  }, [results, selected, onDelete, deleteConfirmId])

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (editingId) return // currently editing title
      const isCtrl = e.ctrlKey || e.metaKey
      if (isCtrl && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        e.stopPropagation()
        handleDeleteSelected()
      } else if (isCtrl && e.key.toLowerCase() === 'h') {
        e.preventDefault()
        e.stopPropagation()
        if (filter === 'all') {
          onClose()
        } else {
          handleCycleFilter(-1)
        }
      } else if (isCtrl && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        e.stopPropagation()
        handleCycleFilter(1)
      } else if (e.key === 'Delete' && document.activeElement !== inputRef.current) {
        e.preventDefault()
        e.stopPropagation()
        handleDeleteSelected()
      } else if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown, true)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, true)
  }, [editingId, handleDeleteSelected, handleCycleFilter, results, selected])

  const open = (item: HistoryItem) => {
    onOpen(item)
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-md cosmic-backdrop-fade"
      onClick={onClose}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
    >
      {/* Wrapper to block clicks from closing the overlay */}
      <div
        className="w-[85vw] max-w-5xl h-[70vh] bg-(--surface) rounded-xl shadow-2xl flex border border-(--border) overflow-hidden history-overlay-wrapper cosmic-modal-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left Column: List */}
        <div className="w-full md:w-1/2 flex flex-col border-r border-(--border) bg-(--surface)">
          <div className="p-4 border-b border-(--border)">
            <div className="relative">
              <IconSearch
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-(--text2) pointer-events-none"
              />
              <input
                ref={inputRef}
                autoFocus={true}
                type="text"
                placeholder="Search chats... (Ctrl+H/L: Switch Provider, Ctrl+D: Delete)"
                className="w-full bg-(--bg) text-(--text) pl-10 pr-4 py-3 rounded-lg outline-none border border-(--border) focus:border-(--accent) transition-colors text-sm"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') onClose()
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
                    e.preventDefault()
                    e.stopPropagation()
                    handleDeleteSelected()
                    return
                  }
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
                    e.preventDefault()
                    e.stopPropagation()
                    if (filter === 'all') {
                      onClose()
                    } else {
                      handleCycleFilter(-1)
                    }
                    return
                  }
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
                    e.preventDefault()
                    e.stopPropagation()
                    handleCycleFilter(1)
                    return
                  }
                  if (e.key === 'ArrowDown' || (e.ctrlKey && e.key.toLowerCase() === 'j')) {
                    e.preventDefault()
                    setSelected((s) => Math.min(s + 1, results.length - 1))
                  }
                  if (e.key === 'ArrowUp' || (e.ctrlKey && e.key.toLowerCase() === 'k')) {
                    e.preventDefault()
                    setSelected((s) => Math.max(s - 1, 0))
                  }
                  if (e.key === 'Enter' && results[selected]) open(results[selected])
                }}
              />
            </div>

            <div className="flex gap-2 mt-3 overflow-x-auto pb-1 scrollbar-none">
              {FILTERS.map((f, fIdx) => (
                <button
                  key={f.key}
                  ref={(el) => { filterRefs.current[fIdx] = el }}
                  onClick={() => setFilter(f.key)}
                  className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider transition-colors min-w-[70px] flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap ${
                    filter === f.key
                      ? 'bg-(--accent) text-white shadow-sm'
                      : 'bg-(--surface2) text-(--text2) hover:bg-(--border) hover:text-(--text)'
                  }`}
                >
                  {f.key !== 'all' && (
                    f.icon || BRAND_IDS[f.key] ? (
                      <BrandIcon
                        id={f.key}
                        size={12}
                        customSvg={f.icon}
                        className={filter === f.key ? 'text-white' : ''}
                        style={filter === f.key ? undefined : { color: modelColor(f.key) }}
                      />
                    ) : (
                      <span className="text-[10px] font-bold" style={filter === f.key ? undefined : { color: modelColor(f.key) }}>
                        {f.label.charAt(0).toUpperCase()}
                      </span>
                    )
                  )}
                  <span>{f.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 history-results custom-scrollbar">
            {results.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-3 mt-10 text-(--text2)">
                <IconHistory size={40} className="opacity-40" />
                <div className="text-sm">No chats found</div>
              </div>
            )}
            {results.map((item, i) => {
              const provDef = models?.find((m) => m.key === item.model)
              const itemKey = item.id ? `${item.id}-${i}` : `${item.url}-${item.timestamp ?? i}`
              return (
                <div
                  key={itemKey}
                  ref={(el) => {
                    itemRefs.current[i] = el
                  }}
                  className={`px-4 py-3 rounded-lg cursor-pointer transition-colors border flex flex-col gap-1 ${
                    i === selected
                      ? 'bg-(--border) border-(--accent)/40 shadow-sm'
                      : 'border-transparent hover:bg-(--bg)'
                  }`}
                  onClick={() => {
                    if (!editingId) open(item)
                  }}
                  onMouseEnter={() => {
                    if (!editingId) setSelected(i)
                  }}
                >
                  <div className="flex justify-between items-start">
                    <div className="truncate font-medium text-(--text) flex-1 flex items-center gap-2">
                      <span className="shrink-0 flex items-center justify-center">
                        {provDef?.icon || BRAND_IDS[item.model] ? (
                          <BrandIcon
                            id={item.model}
                            size={14}
                            customSvg={provDef?.icon}
                            style={{ color: provDef?.color || modelColor(item.model) }}
                          />
                        ) : (
                          <span
                            className="text-[10px] font-bold"
                            style={{ color: provDef?.color || modelColor(item.model) }}
                          >
                            {item.model.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </span>
                      {editingId === (item.id || item.url) ? (
                        <input
                          type="text"
                          autoFocus
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onBlur={() => setEditingId(null)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              if (onRename) onRename(item.id || '', item.url, editTitle)
                              setEditingId(null)
                            }
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                          className="bg-black/30 border border-(--accent) px-2 py-0.5 rounded text-(--text) text-sm w-full outline-none"
                        />
                      ) : (
                        <span className="truncate">{item.title || 'Untitled Chat'}</span>
                      )}
                    </div>

                    {i === selected && !editingId && (
                      <div className="flex items-center gap-1.5 ml-2">
                        {deleteConfirmId === (item.id || item.url) ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (onDelete) onDelete(item.id || '', item.url)
                              setDeleteConfirmId(null)
                              if (selected >= results.length - 1 && selected > 0) {
                                setSelected((s) => s - 1)
                              }
                            }}
                            className="bg-red-500 text-white border border-red-600 px-2 py-0.5 rounded text-[10px] font-bold transition-all flex items-center gap-1 shadow-md animate-pulse cursor-pointer"
                            title="Press Ctrl+D again to confirm deletion"
                          >
                            <IconTrash size={11} />
                            <span>Press Ctrl+D to Delete</span>
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setEditTitle(item.title)
                                setEditingId(item.id || item.url)
                              }}
                              className="text-(--text2) hover:text-(--accent) p-1"
                              title="Rename"
                            >
                              <IconPencil size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                const targetId = item.id || item.url
                                if (targetId) {
                                  setDeleteConfirmId(targetId)
                                  setTimeout(() => setDeleteConfirmId(null), 2000)
                                }
                              }}
                              className="text-(--text2) hover:text-red-400 p-1"
                              title="Delete (Ctrl+D)"
                            >
                              <IconTrash size={13} />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-[10px] text-(--text2) uppercase tracking-wider font-semibold pl-5">
                    {provDef?.label || item.model} &bull; {itemDate(item) || 'Unknown Date'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right Column: Preview Pane */}
        <div className="hidden md:flex w-1/2 bg-(--bg) flex-col relative overflow-hidden">
          {results[selected] ? (
            <>
              {results[selected].thumbnail ? (
                <img
                  src={results[selected].thumbnail}
                  alt="Preview"
                  className="w-full h-full object-cover opacity-60"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-(--text2) flex-col gap-4 opacity-50">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" />
                    <line x1="16" x2="22" y1="5" y2="5" />
                    <line x1="19" x2="19" y1="2" y2="8" />
                    <circle cx="9" cy="9" r="2" />
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                  </svg>
                  <span className="text-sm font-medium tracking-wide uppercase">
                    No Web Snapshot
                  </span>
                </div>
              )}

              {/* Gradient overlay for text legibility */}
              <div className="absolute inset-0 bg-gradient-to-t from-[#0f172a] via-[#0f172a]/40 to-transparent pointer-events-none" />

              <div className="absolute bottom-0 left-0 right-0 p-8 flex flex-col items-start gap-3 pointer-events-none">
                <span className="bg-(--accent) px-3 py-1 rounded text-white text-[10px] uppercase font-bold tracking-widest shadow-lg">
                  {results[selected].model}
                </span>
                <div className="text-white text-2xl font-bold line-clamp-3 leading-snug drop-shadow-lg">
                  {results[selected].title || 'Untitled Chat'}
                </div>
                <div className="text-(--text2) text-xs font-semibold tracking-wider">
                  {itemDate(results[selected])}
                </div>
              </div>
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-(--text2) text-sm tracking-wide">
              Select a chat to preview
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
