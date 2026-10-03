import React, { useState, useEffect, useRef } from 'react'

export interface ProjectDirBadgeProps {
  currentDir?: string
  onChangeDir: (newDir?: string) => void
}

const RECENT_DIRS_KEY = 'nexus_recent_project_dirs'

export const ProjectDirBadge: React.FC<ProjectDirBadgeProps> = ({ currentDir, onChangeDir }) => {
  const [isOpen, setIsOpen] = useState(false)
  const [customInput, setCustomInput] = useState('')
  const [recentDirs, setRecentDirs] = useState<string[]>([])
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_DIRS_KEY)
      if (stored) {
        setRecentDirs(JSON.parse(stored))
      }
    } catch {
      // ignore
    }
  }, [])

  const saveRecentDir = (dirPath: string): void => {
    try {
      const normalized = dirPath.trim()
      if (!normalized) return
      const updated = [normalized, ...recentDirs.filter((d) => d !== normalized)].slice(0, 8)
      setRecentDirs(updated)
      localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(updated))
    } catch {
      // ignore
    }
  }

  const handleBrowse = async (): Promise<void> => {
    try {
      const selected = await window.electron?.skills?.chooseProjectDir()
      if (selected) {
        onChangeDir(selected)
        saveRecentDir(selected)
        setIsOpen(false)
      }
    } catch (err) {
      console.error('Failed to open directory picker:', err)
    }
  }

  const handleApplyCustom = (): void => {
    const trimmed = customInput.trim()
    if (trimmed) {
      onChangeDir(trimmed)
      saveRecentDir(trimmed)
      setCustomInput('')
      setIsOpen(false)
    }
  }

  const handleClear = (): void => {
    onChangeDir(undefined)
    setIsOpen(false)
  }

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return (): void => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const globalDir = typeof window !== 'undefined' ? localStorage.getItem('nexus.global_project_dir') || '' : ''
  const effectiveDir = currentDir || globalDir
  const isFallback = !currentDir && !!globalDir

  const dirBasename = effectiveDir
    ? (isFallback
        ? `(Global) ${effectiveDir.split(/[/\\]/).filter(Boolean).pop() || effectiveDir}`
        : (effectiveDir.split(/[/\\]/).filter(Boolean).pop() || effectiveDir))
    : 'No Project Dir'

  return (
    <div className="relative" ref={dropdownRef} style={{ WebkitAppRegion: 'no-drag' } as any}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
          effectiveDir
            ? isFallback
              ? 'bg-(--surface2) border-blue-500/40 text-(--text) hover:border-blue-500/80 shadow-sm'
              : 'bg-(--surface2) border-indigo-500/40 text-(--text) hover:border-indigo-500/80 shadow-sm'
            : 'bg-(--surface) border-(--border) text-(--text2) hover:text-(--text) hover:bg-(--surface2)'
        }`}
        title={effectiveDir ? (isFallback ? `Global Project Directory: ${effectiveDir}` : `Tab Project Directory: ${effectiveDir}`) : 'Set Project / Working Directory for this chat'}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={effectiveDir ? (isFallback ? 'text-blue-400' : 'text-indigo-400') : 'text-(--text2)'}>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <span className="max-w-[120px] truncate">{dirBasename}</span>
      </button>

      {isOpen && (
        <div
          className="absolute right-0 top-full mt-2 w-80 rounded-xl border p-3 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150"
          style={{
            background: 'var(--surface)',
            borderColor: 'var(--border)',
            boxShadow: '0 12px 36px rgba(0,0,0,0.5)'
          }}
        >
          <div className="flex items-center justify-between pb-2 border-b border-(--border) mb-2.5">
            <span className="text-xs font-semibold text-(--text) flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              Project Working Directory
            </span>
            {currentDir && (
              <button
                type="button"
                onClick={handleClear}
                className="text-[11px] text-rose-400 hover:text-rose-300 transition-colors"
                title="Unset working directory"
              >
                Clear
              </button>
            )}
          </div>

          {currentDir && (
            <div className="p-2 rounded-lg bg-(--surface2) border border-(--border) mb-3 text-[11px] text-(--text2) font-mono break-all select-all flex items-center justify-between gap-2">
              <span className="truncate">{currentDir}</span>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(currentDir)}
                className="p-1 hover:text-(--text) rounded hover:bg-(--surface) transition-colors shrink-0"
                title="Copy Path"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            </div>
          )}

          <div className="flex gap-2 mb-3">
            <button
              type="button"
              onClick={handleBrowse}
              className="flex-1 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              Browse Folder...
            </button>
          </div>

          <div className="flex gap-1.5 mb-3">
            <input
              type="text"
              placeholder="Or paste directory path..."
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleApplyCustom()}
              className="flex-1 px-2.5 py-1.5 rounded-lg bg-(--surface2) border border-(--border) text-xs text-(--text) focus:outline-none focus:border-indigo-500 font-mono"
            />
            <button
              type="button"
              onClick={handleApplyCustom}
              disabled={!customInput.trim()}
              className="px-2.5 py-1.5 rounded-lg bg-(--surface2) hover:bg-(--border) text-xs text-(--text) disabled:opacity-40 transition-colors"
            >
              Set
            </button>
          </div>

          {recentDirs.length > 0 && (
            <div>
              <div className="text-[11px] font-medium text-(--text2) mb-1.5 px-0.5">Recent Directories</div>
              <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                {recentDirs.map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    onClick={() => {
                      onChangeDir(dir)
                      saveRecentDir(dir)
                      setIsOpen(false)
                    }}
                    className={`w-full text-left px-2 py-1.5 rounded-lg text-xs font-mono truncate transition-colors flex items-center justify-between group ${
                      currentDir === dir
                        ? 'bg-indigo-500/15 text-indigo-300 font-medium'
                        : 'text-(--text2) hover:text-(--text) hover:bg-(--surface2)'
                    }`}
                    title={dir}
                  >
                    <span className="truncate">{dir}</span>
                    {currentDir === dir && (
                      <span className="text-[10px] text-indigo-400 shrink-0 ml-1">Active</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
