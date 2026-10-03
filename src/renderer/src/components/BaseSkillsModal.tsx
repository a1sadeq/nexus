import React, { useState, useMemo, useEffect } from 'react'
import type { SkillDef } from '../../../shared/skills'
import { matchesShortcut, getShortcutKeys } from '../lib/shortcuts'
import { useFocusLock } from '../lib/useFocusLock'

export interface BaseSkillsModalProps {
  isOpen: boolean
  skills: SkillDef[]
  onClose: () => void
  onInject: (selectedSkills: SkillDef[]) => Promise<void>
  onDelete?: (skillId: string) => void
  onTogglePin?: (skillId: string) => void
  onOpenEditor?: (skill: SkillDef) => void
}

const FALLBACK_BASE_SKILLS: SkillDef[] = [
  {
    id: 'cybersecurity-mindset',
    name: 'Top 1% Bug Hunter Mindset',
    description: 'Offensive security reasoning: high-impact vulnerabilities, IDOR, XSS, auth bypass, and edge cases.',
    category: 'Cybersecurity & Bug Bounty',
    type: 'base',
    command: '/bug-hunter',
    content: `# 🧠 Top 1% Bug Hunter Mindset & Offensive Security Rules`
  },
  {
    id: 'systematic-debugging',
    name: 'Systematic Debugging Protocol',
    description: 'Hypothesis-driven root cause investigation without speculative guesswork.',
    category: 'Base Reasoning & Mindset',
    type: 'base',
    command: '/debug',
    content: `# 🔍 Systematic Debugging Protocol`
  },
  {
    id: 'brainstorming',
    name: 'Deep Brainstorming Protocol',
    description: 'Explore problem space, architectural trade-offs, and edge cases with clarifying questions.',
    category: 'Base Reasoning & Mindset',
    type: 'base',
    command: '/brainstorm',
    content: `# 💡 Deep Brainstorming Protocol`
  },
  {
    id: 'confidence-check',
    name: 'Confidence Check',
    description: 'Pre-implementation readiness verification: eliminate assumptions and verify contracts.',
    category: 'Base Reasoning & Mindset',
    type: 'base',
    command: '/confidence-check',
    content: `# 🎯 Confidence & Readiness Verification`
  }
]

