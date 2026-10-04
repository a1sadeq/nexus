import React, { useState, useMemo, useEffect, useCallback } from 'react'
import type { FolderScanResult, ScannedFileInfo } from '../../../shared/folderUpload'
import {
  groupFilesByDirectory,
  selectMatchingFiles,
  deselectMatchingFiles,
  getDirectorySelectionState,
  toggleDirectorySelection
} from '../lib/folderUploadHelpers'

export interface FolderUploadModalProps {
  isOpen: boolean
  data: FolderScanResult | null
  onClose: () => void
  onConfirm: (selectedPaths: string[]) => void
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export const FolderUploadModal: React.FC<FolderUploadModalProps> = ({
  isOpen,
  data,
  onClose,
  onConfirm
}) => {
  if (!isOpen || !data) return null

  const allFiles = data.files
  const suggestedCount = useMemo(
    () => allFiles.filter((f) => f.isSuggestedRemoval).length,
    [allFiles]
  )

  // Initialize selection: select all files EXCEPT suggested removals by default
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    for (const f of allFiles) {
      if (!f.isSuggestedRemoval) {
        initial.add(f.path)
      }
    }
    // If all files were flagged or none existed, select all
    if (initial.size === 0 && allFiles.length > 0) {
      for (const f of allFiles) initial.add(f.path)
    }
    return initial
  })

  const [search, setSearch] = useState('')
  const [excludeSuggested, setExcludeSuggested] = useState(suggestedCount > 0)

  // Directory folding state: set of collapsed dirKeys
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set())

  // Preview & Download state
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewContent, setPreviewContent] = useState<string>('')
  const [previewMeta, setPreviewMeta] = useState<{ fileCount: number; byteSize: number } | null>(null)
  const [copySuccess, setCopySuccess] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // Sync state if data changes
  useEffect(() => {
    const initial = new Set<string>()
    for (const f of allFiles) {
      if (!f.isSuggestedRemoval) {
        initial.add(f.path)
      }
    }
    if (initial.size === 0 && allFiles.length > 0) {
      for (const f of allFiles) initial.add(f.path)
    }
    setSelectedPaths(initial)
    setExcludeSuggested(suggestedCount > 0)
    setSearch('')
    setCollapsedDirs(new Set())
    setIsPreviewOpen(false)
    setSaveStatus(null)
  }, [data])

  // Handle escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (isPreviewOpen) {
          setIsPreviewOpen(false)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose, isPreviewOpen])

  // Aggregate files by extension
  const extensionStats = useMemo(() => {
    const map = new Map<
      string,
      { ext: string; count: number; bytes: number; paths: string[] }
    >()
    for (const f of allFiles) {
      const ext = f.extension.toLowerCase() || 'no-ext'
      const existing = map.get(ext) || { ext, count: 0, bytes: 0, paths: [] }
      existing.count++
      existing.bytes += f.size
      existing.paths.push(f.path)
      map.set(ext, existing)
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count)
  }, [allFiles])

  // Toggle all files of a specific extension
  const toggleExtension = useCallback(
    (extPaths: string[]) => {
      setSelectedPaths((prev) => {
        const next = new Set(prev)
        const allSelected = extPaths.every((p) => next.has(p))
        if (allSelected) {
          for (const p of extPaths) next.delete(p)
        } else {
          for (const p of extPaths) next.add(p)
        }
        return next
      })
    },
    []
  )

  // Toggle suggested removal exclusion
  const handleToggleExcludeSuggested = useCallback(() => {
    const nextVal = !excludeSuggested
    setExcludeSuggested(nextVal)
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      for (const f of allFiles) {
        if (f.isSuggestedRemoval) {
          if (nextVal) {
            next.delete(f.path)
          } else {
            next.add(f.path)
          }
        }
      }
      return next
    })
  }, [excludeSuggested, allFiles])

  // Toggle single file
  const toggleFile = useCallback((path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  // Filtered files for search
  const filteredFiles = useMemo(() => {
    if (!search.trim()) return allFiles
    const q = search.toLowerCase()
    return allFiles.filter(
      (f) =>
        f.relativePath.toLowerCase().includes(q) ||
        f.extension.toLowerCase().includes(q) ||
        f.removalReason?.toLowerCase().includes(q)
    )
  }, [allFiles, search])

  const isSearching = search.trim().length > 0

  // Global Select / Deselect all
  const selectAll = useCallback(() => {
    const next = new Set<string>()
    for (const f of allFiles) next.add(f.path)
    setSelectedPaths(next)
    setExcludeSuggested(false)
  }, [allFiles])

  const deselectAll = useCallback(() => {
    setSelectedPaths(new Set())
  }, [])

  // Contextual search select/deselect (affects only matching search results)
  const selectMatching = useCallback(() => {
    setSelectedPaths((prev) => selectMatchingFiles(prev, filteredFiles))
  }, [filteredFiles])

  const deselectMatching = useCallback(() => {
    setSelectedPaths((prev) => deselectMatchingFiles(prev, filteredFiles))
  }, [filteredFiles])

  // Group filtered files by relative directory
  const directoryGroups = useMemo(() => {
    return groupFilesByDirectory(filteredFiles)
  }, [filteredFiles])

  // Directory folding
  const toggleCollapseDir = useCallback((dirKey: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(dirKey)) next.delete(dirKey)
      else next.add(dirKey)
      return next
    })
  }, [])

  // Folder level selection toggle
  const toggleDirectory = useCallback((dirFiles: ScannedFileInfo[]) => {
    setSelectedPaths((prev) => toggleDirectorySelection(prev, dirFiles))
  }, [])

  // Selected stats
  const selectedStats = useMemo(() => {
    let count = 0
    let bytes = 0
    for (const f of allFiles) {
      if (selectedPaths.has(f.path)) {
        count++
        bytes += f.size
      }
    }
    return { count, bytes }
  }, [allFiles, selectedPaths])

  const handleConfirm = (): void => {
    if (selectedStats.count === 0) return
    onConfirm(Array.from(selectedPaths))
  }

  // Preview generated bundle
  const handleOpenPreview = async (): Promise<void> => {
    if (selectedStats.count === 0) return
    setIsPreviewOpen(true)
    setPreviewLoading(true)
    setCopySuccess(false)
    try {
      // @ts-ignore
      const result = await window.electron?.ipcRenderer?.invoke('preview_folder_bundle', {
        folderPath: data.folderPath,
        selectedPaths: Array.from(selectedPaths)
      })
      if (result && typeof result.text === 'string') {
        setPreviewContent(result.text)
        setPreviewMeta({ fileCount: result.fileCount, byteSize: result.byteSize })
      } else {
        // Fallback for non-IPC environment
        const selectedList = allFiles.filter((f) => selectedPaths.has(f.path))
        const fallbackText = selectedList
          .map(
            (f) =>
              `================================================================\nFile: ${f.relativePath}\n================================================================\n[Content of ${f.relativePath}]`
          )
          .join('\n\n')
        setPreviewContent(fallbackText)
        setPreviewMeta({ fileCount: selectedList.length, byteSize: selectedStats.bytes })
      }
    } catch (err) {
      console.error('Failed to load bundle preview:', err)
      setPreviewContent('Failed to load preview.')
    } finally {
      setPreviewLoading(false)
    }
  }

  // Copy bundle text to clipboard
  const handleCopyPreview = async (): Promise<void> => {
    if (!previewContent) return
    try {
      await navigator.clipboard.writeText(previewContent)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    } catch (e) {
      console.error('Failed to copy to clipboard:', e)
    }
  }

  // Download / Save bundle directly to disk
  const handleDownloadBundle = async (): Promise<void> => {
    if (selectedStats.count === 0 || isSaving) return
    setIsSaving(true)
    setSaveStatus(null)
    try {
      // @ts-ignore
      const res = await window.electron?.ipcRenderer?.invoke('save_folder_bundle_to_disk', {
        folderPath: data.folderPath,
        selectedPaths: Array.from(selectedPaths)
      })
      if (res?.success && res?.savedPath) {
        setSaveStatus(`Saved to ${res.savedPath}`)
        setTimeout(() => setSaveStatus(null), 4000)
      } else if (res?.canceled) {
        // User cancelled dialog
      } else {
        // Browser download fallback
        const element = document.createElement('a')
        const fileBlob = new Blob([previewContent || `Codebase bundle for ${data.folderName}`], {
          type: 'text/plain'
        })
        element.href = URL.createObjectURL(fileBlob)
        element.download = `${data.folderName}_codebase_bundle.txt`
        document.body.appendChild(element)
        element.click()
        document.body.removeChild(element)
        setSaveStatus(`Downloaded ${data.folderName}_codebase_bundle.txt`)
        setTimeout(() => setSaveStatus(null), 4000)
      }
    } catch (err) {
      console.error('Failed to download bundle:', err)
      setSaveStatus('Failed to save file.')
      setTimeout(() => setSaveStatus(null), 4000)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 sm:p-6 animate-in fade-in duration-200">
      <div
        className="w-full max-w-4xl max-h-[90vh] bg-[#11131a] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-gray-200 relative"
        style={{
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 40px rgba(99, 102, 241, 0.1)'
        }}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-inner">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-white tracking-tight">
                  Upload Codebase Folder
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-indigo-500/15 border border-indigo-500/30 text-indigo-300">
                  {data.folderName}
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                Total scanned:{' '}
                <span className="text-gray-200 font-medium">
                  {data.totalFiles} files ({formatBytes(data.totalBytes)})
                </span>
                {' · '}Select files and folders to bundle
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Toolbar & Contextual Filter Controls */}
        <div className="px-6 py-3 border-b border-white/5 bg-black/20 flex flex-wrap items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[240px]">
            <input
              type="text"
              placeholder="Search files by path or name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-8 py-1.5 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white text-xs cursor-pointer"
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          {/* Contextual Select Actions */}
          <div className="flex items-center gap-2">
            {isSearching ? (
              <>
                <button
                  type="button"
                  disabled={filteredFiles.length === 0}
                  onClick={selectMatching}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-cyan-300 hover:text-white bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5"
                  title={`Select only the ${filteredFiles.length} files matching your search`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Select Matching ({filteredFiles.length})</span>
                </button>
                <button
                  type="button"
                  disabled={filteredFiles.length === 0}
                  onClick={deselectMatching}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5"
                  title={`Deselect only the ${filteredFiles.length} files matching your search`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                  <span>Deselect Matching ({filteredFiles.length})</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={selectAll}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 transition-colors cursor-pointer"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={deselectAll}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 transition-colors cursor-pointer"
                >
                  Deselect All
                </button>
              </>
            )}
          </div>
        </div>

        {/* Suggested Removals Section */}
        {suggestedCount > 0 && (
          <div className="px-6 py-2.5 border-b border-amber-500/20 bg-amber-500/[0.04] flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </span>
              <span className="text-amber-200 font-medium">
                {suggestedCount} noisy / sensitive file{suggestedCount > 1 ? 's' : ''} detected
              </span>
              <span className="text-amber-300/70 hidden sm:inline">
                (lockfiles, env secrets, large bundles)
              </span>
            </div>

            <button
              type="button"
              onClick={handleToggleExcludeSuggested}
              className={`px-3 py-1 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-all cursor-pointer ${
                excludeSuggested
                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-200 shadow-sm'
                  : 'bg-white/[0.03] border-white/10 text-gray-400 hover:text-gray-200'
              }`}
            >
              <input
                type="checkbox"
                checked={excludeSuggested}
                onChange={handleToggleExcludeSuggested}
                className="cursor-pointer rounded accent-amber-500"
              />
              Exclude suggested files
            </button>
          </div>
        )}

        {/* Scanned File Types Section */}
        <div className="px-6 py-3 border-b border-white/5 bg-white/[0.01]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              Scanned File Types ({extensionStats.length})
            </span>
            <span className="text-[11px] text-gray-500">Click type to toggle all</span>
          </div>

          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
            {extensionStats.map((item) => {
              const selectedInGroup = item.paths.filter((p) => selectedPaths.has(p)).length
              const allSelected = selectedInGroup === item.count
              const someSelected = selectedInGroup > 0 && !allSelected

              return (
                <button
                  key={item.ext}
                  type="button"
                  onClick={() => toggleExtension(item.paths)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono border flex items-center gap-1.5 transition-all cursor-pointer ${
                    allSelected
                      ? 'bg-indigo-500/15 border-indigo-500/35 text-indigo-300'
                      : someSelected
                        ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400/80'
                        : 'bg-white/[0.02] border-white/5 text-gray-500 hover:border-white/15 hover:text-gray-400'
                  }`}
                  title={`${selectedInGroup} of ${item.count} selected (${formatBytes(item.bytes)})`}
                >
                  <span
                    className={`w-2 h-2 rounded-sm border flex items-center justify-center ${
                      allSelected
                        ? 'bg-indigo-500 border-indigo-400'
                        : someSelected
                          ? 'bg-indigo-500/50 border-indigo-400'
                          : 'border-gray-600'
                    }`}
                  />
                  <span>{item.ext}</span>
                  <span className="text-[10px] text-gray-400 font-sans">
                    {selectedInGroup}/{item.count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Directory Grouped Files List */}
        <div className="flex-1 overflow-y-auto max-h-[44vh] divide-y divide-white/[0.04]">
          {filteredFiles.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">
              No files match your search query &quot;{search}&quot;
            </div>
          ) : (
            directoryGroups.map((group) => {
              const selectionState = getDirectorySelectionState(selectedPaths, group.files)
              const allDirSelected = selectionState === 'all'
              const someDirSelected = selectionState === 'some'
              const selectedInDir = group.files.filter((f) => selectedPaths.has(f.path)).length
              const isCollapsed = collapsedDirs.has(group.dirKey)

              return (
                <div key={group.dirKey || '__root__'} className="bg-white/[0.005]">
                  {/* Folder Group Header */}
                  <div className="px-6 py-2 bg-white/[0.02] hover:bg-white/[0.04] border-y border-white/[0.05] flex items-center justify-between gap-3 select-none transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      {/* Tri-state Folder Checkbox */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleDirectory(group.files)
                        }}
                        aria-label={`Toggle selection for folder ${group.displayPath}`}
                        className={`w-4 h-4 rounded border flex items-center justify-center transition-all cursor-pointer ${
                          allDirSelected
                            ? 'bg-indigo-600 border-indigo-400 text-white shadow-sm shadow-indigo-500/50'
                            : someDirSelected
                              ? 'bg-indigo-600/40 border-indigo-400/80 text-white'
                              : 'bg-white/[0.03] border-white/20 hover:border-white/40'
                        }`}
                        title={
                          allDirSelected
                            ? `Deselect all ${group.files.length} files in ${group.displayPath}`
                            : `Select all ${group.files.length} files in ${group.displayPath}`
                        }
                      >
                        {allDirSelected && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                        {someDirSelected && (
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4">
                            <line x1="5" y1="12" x2="19" y2="12" />
                          </svg>
                        )}
                      </button>

                      {/* Folder Name & Collapse toggle button */}
                      <button
                        type="button"
                        onClick={() => toggleCollapseDir(group.dirKey)}
                        className="flex items-center gap-2 min-w-0 text-left hover:text-white transition-colors cursor-pointer group/hdr"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={`text-gray-400 group-hover/hdr:text-white transition-transform duration-150 ${
                            isCollapsed ? '-rotate-90' : 'rotate-0'
                          }`}
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>

                        <span className="text-cyan-400 text-xs">📁</span>

                        <span className="font-mono text-xs font-semibold text-cyan-200/90 truncate group-hover/hdr:text-cyan-100">
                          {group.displayPath}
                        </span>
                      </button>
                    </div>

                    {/* Folder Metrics Badge */}
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-white/[0.03] border border-white/5 text-gray-400">
                        {selectedInDir}/{group.files.length} selected ({formatBytes(group.totalBytes)})
                      </span>
                    </div>
                  </div>

                  {/* Folder Child Files */}
                  {!isCollapsed && (
                    <div className="divide-y divide-white/[0.02]">
                      {group.files.map((f) => {
                        const isSelected = selectedPaths.has(f.path)
                        const fileName = f.relativePath.includes('/')
                          ? f.relativePath.substring(f.relativePath.lastIndexOf('/') + 1)
                          : f.relativePath

                        return (
                          <div
                            key={f.path}
                            onClick={() => toggleFile(f.path)}
                            className={`px-6 py-1.5 pl-11 flex items-center justify-between gap-4 cursor-pointer transition-colors text-xs select-none ${
                              isSelected
                                ? 'bg-indigo-500/[0.04] hover:bg-indigo-500/[0.08]'
                                : 'opacity-40 hover:opacity-75 hover:bg-white/[0.01]'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleFile(f.path)}
                                className="cursor-pointer rounded accent-indigo-500"
                              />

                              {/* File Path */}
                              <div className="truncate font-mono">
                                <span className={isSelected ? 'text-gray-200 font-medium' : 'text-gray-400'}>
                                  {fileName}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 shrink-0">
                              {/* Suggested Removal Warning Badge */}
                              {f.isSuggestedRemoval && (
                                <span
                                  className="px-2 py-0.5 rounded text-[10px] font-sans font-medium bg-amber-500/15 border border-amber-500/30 text-amber-300"
                                  title={f.removalReason}
                                >
                                  {f.removalReason || 'Suggested removal'}
                                </span>
                              )}

                              {/* File extension badge */}
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-white/[0.04] text-gray-400 border border-white/5">
                                {f.extension}
                              </span>

                              {/* File size */}
                              <span className="text-gray-400 font-mono text-[11px] w-16 text-right">
                                {formatBytes(f.size)}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 bg-white/[0.02] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-xs text-gray-400">Selected:</span>
            <span className="text-sm font-semibold text-white">
              {selectedStats.count} of {data.totalFiles} files
            </span>
            <span className="text-xs text-gray-400">
              ({formatBytes(selectedStats.bytes)})
            </span>
            {saveStatus && (
              <span className="ml-2 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 animate-in fade-in">
                ✓ {saveStatus}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {/* Preview Bundle Button */}
            <button
              type="button"
              disabled={selectedStats.count === 0}
              onClick={handleOpenPreview}
              className="px-3.5 py-2 rounded-xl text-xs font-medium text-cyan-300 hover:text-white bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
              title="Preview the exact formatted text bundle before uploading"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span>Preview</span>
            </button>

            {/* Download / Export to Disk Button */}
            <button
              type="button"
              disabled={selectedStats.count === 0 || isSaving}
              onClick={handleDownloadBundle}
              className="px-3.5 py-2 rounded-xl text-xs font-medium text-amber-300 hover:text-white bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
              title="Save the complete codebase bundle as a text file to your computer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>{isSaving ? 'Saving...' : 'Download'}</span>
            </button>

            {/* Cancel Button */}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-gray-300 hover:text-white hover:bg-white/10 border border-white/10 transition-colors cursor-pointer"
            >
              Cancel
            </button>

            {/* Primary Confirm Upload Button */}
            <button
              type="button"
              disabled={selectedStats.count === 0}
              onClick={handleConfirm}
              className={`px-5 py-2 rounded-xl text-xs font-medium text-white shadow-lg transition-all flex items-center gap-2 cursor-pointer ${
                selectedStats.count === 0
                  ? 'bg-gray-700/50 text-gray-400 border border-gray-600/30 cursor-not-allowed'
                  : 'bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 shadow-indigo-500/25 border border-indigo-400/30'
              }`}
            >
              <span>Upload {selectedStats.count} Files</span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>
        </div>

        {/* Bundle Inspection & Preview Overlay Modal */}
        {isPreviewOpen && (
          <div className="absolute inset-0 z-50 bg-[#090b10]/95 backdrop-blur-xl flex flex-col animate-in fade-in duration-150">
            {/* Preview Header */}
            <div className="px-6 py-4 border-b border-cyan-500/20 bg-cyan-950/20 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-300">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <span>Generated Codebase Bundle Preview</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-500/15 border border-cyan-500/30 text-cyan-300">
                      {previewMeta?.fileCount || selectedStats.count} files
                    </span>
                  </h3>
                  <p className="text-xs text-gray-400 font-mono mt-0.5">
                    {formatBytes(previewMeta?.byteSize || selectedStats.bytes)} · ~
                    {Math.ceil((previewMeta?.byteSize || selectedStats.bytes) / 4).toLocaleString()} estimated tokens
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Copy to Clipboard */}
                <button
                  type="button"
                  onClick={handleCopyPreview}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-all cursor-pointer ${
                    copySuccess
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                      : 'bg-white/[0.04] border-white/10 text-gray-200 hover:bg-white/[0.08] hover:text-white'
                  }`}
                >
                  {copySuccess ? (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>Copied to Clipboard!</span>
                    </>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                      </svg>
                      <span>Copy Bundle</span>
                    </>
                  )}
                </button>

                {/* Download Button */}
                <button
                  type="button"
                  onClick={handleDownloadBundle}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/15 border border-amber-500/30 text-amber-200 hover:bg-amber-500/25 transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span>Download</span>
                </button>

                {/* Close Preview */}
                <button
                  type="button"
                  onClick={() => setIsPreviewOpen(false)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  title="Close preview (Esc)"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Preview Code View */}
            <div className="flex-1 p-6 overflow-y-auto font-mono text-xs text-gray-300 bg-black/40">
              {previewLoading ? (
                <div className="h-full flex items-center justify-center text-cyan-400 gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span>Generating pre-flight bundle text...</span>
                </div>
              ) : (
                <pre className="whitespace-pre-wrap break-all leading-relaxed select-text font-mono text-[11px] text-gray-300">
                  {previewContent}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
