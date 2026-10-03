import React, { useState, useMemo, useEffect, useRef } from 'react'
import type { SkillDef } from '../../../shared/skills'
import { useFocusLock } from '../lib/useFocusLock'

export interface CategoryManagerModalProps {
  isOpen: boolean
  skills: SkillDef[]
  onClose: () => void
}

export const CategoryManagerModal: React.FC<CategoryManagerModalProps> = ({
  isOpen,
  skills,
  onClose
}) => {
  const [pinnedCategories, setPinnedCategories] = useState<Set<string>>(new Set())
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  
  // Right pane state
  const [search, setSearch] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Fetch pinned categories on mount/open
  const refreshPinned = async () => {
    try {
      const arr = await window.electron?.skills?.getPinnedCategories()
      if (arr) setPinnedCategories(new Set(arr))
    } catch {}
  }
  useEffect(() => {
    if (isOpen) refreshPinned()
  }, [isOpen])

  // Derive categories
  const categories = useMemo(() => {
    const cats = new Set<string>()
    for (const s of skills) {
      if (s.category) cats.add(s.category)
    }
    for (const p of pinnedCategories) {
      cats.add(p)
    }
    return Array.from(cats).sort()
  }, [skills, pinnedCategories])

  // Select first category automatically if none selected
  useEffect(() => {
    if (isOpen && categories.length > 0 && !activeCategory) {
      setActiveCategory(categories[0])
    }
  }, [isOpen, categories, activeCategory])

  // Pre-fill selected skills when activeCategory changes
  useEffect(() => {
    if (activeCategory) {
      const ids = skills.filter(s => s.category === activeCategory).map(s => s.id)
      setSelectedIds(new Set(ids))
    } else {
      setSelectedIds(new Set())
    }
    setSearch('')
    setFocusedIndex(0)
  }, [activeCategory, skills])

  // Filter skills for right pane
  const filteredSkills = useMemo(() => {
    if (!search) return skills
    const q = search.toLowerCase()
    return skills.filter(s => 
      s.name.toLowerCase().includes(q) || 
      s.description.toLowerCase().includes(q)
    )
  }, [skills, search])

  // Use Focus Lock
  useFocusLock(searchInputRef, isOpen)

  // Handlers
  const handleTogglePin = async (cat: string) => {
    await window.electron?.skills?.toggleCategoryPin(cat)
    await refreshPinned()
  }

  const handleDeleteCat = async (cat: string) => {
    if (confirm(`Are you sure you want to remove the category "\${cat}"? Skills inside it will be moved to "All".`)) {
      await window.electron?.skills?.deleteCategory(cat)
      if (activeCategory === cat) setActiveCategory(null)
      await refreshPinned()
    }
  }

  const handleCreateCat = async () => {
    const name = prompt('Enter new category name:')
    if (name && name.trim()) {
      const trimmed = name.trim()
      // To create an empty category, we just pin it!
      await window.electron?.skills?.toggleCategoryPin(trimmed)
      await refreshPinned()
      setActiveCategory(trimmed)
    }
  }

  const handleToggleSkill = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const handleSaveAssignments = async () => {
    if (!activeCategory) return
    await window.electron?.skills?.assignSkillsToCategory(activeCategory, Array.from(selectedIds))
    // We don't automatically close, letting user continue editing
  }

  // Keyboard navigation for right pane
  const handleKeyDown = (e: KeyboardEvent | React.KeyboardEvent) => {
    const isMod = e.ctrlKey || e.metaKey
    const keyLower = e.key.toLowerCase()

    if (e.key === 'ArrowDown' || (isMod && keyLower === 'j')) {
      e.preventDefault()
      e.stopPropagation()
      setFocusedIndex(p => filteredSkills.length > 0 ? (p + 1) % filteredSkills.length : 0)
    } else if (e.key === 'ArrowUp' || (isMod && keyLower === 'k')) {
      e.preventDefault()
      e.stopPropagation()
      setFocusedIndex(p => filteredSkills.length > 0 ? (p - 1 + filteredSkills.length) % filteredSkills.length : 0)
    } else if (e.key === 'Enter' && !isMod && !e.altKey) {
      e.preventDefault()
      e.stopPropagation()
      if (filteredSkills[focusedIndex]) {
        handleToggleSkill(filteredSkills[focusedIndex].id)
      }
    } else if (e.altKey && e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      handleSaveAssignments()
    } else {
            if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
  }

  useEffect(() => {
    if (!isOpen) return
    const onWindowKeyDown = (e: KeyboardEvent) => handleKeyDown(e)
    window.addEventListener('keydown', onWindowKeyDown, true)
    return () => window.removeEventListener('keydown', onWindowKeyDown, true)
  }, [isOpen, filteredSkills, focusedIndex, selectedIds, activeCategory])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl h-[75vh] rounded-2xl border shadow-2xl flex overflow-hidden animate-in zoom-in-95 duration-150"
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--border)',
          color: 'var(--text)'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Left Pane: Categories */}
        <div className="w-1/3 shrink-0 border-r border-(--border) flex flex-col bg-(--surface2)/20" style={{ minWidth: "250px" }}>
          <div className="p-4 border-b border-(--border) flex items-center justify-between">
            <h2 className="font-bold text-sm">Categories</h2>
            <button
              onClick={handleCreateCat}
              className="p-1 rounded hover:bg-(--surface) text-(--text2) hover:text-(--text) transition-colors"
              title="Create new category"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {categories.map(cat => (
              <div
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors \${
                  activeCategory === cat ? 'bg-indigo-500/20 text-indigo-300' : 'hover:bg-(--surface)'
                }`}
              >
                <span className="text-sm truncate pr-2">{cat}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleTogglePin(cat) }}
                    className={`p-1 rounded hover:bg-(--surface2) \${pinnedCategories.has(cat) ? 'text-amber-400' : 'text-(--text2) hover:text-(--text)'}`}
                    title="Pin Category"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteCat(cat) }}
                    className="p-1 rounded hover:bg-red-500/20 text-(--text2) hover:text-red-400"
                    title="Remove Category"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Pane: Skills Assignment */}
        <div className="flex-1 flex flex-col bg-(--surface) min-w-0">
          {activeCategory ? (
            <>
              <div className="p-4 border-b border-(--border) flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-sm">Assign Skills to "{activeCategory}"</h2>
                  <p className="text-xs text-(--text2)">Check skills to add them to this category.</p>
                </div>
                <button
                  onClick={handleSaveAssignments}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
                  title="Alt+Enter"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Save (Alt+Enter)
                </button>
              </div>
              <div className="p-3 border-b border-(--border)">
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search skills to assign..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full bg-(--surface2)/50 text-(--text) text-sm px-3 py-2 rounded-lg border border-(--border) focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-1">
                {filteredSkills.map((skill, idx) => {
                  const isChecked = selectedIds.has(skill.id)
                  
                  return (
                    <div
                      key={skill.id}
                      onClick={() => { setFocusedIndex(idx); handleToggleSkill(skill.id) }}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors \${
                        isFocused ? 'bg-(--surface2) border-indigo-500/30 border' : 'border border-transparent hover:bg-(--surface2)/50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                        className="cursor-pointer"
                      />
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold truncate text-(--text)">{skill.name}</h4>
                        <p className="text-xs text-(--text2) truncate">{skill.description}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-(--text2)">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mb-4 opacity-50">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
              </svg>
              <p>Select or create a category to manage skills.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
