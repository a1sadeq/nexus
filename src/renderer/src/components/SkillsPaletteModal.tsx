import React, { useState, useMemo, useEffect, useRef } from 'react'
import type { SkillDef } from '../../../shared/skills'
import { matchesShortcut, getShortcutKeys } from '../lib/shortcuts'
import { useFocusLock } from '../lib/useFocusLock'

export interface SkillsPaletteModalProps {
  isOpen: boolean
  skills: SkillDef[]
  onClose: () => void
  onSelectSkill: (skill: SkillDef) => void
  onOpenEditor: (skill?: SkillDef) => void
  onOpenBaseModal: () => void
  onDelete?: (skillId: string) => void
  onTogglePin?: (skillId: string) => void
  onOpenCategoryManager?: () => void
}

export const SkillsPaletteModal: React.FC<SkillsPaletteModalProps> = ({
  isOpen,
  skills,
  onClose,
  onSelectSkill,
  onOpenEditor,
  onOpenBaseModal,
  onDelete,
  onTogglePin,
  onOpenCategoryManager
}) => {
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('All')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
    }
  }, [isOpen])
  
  useFocusLock(inputRef, isOpen)

  const categories = useMemo(() => {
    const catUsage: Record<string, number> = {}
    let hasPinned = false
    
    for (const s of skills) {
      if (s.isPinned) hasPinned = true
      if (s.category) {
        catUsage[s.category] = (catUsage[s.category] || 0) + (s.usageCount || 0)
      }
    }

    const sortedCats = Object.keys(catUsage).sort((a, b) => catUsage[b] - catUsage[a])
    
    const cats = ['All']
    if (hasPinned) cats.push('Pinned')
    cats.push(...sortedCats)
    
    return cats
  }, [skills])

  const filtered = useMemo(() => {
    const filteredSkills = skills.filter((s) => {
      let matchesCat = false
      if (activeCategory === 'All') matchesCat = true
      else if (activeCategory === 'Pinned') matchesCat = s.isPinned === true
      else matchesCat = s.category === activeCategory

      const q = query.toLowerCase().trim()
      if (!q) return matchesCat
      const matchesText =
        s.name.toLowerCase().includes(q) ||
        s.command.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
      return matchesCat && matchesText
    })
    
    // Sort logic: Pinned first (if in 'All'), then by usage count
    filteredSkills.sort((a, b) => {
      if (activeCategory === 'All') {
        if (a.isPinned && !b.isPinned) return -1
        if (!a.isPinned && b.isPinned) return 1
      }
      const countA = a.usageCount || 0
      const countB = b.usageCount || 0
      if (countA !== countB) return countB - countA
      return a.name.localeCompare(b.name)
    })
    
    return filteredSkills
  }, [skills, activeCategory, query])

  // Reset selected index when filter changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query, activeCategory])

  const [showDeleteConfirmId, setShowDeleteConfirmId] = useState<string | null>(null)

  const handleKeyDown = (e: KeyboardEvent | React.KeyboardEvent): void => {
    const isMod = e.ctrlKey || e.metaKey
    const keyLower = e.key.toLowerCase()

    if (e.key === 'ArrowDown' || (isMod && keyLower === 'j')) {
      e.preventDefault()
      e.stopPropagation()
      setSelectedIndex((prev) => (filtered.length > 0 ? (prev + 1) % filtered.length : 0))
    } else if (e.key === 'ArrowUp' || (isMod && keyLower === 'k')) {
      e.preventDefault()
      e.stopPropagation()
      setSelectedIndex((prev) => (filtered.length > 0 ? (prev - 1 + filtered.length) % filtered.length : 0))
    } else if (isMod && (keyLower === 'h' || e.key === 'ArrowLeft')) {
      e.preventDefault()
      e.stopPropagation()
      const currentIdx = categories.indexOf(activeCategory)
      const nextIdx = (currentIdx - 1 + categories.length) % categories.length
      setActiveCategory(categories[nextIdx])
    } else if (isMod && (keyLower === 'l' || e.key === 'ArrowRight')) {
      e.preventDefault()
      e.stopPropagation()
      const currentIdx = categories.indexOf(activeCategory)
      const nextIdx = (currentIdx + 1) % categories.length
      setActiveCategory(categories[nextIdx])
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      if (filtered[selectedIndex]) {
        onSelectSkill(filtered[selectedIndex])
      }
    } else if (isMod && keyLower === 'p') {
      e.preventDefault()
      e.stopPropagation()
      const highlighted = filtered[selectedIndex]
      if (highlighted && onTogglePin) {
        onTogglePin(highlighted.id)
      }
    } else if (isMod && keyLower === 'e') {
      e.preventDefault()
      e.stopPropagation()
      const highlighted = filtered[selectedIndex]
      if (highlighted && onOpenEditor) {
        onOpenEditor(highlighted)
      }
    } else if (isMod && keyLower === 'd') {
      e.preventDefault()
      e.stopPropagation()
      const highlighted = filtered[selectedIndex]
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
      if (e.key === 'Escape' || e.key === 'Esc' || matchesShortcut(nativeEv, getShortcutKeys('skills-palette'))) {
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
  }, [isOpen, filtered, selectedIndex, activeCategory, categories])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[100000] flex items-start justify-center pt-16 sm:pt-20 px-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[80vh] animate-in zoom-in-95 duration-150"
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--border)',
          color: 'var(--text)',
          boxShadow: '0 20px 50px rgba(0,0,0,0.6)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="p-3.5 sm:p-4 border-b border-(--border) flex items-center gap-3 bg-(--surface)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400 shrink-0">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search skills by name, /command, or description..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent border-none text-sm text-(--text) placeholder:text-(--text2) focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenBaseModal}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 transition-colors flex items-center gap-1"
              title="Initialize Base Skills for session"
            >
              ⚡ Setup Base Skills
            </button>
            <button
              type="button"
              onClick={() => onOpenEditor()}
              className="p-1.5 rounded-lg text-(--text2) hover:text-(--text) hover:bg-(--surface2) transition-colors"
              title="Create New Skill"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Category Tabs */}
        <div className="px-3.5 py-2 border-b border-(--border) flex items-center gap-1.5 overflow-x-auto bg-(--surface2)/50 scrollbar-none relative">
          <div className="flex-1 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                activeCategory === cat
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-(--text2) hover:text-(--text) hover:bg-(--surface2)'
              }`}
            >
              {cat}
            </button>
          ))}
          </div>
          {onOpenCategoryManager && (
            <button
              type="button"
              onClick={onOpenCategoryManager}
              className="px-2 py-1 ml-2 rounded text-xs font-medium text-(--text2) hover:text-(--text) hover:bg-(--surface) border border-transparent hover:border-(--border) transition-all flex items-center gap-1 shrink-0"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Manage
            </button>
          )}
        </div>

        {/* Skills Results List */}
        <div className="flex-1 overflow-y-auto p-2 sm:p-3 space-y-1 max-h-[50vh]">
          {filtered.map((skill, idx) => {
            const isSelected = idx === selectedIndex
            const isBase = skill.type === 'base'
            return (
              <div
                key={skill.id}
                onClick={() => onSelectSkill(skill)}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between group ${
                  isSelected
                    ? 'bg-indigo-600/15 border-indigo-500/50 shadow-sm text-(--text)'
                    : 'bg-(--surface2)/30 border-transparent hover:bg-(--surface2)/60 hover:border-(--border) text-(--text2)'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 pr-3">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                      isBase
                        ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                        : 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30'
                    }`}
                  >
                    {isBase ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                      </svg>
                    ) : (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="4 17 10 11 4 5" />
                        <line x1="12" y1="19" x2="20" y2="19" />
                      </svg>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${isSelected ? 'text-(--text)' : 'text-(--text)'}`}>
                        {skill.name}
                      </span>
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-(--surface) text-(--text2) border border-(--border)">
                        {skill.command}
                      </span>
                      <span className="text-[10px] text-(--text2) opacity-70">
                        {skill.category}
                      </span>
                    </div>
                    <p className="text-[11px] text-(--text2) truncate mt-0.5 max-w-md">
                      {skill.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0 ">
                  <div className="flex items-center gap-0.5  mr-1">
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
                        onOpenEditor(skill)
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
                        className="px-2 py-1 bg-red-500 hover:bg-red-600 text-white text-[10px] font-bold rounded-lg transition-colors ml-1"
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
                  
                  {showDeleteConfirmId !== skill.id && (
                    <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                      {isSelected ? 'Enter ↵' : 'Select'}
                    </span>
                  )}
                </div>
              </div>
            )
          })}

          {filtered.length === 0 && (
            <div className="p-8 text-center text-xs text-(--text2)">
              No skills found matching &quot;{query}&quot;. Press <strong className="text-(--text)">+</strong> above to create one.
            </div>
          )}
        </div>

        {/* Footer info bar */}
        <div className="px-4 py-2.5 border-t border-(--border) flex items-center justify-between text-[11px] text-(--text2) bg-(--surface2)/40 font-mono">
          <div className="flex items-center gap-3">
            <span><kbd className="px-1 py-0.5 bg-(--surface) border border-(--border) rounded">↑↓</kbd> Navigate</span>
            <span><kbd className="px-1 py-0.5 bg-(--surface) border border-(--border) rounded">Enter</kbd> Use Skill</span>
            <span><kbd className="px-1 py-0.5 bg-(--surface) border border-(--border) rounded">Esc</kbd> Close</span>
          </div>
          <span>{skills.length} skills active</span>
        </div>
      </div>
    </div>
  )
}
