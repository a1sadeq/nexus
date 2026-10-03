import React, { useState, useEffect } from 'react'
import { IconFolder, IconPlus, IconTrash, IconSliders, IconDownload } from './BrandIcons'

const GLOBAL_PROJECT_DIR_KEY = 'nexus.global_project_dir'
const RECENT_DIRS_KEY = 'nexus_recent_project_dirs'
const MAX_SCAN_FILES_KEY = 'nexus.max_scan_files'

export const WorkspaceSettingsSection: React.FC = () => {
  const [globalDir, setGlobalDir] = useState<string>(() => {
    return localStorage.getItem(GLOBAL_PROJECT_DIR_KEY) || ''
  })
  const [recentDirs, setRecentDirs] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(RECENT_DIRS_KEY)
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })
  const [maxScanFiles, setMaxScanFiles] = useState<number>(() => {
    const raw = localStorage.getItem(MAX_SCAN_FILES_KEY)
    return raw ? Number(raw) : 50
  })
  const [customDirInput, setCustomDirInput] = useState('')
  const [defaultDownloadDir, setDefaultDownloadDir] = useState<string>('~/Downloads/nexus')

  useEffect(() => {
    window.electron?.downloads?.getDefaultDownloadDir().then((dir) => {
      if (dir) setDefaultDownloadDir(dir)
    })
  }, [])

  const handleBrowseGlobal = async () => {
    try {
      const selected = await window.electron?.skills?.chooseProjectDir()
      if (selected) {
        setGlobalDir(selected)
        localStorage.setItem(GLOBAL_PROJECT_DIR_KEY, selected)
        saveRecent(selected)
      }
    } catch (err) {
      console.error('Failed to browse folder:', err)
    }
  }

  const handleClearGlobal = () => {
    setGlobalDir('')
    localStorage.removeItem(GLOBAL_PROJECT_DIR_KEY)
  }

  const saveRecent = (dir: string) => {
    const normalized = dir.trim()
    if (!normalized) return
    const updated = [normalized, ...recentDirs.filter((d) => d !== normalized)].slice(0, 10)
    setRecentDirs(updated)
    localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(updated))
  }

  const handleAddCustomRecent = () => {
    const trimmed = customDirInput.trim()
    if (!trimmed) return
    saveRecent(trimmed)
    setCustomDirInput('')
  }

  const handleRemoveRecent = (dir: string) => {
    const updated = recentDirs.filter((d) => d !== dir)
    setRecentDirs(updated)
    localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(updated))
  }

  const handleClearAllRecent = () => {
    setRecentDirs([])
    localStorage.removeItem(RECENT_DIRS_KEY)
  }

  const handleSetAsGlobal = (dir: string) => {
    setGlobalDir(dir)
    localStorage.setItem(GLOBAL_PROJECT_DIR_KEY, dir)
  }

  const handleMaxFilesChange = (val: number) => {
    setMaxScanFiles(val)
    localStorage.setItem(MAX_SCAN_FILES_KEY, String(val))
  }

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto h-full text-sm p-4 overflow-y-auto custom-scrollbar" style={{ color: 'var(--text)' }}>
      {/* Header Banner */}
      <div
        className="sleek-card p-5 rounded-2xl border flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm"
        style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
            <IconFolder size={22} />
          </div>
          <div>
            <h2 className="text-base font-bold">Workspace & Project Directory</h2>
            <p className="text-xs opacity-70 mt-0.5" style={{ color: 'var(--text2)' }}>
              Configure root folder resolution, recent projects, and codebase file scanning limits.
            </p>
          </div>
        </div>
      </div>

      {/* Global Fallback Directory Card */}
      <div
        className="sleek-card p-5 rounded-2xl border flex flex-col gap-4 shadow-sm"
        style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
            <IconFolder size={20} />
          </div>
          <div>
            <h3 className="font-bold text-sm text-(--text)">Global Fallback Project Directory</h3>
            <p className="text-xs text-(--text2) mt-0.5">
              When a tab doesn't have a specific project directory selected, skills and file templates resolve relative to this path.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
          <div className="relative flex-1">
            <input
              type="text"
              readOnly
              placeholder="No global directory set (falls back to process working directory)"
              value={globalDir}
              className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-(--surface2) border border-(--border) text-(--text) font-mono focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleBrowseGlobal}
              className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <IconFolder size={14} />
              <span>Browse Folder…</span>
            </button>
            {globalDir && (
              <button
                type="button"
                onClick={handleClearGlobal}
                className="px-3 py-2.5 rounded-xl border border-(--border) text-xs font-semibold text-(--text2) hover:text-red-400 hover:bg-white/5 cursor-pointer transition-all"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Intelligent Downloads Routing Card */}
      <div
        className="sleek-card p-5 rounded-2xl border flex flex-col gap-4 shadow-sm"
        style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center shrink-0">
              <IconDownload size={20} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-(--text)">Intelligent Downloads Routing</h3>
              <p className="text-xs text-(--text2) mt-0.5">
                Automatically routes AI downloads and exports to the active project workspace root, or defaults to <span className="font-mono text-cyan-300">Downloads/nexus</span>.
              </p>
            </div>
          </div>
          <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 uppercase tracking-wider">
            Auto Routing Active
          </span>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
          <div className="relative flex-1">
            <input
              type="text"
              readOnly
              value={defaultDownloadDir}
              className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-(--surface2) border border-(--border) text-(--text) font-mono focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                window.electron?.downloads?.openPath(defaultDownloadDir)
              }}
              className="px-4 py-2.5 rounded-xl bg-(--surface2) border border-(--border) hover:bg-white/5 text-(--text) text-xs font-semibold shadow-sm flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <IconFolder size={14} />
              <span>Open Downloads Folder</span>
            </button>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-(--surface2) border border-(--border) flex flex-col gap-1.5 text-xs text-(--text2)">
          <div className="flex items-center gap-2 text-(--text) font-semibold">
            <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.6)]" />
            <span>Smart Routing Hierarchy:</span>
          </div>
          <p className="leading-relaxed">
            1. <strong>Active Tab Project:</strong> When a tab has a project directory selected, all webview downloads save directly into that project's folder.
          </p>
          <p className="leading-relaxed">
            2. <strong>Global Fallback Project:</strong> If no tab project is set, downloads route to the Global Fallback directory above (if configured).
          </p>
          <p className="leading-relaxed">
            3. <strong>Default Folder:</strong> Otherwise, files are organized neatly inside <span className="font-mono text-white/90">~/Downloads/nexus</span> (created automatically).
          </p>
        </div>
      </div>

      {/* Recent Workspaces Card */}
      <div
        className="sleek-card p-5 rounded-2xl border flex flex-col gap-4 shadow-sm"
        style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
              <IconFolder size={20} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-(--text)">Recent Project Folders</h3>
              <p className="text-xs text-(--text2) mt-0.5">
                Quick access list of workspaces used across your chats and skills.
              </p>
            </div>
          </div>

          {recentDirs.length > 0 && (
            <button
              type="button"
              onClick={handleClearAllRecent}
              className="text-xs text-(--text2) hover:text-red-400 cursor-pointer font-medium"
            >
              Clear All
            </button>
          )}
        </div>

        {/* Add manual folder path */}
        <div className="flex gap-2 pt-1">
          <input
            type="text"
            placeholder="Paste or enter folder path manually (e.g. /home/user/my-project)..."
            value={customDirInput}
            onChange={(e) => setCustomDirInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddCustomRecent()}
            className="flex-1 px-3.5 py-2 rounded-xl text-xs bg-(--surface2) border border-(--border) text-(--text) font-mono focus:outline-none focus:border-indigo-500"
          />
          <button
            type="button"
            onClick={handleAddCustomRecent}
            className="px-3.5 py-2 rounded-xl bg-(--surface2) border border-(--border) hover:bg-white/5 text-xs font-semibold text-(--text) flex items-center gap-1 cursor-pointer"
          >
            <IconPlus size={13} />
            <span>Add</span>
          </button>
        </div>

        {/* Recent List */}
        <div className="flex flex-col gap-2 pt-1">
          {recentDirs.length === 0 ? (
            <div className="p-4 rounded-xl bg-(--surface2) border border-(--border) text-center text-xs text-(--text2)">
              No recent project folders recorded yet.
            </div>
          ) : (
            recentDirs.map((dir) => {
              const isGlobal = globalDir === dir
              const basename = dir.split(/[/\\]/).filter(Boolean).pop() || dir
              return (
                <div
                  key={dir}
                  className="p-3 rounded-xl border flex items-center justify-between gap-3 group transition-all"
                  style={{ background: 'var(--surface2)', borderColor: 'var(--border)' }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <IconFolder size={16} className="text-indigo-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-semibold text-xs text-(--text) flex items-center gap-2">
                        <span>{basename}</span>
                        {isGlobal && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 font-normal">
                            Default
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-(--text2) font-mono truncate">{dir}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {!isGlobal && (
                      <button
                        type="button"
                        onClick={() => handleSetAsGlobal(dir)}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium border border-(--border) text-(--text2) hover:text-(--text) hover:bg-white/5 cursor-pointer"
                        title="Set as Default Global Folder"
                      >
                        Set Default
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveRecent(dir)}
                      className="p-1 rounded text-(--text2) hover:text-red-400 hover:bg-white/5 cursor-pointer transition-colors"
                      title="Remove from recents"
                    >
                      <IconTrash size={13} />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Codebase File Scanner Settings */}
      <div
        className="sleek-card p-5 rounded-2xl border flex flex-col gap-4 shadow-sm"
        style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <IconSliders size={20} />
          </div>
          <div>
            <h3 className="font-bold text-sm text-(--text)">Codebase File Scanner</h3>
            <p className="text-xs text-(--text2) mt-0.5">
              Parameters and file auto-complete scan boundaries for the active project.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 pt-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-(--text2)">Maximum files to index per project scan:</span>
            <span className="font-mono font-bold text-indigo-400">{maxScanFiles} files</span>
          </div>
          <input
            type="range"
            min={10}
            max={200}
            step={10}
            value={maxScanFiles}
            onChange={(e) => handleMaxFilesChange(Number(e.target.value))}
            className="vc-range accent-indigo-500 cursor-pointer"
          />

          <div className="p-3 rounded-xl bg-(--surface2) border border-(--border) flex flex-col gap-1 text-[11px] text-(--text2)">
            <span className="font-semibold text-(--text)">Standard Ignored Directories:</span>
            <span className="font-mono opacity-80">.git, node_modules, dist, build, .next, .cache, target, .gemini</span>
          </div>
        </div>
      </div>
    </div>
  )
}
