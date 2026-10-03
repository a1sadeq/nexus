import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { fzfMatch } from '../lib/fzf'
import type { Tab } from '../lib/tabs'
import { BrandIcon, IconSearch, IconHistory, IconTrash } from './BrandIcons'
import { BRAND_IDS, modelColor, type ModelDef } from '../lib/modelVisuals'
import './HistoryOverlay.css'
import { useFocusLock } from '../lib/useFocusLock'

interface Props {
  tabs: Tab[]
  models?: ModelDef[]
  onOpen: (id: string, url: string) => void
  onClose: () => void
  onDelete?: (id: string) => void
}

function itemDate(item: Tab): string {
  const raw = item.updatedAt || item.createdAt
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

export default function TabOverviewOverlay({ tabs, models = [], onOpen, onClose, onDelete }: Props) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(0)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  
  const inputRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  const results = useMemo(() => {
    if (!search.trim()) return tabs

    const scored: { item: Tab; score: number }[] = []
    for (const item of tabs) {
      const match = fzfMatch(search, item.title || 'Untitled Chat')
      if (match) {
        scored.push({ item, score: 1 })
      }
    }
    return scored.map((r) => r.item)
  }, [tabs, search])

  useEffect(() => {
    setSelected(0)
  }, [search, tabs])

  useEffect(() => {
    // @ts-ignore
    itemRefs.current[selected]?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  useFocusLock(inputRef, true)

  useEffect(() => {
    inputRef.current?.focus()
    // @ts-ignore
    window.electron?.ipcRenderer.send('claim_window_focus')
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey

      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }

      if (e.key === '/') {
        const t = e.target as HTMLElement | null
        if (t !== inputRef.current) {
          e.preventDefault()
          inputRef.current?.focus()
          inputRef.current?.select()
          return
        }
      }

      if (e.key === 'ArrowDown' || (isCtrl && e.key.toLowerCase() === 'j')) {
        e.preventDefault()
        setSelected((prev) => (prev < results.length - 1 ? prev + 1 : prev))
        return
      }

      if (e.key === 'ArrowUp' || (isCtrl && e.key.toLowerCase() === 'k')) {
        e.preventDefault()
        setSelected((prev) => (prev > 0 ? prev - 1 : 0))
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        if (results[selected]) {
          open(results[selected])
        }
        return
      }

      if (isCtrl && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        const targetId = results[selected]?.id
        if (!targetId) return

        if (deleteConfirmId === targetId) {
          if (onDelete) onDelete(targetId)
          setDeleteConfirmId(null)
          if (selected >= results.length - 1 && selected > 0) {
            setSelected((s) => s - 1)
          }
        } else {
          setDeleteConfirmId(targetId)
          setTimeout(() => setDeleteConfirmId(null), 2000)
        }
      }
    }

    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [selected, results, deleteConfirmId, onClose, onDelete])

  const open = useCallback(
    (item: Tab) => {
      onOpen(item.id, item.url)
      onClose()
    },
    [onOpen, onClose]
  )

  const providerFor = (modelKey: string) => models.find((m) => m.key === modelKey)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-12 animate-fade-in bg-black/60 backdrop-blur-sm">
      <div
        className="bg-(--bg) w-full max-w-5xl h-[85vh] md:h-[75vh] rounded-2xl shadow-2xl flex overflow-hidden border border-(--border)"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-full md:w-1/2 flex flex-col border-r border-(--border)">
          <div className="p-4 border-b border-(--border) bg-(--surface) flex items-center gap-3 shrink-0">
            <IconSearch size={18} className="text-(--text2)" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search tabs..."
              className="flex-1 bg-transparent border-none outline-none text-(--text) placeholder-(--text2) font-medium"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="text-xs text-(--text2) font-mono flex gap-3">
              <span>CTRL+J/K to move</span>
              <span>CTRL+D delete</span>
              <span>ENTER to select</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar bg-(--surface)/30">
            {results.length === 0 && (
              <div className="p-8 text-center text-(--text2) flex flex-col items-center justify-center h-full">
                <div className="w-12 h-12 rounded-full bg-(--border) flex items-center justify-center mb-3">
                  <IconHistory size={20} className="text-(--text2)" />
                </div>
                <span>No tabs available.</span>
              </div>
            )}

            {results.map((item, i) => {
              const provDef = providerFor(item.model)
              return (
                <div
                  key={item.id}
                  ref={(el) => {
                    // @ts-ignore
                    itemRefs.current[i] = el
                  }}
                  className={`p-4 border-b border-(--border)/50 cursor-pointer group transition-colors flex flex-col gap-1 ${
                    i === selected
                      ? 'bg-(--border) border-l-2 border-l-[#e94560]'
                      : 'hover:bg-(--surface) border-l-2 border-l-transparent'
                  }`}
                  onClick={() => open(item)}
                  onMouseEnter={() => setSelected(i)}
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
                      <span className="truncate">{item.title || 'Untitled Chat'}</span>
                    </div>

                    {i === selected && (
                      <div className="flex items-center gap-1.5 ml-2">
                        {deleteConfirmId === item.id ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (onDelete) onDelete(item.id)
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
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setDeleteConfirmId(item.id)
                              setTimeout(() => setDeleteConfirmId(null), 2000)
                            }}
                            className="text-(--text2) hover:text-red-400 p-1"
                            title="Delete (Ctrl+D)"
                          >
                            <IconTrash size={13} />
                          </button>
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
              Select a tab to preview
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
