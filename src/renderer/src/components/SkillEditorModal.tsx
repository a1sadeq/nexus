import React, { useState, useEffect } from 'react'
import type { SkillDef } from '../../../shared/skills'

export interface SkillEditorModalProps {
  isOpen: boolean
  editingSkill?: SkillDef | null
  onClose: () => void
  onSave: (skill: SkillDef) => Promise<void>
  onDelete?: (skillId: string) => Promise<void>
}

export const SkillEditorModal: React.FC<SkillEditorModalProps> = ({
  isOpen,
  editingSkill,
  onClose,
  onSave,
  onDelete
}) => {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('Custom Skills')
  const [type, setType] = useState<'base' | 'action'>('action')
  const [command, setCommand] = useState('')
  const [autoSend, setAutoSend] = useState(false)
  const [content, setContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown, true);
    }
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (editingSkill) {
      setId(editingSkill.id)
      setName(editingSkill.name)
      setDescription(editingSkill.description)
      setCategory(editingSkill.category || 'Custom Skills')
      setType(editingSkill.type || 'action')
      setCommand(editingSkill.command || `/${editingSkill.id}`)
      setAutoSend(editingSkill.autoSend ?? false)
      setContent(editingSkill.content || '')
    } else {
      setId(`skill-${Date.now().toString(36)}`)
      setName('')
      setDescription('')
      setCategory('Custom Skills')
      setType('action')
      setCommand('/custom-skill')
      setAutoSend(false)
      setContent('# Custom Skill Prompt\n\nEnter your prompt instructions here.\nUse {{input}}, {{file}}, or {{clipboard}} for dynamic variables.')
    }
  }, [editingSkill, isOpen])

  if (!isOpen) return null

  const handleInsertTag = (tag: string): void => {
    setContent((prev) => `${prev} {{${tag}}}`)
  }

  const handleFormSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!name.trim() || !content.trim()) return

    setIsSaving(true)
    try {
      const cleanCommand = command.trim().startsWith('/') ? command.trim() : `/${command.trim()}`
      await onSave({
        id: id.trim() || name.toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
        name: name.trim(),
        description: description.trim(),
        category: category.trim() || 'Custom Skills',
        type,
        command: cleanCommand,
        autoSend,
        content: content.trim(),
        filePath: editingSkill?.filePath,
        isBuiltIn: editingSkill?.isBuiltIn
      })
      onClose()
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (!editingSkill || !onDelete) return
    if (window.confirm(`Are you sure you want to delete "${editingSkill.name}"?`)) {
      await onDelete(editingSkill.id)
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[88vh] animate-in zoom-in-95 duration-150"
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--border)',
          color: 'var(--text)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-(--border) flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-(--text)">
                {editingSkill ? `Edit Skill: ${editingSkill.name}` : 'Create New Skill'}
              </h2>
              <p className="text-xs text-(--text2)">
                Configure prompt templates, slash commands, and dynamic parameters.
              </p>
            </div>
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

        {/* Form Body */}
        <form onSubmit={handleFormSubmit} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 max-h-[60vh]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-(--text) mb-1">Skill Name *</label>
              <input
                type="text"
                required
                placeholder="e.g. Bug Bounty XSS Review"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-(--surface2) border border-(--border) text-xs text-(--text) focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-(--text) mb-1">Slash Command *</label>
              <input
                type="text"
                required
                placeholder="e.g. /xss-review"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-(--surface2) border border-(--border) text-xs text-(--text) font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-(--text) mb-1">Category</label>
              <input
                type="text"
                placeholder="e.g. Security & Bug Bounty"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-(--surface2) border border-(--border) text-xs text-(--text) focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-(--text) mb-1">Skill Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as 'base' | 'action')}
                className="w-full px-3 py-2 rounded-xl bg-(--surface2) border border-(--border) text-xs text-(--text) focus:outline-none focus:border-indigo-500"
              >
                <option value="action">Action Skill (On-Demand / Slash Command)</option>
                <option value="base">Base Skill (Session Metacognitive Setup)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-(--text) mb-1">Short Description</label>
            <input
              type="text"
              placeholder="One line summary of what this skill does..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-(--surface2) border border-(--border) text-xs text-(--text) focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Markdown Content */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-(--text)">Markdown Prompt Instructions *</label>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-(--text2) mr-1">Insert Variable:</span>
                <button
                  type="button"
                  onClick={() => handleInsertTag('input')}
                  className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/25 transition-colors"
                >
                  + {'{{input}}'}
                </button>
                <button
                  type="button"
                  onClick={() => handleInsertTag('file')}
                  className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/25 transition-colors"
                >
                  + {'{{file}}'}
                </button>
                <button
                  type="button"
                  onClick={() => handleInsertTag('clipboard')}
                  className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/25 transition-colors"
                >
                  + {'{{clipboard}}'}
                </button>
                <button
                  type="button"
                  onClick={() => handleInsertTag('command')}
                  className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/25 transition-colors"
                >
                  + {'{{command}}'}
                </button>
              </div>
            </div>

            <textarea
              rows={8}
              required
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="# Skill Instructions\n\nDirectives for the AI model..."
              className="w-full p-3 rounded-xl bg-(--surface2) border border-(--border) text-xs text-(--text) font-mono leading-relaxed focus:outline-none focus:border-indigo-500"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-(--text2) cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoSend}
              onChange={(e) => setAutoSend(e.target.checked)}
              className="accent-indigo-500 cursor-pointer"
            />
            <span>Auto-send prompt when skill is invoked</span>
          </label>
        </form>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-(--border) flex items-center justify-between bg-(--surface2)/40">
          <div>
            {editingSkill && onDelete && !editingSkill.isBuiltIn && (
              <button
                type="button"
                onClick={handleDelete}
                className="text-xs text-rose-400 hover:text-rose-300 font-medium transition-colors"
              >
                Delete Skill
              </button>
            )}
          </div>

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
              onClick={handleFormSubmit}
              disabled={isSaving || !name.trim() || !content.trim()}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-2 shadow-lg shadow-indigo-600/20 disabled:opacity-40 transition-all cursor-pointer"
            >
              {isSaving ? 'Saving…' : 'Save Skill'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