export const BaseSkillsModal: React.FC<BaseSkillsModalProps> = ({
  isOpen,
  skills,
  onClose,
  onInject,
  onDelete,
  onTogglePin,
  onOpenEditor
}) => {
  const baseSkills = useMemo(() => {
    const list = skills.filter((s) => s.type === 'base')
    return list.length > 0 ? list : FALLBACK_BASE_SKILLS
  }, [skills])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('nexus.default_base_skills')
      if (saved) return new Set(JSON.parse(saved))
    } catch {}
    return new Set(baseSkills.map((s) => s.id))
  })
  const [search, setSearch] = useState('')
  const [isInjecting, setIsInjecting] = useState(false)

  // Sync when defaultBaseSkills changes or baseSkills load for first time
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem('nexus.default_base_skills')
      if (saved) {
        setSelectedIds(new Set(JSON.parse(saved)))
        return
      }
    } catch {}
    setSelectedIds(new Set(baseSkills.map((s) => s.id)))
  }, [baseSkills, isOpen])

  const [focusedIndex, setFocusedIndex] = useState(0)
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (isOpen) {
      setSearch('')
      setFocusedIndex(0)
    }
  }, [isOpen])

  useFocusLock(searchInputRef, isOpen)

  const filtered = baseSkills.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase()) ||
      s.category.toLowerCase().includes(search.toLowerCase())
  )

  const isAllSelected = baseSkills.length > 0 && selectedIds.size === baseSkills.length

  const handleToggleAll = (): void => {
    if (isAllSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(baseSkills.map((s) => s.id)))
    }
  }

  const handleToggleOne = (id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleExecuteInject = async (): Promise<void> => {
    const selected = baseSkills.filter((s) => selectedIds.has(s.id))
    if (selected.length === 0) return
    setIsInjecting(true)
    try {
      await onInject(selected)
      onClose()
    } finally {
      setIsInjecting(false)
    }
  }

  const [showDeleteConfirmId, setShowDeleteConfirmId] = useState<string | null>(null)

  const handleKeyDown = (e: KeyboardEvent | React.KeyboardEvent): void => {
    const isMod = e.ctrlKey || e.metaKey
    const keyLower = e.key.toLowerCase()

    if (e.key === 'ArrowDown' || (isMod && keyLower === 'j')) {
      e.preventDefault()
      e.stopPropagation()
      setFocusedIndex((prev) => (filtered.length > 0 ? (prev + 1) % filtered.length : 0))
    } else if (e.key === 'ArrowUp' || (isMod && keyLower === 'k')) {
      e.preventDefault()
      e.stopPropagation()
      setFocusedIndex((prev) => (filtered.length > 0 ? (prev - 1 + filtered.length) % filtered.length : 0))
    } else if (e.key === ' ' && document.activeElement !== searchInputRef.current) {
      e.preventDefault()
      e.stopPropagation()
      if (filtered[focusedIndex]) {
        handleToggleOne(filtered[focusedIndex].id)
      }
    } else if (isMod && keyLower === 'a') {
      e.preventDefault()
      e.stopPropagation()
      handleToggleAll()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      handleExecuteInject()
    } else if (isMod && keyLower === 'p') {
      e.preventDefault()
      e.stopPropagation()
      const highlighted = filtered[focusedIndex]
      if (highlighted && onTogglePin) {
        onTogglePin(highlighted.id)
      }
    } else if (isMod && keyLower === 'e') {
      e.preventDefault()
      e.stopPropagation()
      const highlighted = filtered[focusedIndex]
      if (highlighted && onOpenEditor) {
        onOpenEditor(highlighted)
      }
    } else if (isMod && keyLower === 'd') {
      e.preventDefault()
      e.stopPropagation()
      const highlighted = filtered[focusedIndex]
      if (highlighted && !highlighted.isBuiltIn && onDelete) {
        if (showDeleteConfirmId === highlighted.id) {
          onDelete(highlighted.id)
          setShowDeleteConfirmId(null)
        } else {
          setShowDeleteConfirmId(highlighted.id)
        }
      }
    } else {
      const nativeEv = 'nativeEvent' in e ? e.nativeEvent : e
      if (e.key === 'Escape' || e.key === 'Esc' || matchesShortcut(nativeEv, getShortcutKeys('skills-base-modal'))) {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
  }

  // Capture global keydown events while modal is open so shortcuts don't leak to background app
  useEffect(() => {
    if (!isOpen) return
    const onWindowKeyDown = (e: KeyboardEvent) => {
      handleKeyDown(e)
    }
    window.addEventListener('keydown', onWindowKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onWindowKeyDown, true)
    }
  }, [isOpen, filtered, focusedIndex, isAllSelected, selectedIds])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150"
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--border)',
          color: 'var(--text)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-(--border) flex items-center justify-between">
          <div className="flex flex-1 items-center justify-between mr-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </div>
              <div>
                <h2 className="text-base font-bold text-(--text)">Initialize SuperAntigravity Base Skills</h2>
                <p className="text-xs text-(--text2)">
                  Select the base reasoning frameworks and directives to activate in this AI chat session.
                </p>
              </div>
            </div>
            {onOpenEditor && (
              <button
                type="button"
                onClick={() => onOpenEditor({ type: 'base', name: 'New Base Skill', category: 'Custom', description: '', content: '' } as any)}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-sm cursor-pointer whitespace-nowrap ml-4"
              >
                + Create Base Skill
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-(--text2) hover:text-(--text) hover:bg-(--surface2) transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Toolbar: Search + Select All */}
        <div className="px-5 py-3 border-b border-(--border) flex items-center justify-between gap-3 bg-(--surface2)/50">
          <div className="relative flex-1">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search base skills... (Ctrl+J/K to navigate, Space to toggle, Enter to inject)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-(--surface) border border-(--border) text-xs text-(--text) focus:outline-none focus:border-amber-500"
            />
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-(--text2)">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>

          <button
            type="button"
            onClick={handleToggleAll}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-all ${
              isAllSelected
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                : 'bg-(--surface) border-(--border) text-(--text2) hover:text-(--text)'
            }`}
          >
            <input
              type="checkbox"
              checked={isAllSelected}
              onChange={handleToggleAll}
              className="cursor-pointer"
            />
            Use All Base Skills ({baseSkills.length})
          </button>
        </div>

        {/* Skills Cards List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2.5 max-h-[50vh]">
          {filtered.map((skill, idx) => {
            const isChecked = selectedIds.has(skill.id)
            const isFocused = focusedIndex === idx
            return (
              <div
                key={skill.id}
                onClick={() => {
                  setFocusedIndex(idx)
                  handleToggleOne(skill.id)
                }}
                className={`group p-3.5 rounded-xl border transition-all cursor-pointer flex items-start gap-3 select-none ${
                  isFocused ? 'ring-2 ring-amber-500/60 ' : ''
                }${
                  isChecked
                    ? 'bg-amber-500/10 border-amber-500/30 shadow-sm'
                    : 'bg-(--surface2)/40 border-(--border) hover:bg-(--surface2) hover:border-(--border)'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => handleToggleOne(skill.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1 cursor-pointer accent-amber-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-(--text)">{skill.name}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-(--surface2) text-(--text2) border border-(--border)">
                      {skill.command}
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-400 font-medium ml-auto">
                      {skill.category}
                    </span>
                  </div>
                  <p className="text-xs text-(--text2) line-clamp-2 leading-relaxed">
                    {skill.description}
                  </p>
                </div>
                
                <div className="flex flex-col gap-1  items-center">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onTogglePin?.(skill.id)
                    }}
                    className={`p-1.5 rounded-lg hover:bg-(--surface) transition-colors ${skill.isPinned ? 'text-amber-400' : 'text-(--text2) hover:text-(--text)'}`}
                    title="Pin Skill (Ctrl+P)"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill={skill.isPinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 17v5" />
                      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenEditor?.(skill)
                    }}
                    className="p-1.5 rounded-lg hover:bg-(--surface) text-(--text2) hover:text-(--text) transition-colors"
                    title="Edit Skill (Ctrl+E)"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  {showDeleteConfirmId === skill.id ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete?.(skill.id)
                        setShowDeleteConfirmId(null)
                      }}
                      className="px-2 py-1 bg-red-500 hover:bg-red-600 text-white text-[10px] font-bold rounded-lg transition-colors"
                      title="Confirm Delete"
                    >
                      Delete?
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowDeleteConfirmId(skill.id)
                      }}
                      className="p-1.5 rounded-lg hover:bg-red-500/20 text-(--text2) hover:text-red-400 transition-colors"
                      title="Delete Skill (Ctrl+D)"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18" />
                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          {filtered.length === 0 && (
            <div className="p-8 text-center text-xs text-(--text2)">
              No base skills matched your query.
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 border-t border-(--border) flex items-center justify-between bg-(--surface2)/40">
          <span className="text-xs text-(--text2)">
            <strong className="text-(--text)">{selectedIds.size}</strong> of {baseSkills.length} base skills selected
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl text-xs font-medium border border-(--border) hover:bg-(--surface2) transition-colors text-(--text2) hover:text-(--text)"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleExecuteInject}
              disabled={selectedIds.size === 0 || isInjecting}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-black flex items-center gap-2 shadow-lg shadow-amber-500/20 disabled:opacity-40 transition-all cursor-pointer"
            >
              {isInjecting ? (
                <>
                  <svg className="animate-spin h-3.5 w-3.5 text-black" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Injecting into Chat…
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  Inject & Initialize Chat
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
