import React, { useState, useEffect, useMemo } from 'react'
import type { SkillDef } from '../../../shared/skills'
import { IconSearch, IconZap, IconPlus, IconTrash, IconPencil, IconTerminal, IconShield } from './BrandIcons'

interface Props {
  onOpenEditor?: (skill?: SkillDef) => void
}

const DEFAULT_BASE_SKILLS_KEY = 'nexus.default_base_skills'

export const SkillsSettingsSection: React.FC<Props> = ({ onOpenEditor }) => {
  const [skills, setSkills] = useState<SkillDef[]>([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('All')
  const [safeCommands, setSafeCommands] = useState<string[]>([])
  const [newSafeCommand, setNewSafeCommand] = useState('')
  const [skillsDir, setSkillsDir] = useState<string>('')
  const [defaultBaseSkills, setDefaultBaseSkills] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(DEFAULT_BASE_SKILLS_KEY)
      return saved ? JSON.parse(saved) : ['brainstorming', 'systematic-debugging']
    } catch {
      return ['brainstorming', 'systematic-debugging']
    }
  })

  const loadSkills = async () => {
    try {
      const list = await window.electron?.skills?.list()
      if (Array.isArray(list)) setSkills(list)
      const dir = await window.electron?.skills?.getSkillsDir()
      if (dir) setSkillsDir(dir)
      const cmds = await window.electron?.skills?.getSafeCommands()
      if (Array.isArray(cmds)) setSafeCommands(cmds)
    } catch (err) {
      console.error('Failed to load skills settings:', err)
    }
  }

  useEffect(() => {
    loadSkills()
    const unsubscribe = window.electron?.skills?.onUpdated?.(() => {
      loadSkills()
    })
    return () => {
      unsubscribe?.()
    }
  }, [])

  const categories = useMemo(() => {
    const set = new Set<string>(['All'])
    for (const s of skills) {
      if (s.category) set.add(s.category)
    }
    return Array.from(set)
  }, [skills])

  const filteredSkills = useMemo(() => {
    return skills.filter((s) => {
      const matchCat = category === 'All' || s.category === category
      const q = search.trim().toLowerCase()
      if (!q) return matchCat
      const matchText =
        s.name.toLowerCase().includes(q) ||
        s.command.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
      return matchCat && matchText
    })
  }, [skills, category, search])

  const handleOpenSkillsFolder = async () => {
    await window.electron?.skills?.openSkillsDir()
  }

  const handleDeleteSkill = async (id: string) => {
    if (confirm(`Are you sure you want to delete the skill "${id}"?`)) {
      await window.electron?.skills?.delete(id)
      loadSkills()
    }
  }

  const handleAddSafeCommand = async () => {
    const trimmed = newSafeCommand.trim()
    if (!trimmed) return
    await window.electron?.skills?.addSafeCommand(trimmed)
    setNewSafeCommand('')
    const cmds = await window.electron?.skills?.getSafeCommands()
    if (Array.isArray(cmds)) setSafeCommands(cmds)
  }

  const handleRemoveSafeCommand = async (cmd: string) => {
    await window.electron?.skills?.removeSafeCommand(cmd)
    const cmds = await window.electron?.skills?.getSafeCommands()
    if (Array.isArray(cmds)) setSafeCommands(cmds)
  }

  const toggleBaseSkill = (id: string) => {
    const updated = defaultBaseSkills.includes(id)
      ? defaultBaseSkills.filter((s) => s !== id)
      : [...defaultBaseSkills, id]
    setDefaultBaseSkills(updated)
    localStorage.setItem(DEFAULT_BASE_SKILLS_KEY, JSON.stringify(updated))
  }

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto h-full text-sm p-4 overflow-y-auto custom-scrollbar" style={{ color: 'var(--text)' }}>
      {/* Top Banner */}
      <div
        className="p-5 rounded-2xl border flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm"
        style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
            <IconZap size={22} />
          </div>
          <div>
            <h2 className="text-base font-bold flex items-center gap-2">
              SuperAntigravity Skills & Tools
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-normal">
                {skills.length} Loaded
              </span>
            </h2>
            <p className="text-xs opacity-70 mt-0.5" style={{ color: 'var(--text2)' }}>
              Autonomous reasoning protocols, workflow slash commands, and local workspace tools.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleOpenSkillsFolder}
            className="px-3 py-2 rounded-xl text-xs font-semibold border transition-all hover:bg-(--surface) flex items-center gap-1.5 cursor-pointer"
            style={{ background: 'var(--surface2)', borderColor: 'var(--border)', color: 'var(--text)' }}
            title={`Open folder: ${skillsDir}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <span>Open Skills Folder</span>
          </button>

          {onOpenEditor && (
            <button
              type="button"
              onClick={() => onOpenEditor()}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <IconPlus size={13} />
              <span>New Skill</span>
            </button>
          )}
        </div>
      </div>

      {/* Skills Library */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-sm tracking-wide uppercase" style={{ color: 'var(--text2)' }}>
              Skills Catalog
            </h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-(--surface2) text-(--text2)">
              Press Ctrl+S to trigger
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <IconSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-(--text2)" />
              <input
                type="text"
                placeholder="Search skills..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 rounded-xl text-xs bg-(--surface2) border border-(--border) text-(--text) focus:outline-none focus:border-indigo-500 w-44"
              />
            </div>
          </div>
        </div>

        {/* Categories Bar */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                category === cat
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-(--surface2) text-(--text2) hover:text-(--text) hover:bg-(--border)'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Skill Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-1">
          {filteredSkills.map((skill) => {
            const isBase = skill.type === 'base'
            return (
              <div
                key={skill.id}
                className="p-4 rounded-2xl border flex flex-col justify-between gap-3 group transition-all hover:border-indigo-500/40"
                style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-md">
                        {skill.command}
                      </span>
                      <span className="font-semibold text-sm text-(--text)">
                        {skill.name}
                      </span>
                    </div>

                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full uppercase font-bold tracking-wider ${
                        isBase
                          ? 'bg-purple-500/20 text-purple-300'
                          : 'bg-emerald-500/20 text-emerald-300'
                      }`}
                    >
                      {isBase ? 'Framework Rule' : 'Action'}
                    </span>
                  </div>

                  <p className="text-xs text-(--text2) line-clamp-2 leading-relaxed">
                    {skill.description}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-(--border)/60 text-xs">
                  <span className="text-[11px] text-(--text2) opacity-70">
                    {skill.category || 'General'}
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => window.electron?.skills?.togglePin(skill.id).catch(()=>{})}
                      className={`p-1 rounded transition-colors cursor-pointer ${skill.isPinned ? 'text-amber-400' : 'text-(--text2) hover:text-(--text) hover:bg-(--surface)'}`}
                      title="Pin Skill"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill={skill.isPinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 17v5" />
                        <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                      </svg>
                    </button>
                    {onOpenEditor && (
                      <button
                        type="button"
                        onClick={() => onOpenEditor(skill)}
                        className="p-1 rounded text-(--text2) hover:text-indigo-400 hover:bg-(--surface) transition-colors cursor-pointer"
                        title="Edit Skill"
                      >
                        <IconPencil size={13} />
                      </button>
                    )}
                    {!skill.isBuiltIn && (
                      <button
                        type="button"
                        onClick={() => handleDeleteSkill(skill.id)}
                        className="p-1 rounded text-(--text2) hover:text-red-400 hover:bg-(--surface) transition-colors cursor-pointer"
                        title="Delete Skill"
                      >
                        <IconTrash size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Security & Safe Commands Whitelist Card */}
      <div
        className="p-5 rounded-2xl border flex flex-col gap-4 shadow-sm"
        style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
            <IconShield size={20} />
          </div>
          <div>
            <h3 className="font-bold text-sm text-(--text)">Workspace Security & Safe Commands Whitelist</h3>
            <p className="text-xs text-(--text2) mt-0.5">
              Whitelisted read-only commands run automatically. Non-whitelisted commands request your permission before executing.
            </p>
          </div>
        </div>

        {/* Command Add Input */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <IconTerminal size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-(--text2)" />
            <input
              type="text"
              placeholder="e.g. git log, pytest, cargo test..."
              value={newSafeCommand}
              onChange={(e) => setNewSafeCommand(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddSafeCommand()}
              className="w-full pl-9 pr-3 py-2 rounded-xl text-xs bg-(--surface2) border border-(--border) text-(--text) font-mono focus:outline-none focus:border-amber-500"
            />
          </div>
          <button
            type="button"
            onClick={handleAddSafeCommand}
            className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-sm cursor-pointer"
          >
            + Add to Safe List
          </button>
        </div>

        {/* Safe Commands Tags */}
        <div className="flex flex-wrap gap-2 pt-1">
          {safeCommands.map((cmd) => (
            <div
              key={cmd}
              className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-(--surface2) border border-(--border) font-mono text-xs text-(--text)"
            >
              <span>{cmd}</span>
              <button
                type="button"
                onClick={() => handleRemoveSafeCommand(cmd)}
                className="text-(--text2) hover:text-red-400 cursor-pointer font-bold leading-none"
                title="Remove from whitelist"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Base Skills Defaults Card */}
      <div
        className="p-5 rounded-2xl border flex flex-col gap-4 shadow-sm"
        style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center shrink-0">
              <IconZap size={20} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-(--text)">Default Base Skills Framework</h3>
              <p className="text-xs text-(--text2) mt-0.5">
                Select which foundational SuperAntigravity specialist skills are ready to inject into new AI chat sessions.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenEditor && onOpenEditor({ type: 'base' } as any)}
            className="px-3.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-sm cursor-pointer whitespace-nowrap shrink-0"
          >
            + Create Base Skill
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
          {skills
            .filter((s) => s.type === 'base')
            .map((s) => {
              const isChecked = defaultBaseSkills.includes(s.id)
              return (
                <label
                  key={s.id}
                  className={`group p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                    isChecked
                      ? 'bg-purple-500/10 border-purple-500/40 text-(--text)'
                      : 'bg-(--surface2) border-(--border) text-(--text2) hover:text-(--text)'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleBaseSkill(s.id)}
                    className="accent-purple-500 mt-0.5 cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-xs text-(--text)">{s.name}</div>
                    <div className="text-[11px] opacity-75 line-clamp-1 mt-0.5">{s.description}</div>
                  </div>
                  
                  <div className="flex items-center gap-0.5 ml-2 ">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        window.electron?.skills?.togglePin(s.id).catch(()=>{})
                      }}
                      className={`p-1 rounded-md transition-colors ${s.isPinned ? 'text-amber-400' : 'text-(--text2) hover:text-(--text) hover:bg-(--surface)'}`}
                      title="Pin Skill"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill={s.isPinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 17v5" />
                        <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                      </svg>
                    </button>
                    {onOpenEditor && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault()
                          onOpenEditor(s)
                        }}
                        className="p-1 rounded-md text-(--text2) hover:text-purple-400 hover:bg-(--surface) transition-colors cursor-pointer"
                        title="Edit Skill"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                    )}
                    {!s.isBuiltIn && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault()
                          handleDeleteSkill(s.id)
                        }}
                        className="p-1 rounded-md text-(--text2) hover:text-red-400 hover:bg-(--surface) transition-colors cursor-pointer"
                        title="Delete Skill"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18" />
                          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                        </svg>
                      </button>
                    )}
                  </div>
                </label>
              )
            })}
        </div>
      </div>
    </div>
  )
}
