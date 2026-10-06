import React, { useState, useMemo, useEffect, useCallback } from 'react'
import type {
  FolderScanResult,
  BundleChunk,
  PartitionResult,
  UploadChunkProgress
} from '../../../shared/folderUpload'
import {
  selectMatchingFiles,
  deselectMatchingFiles,
  buildFolderTree,
  FolderTreeNode,
  getNodeSelectionState,
  toggleFolderNode,
  getDefaultCollapsedDirs,
  getExpandedDirsForSearch,
  getAllDirectoryPaths
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

/**
 * Recursive Tree Node renderer representing a directory and its nested contents.
 */
interface TreeNodeRowProps {
  node: FolderTreeNode
  selectedPaths: Set<string>
  collapsedDirs: Set<string>
  onToggleNode: (node: FolderTreeNode) => void
  onToggleCollapse: (dirPath: string) => void
  onToggleFile: (path: string) => void
}

const TreeNodeRow: React.FC<TreeNodeRowProps> = ({
  node,
  selectedPaths,
  collapsedDirs,
  onToggleNode,
  onToggleCollapse,
  onToggleFile
}) => {
  const selectionState = getNodeSelectionState(node, selectedPaths)
  const isAll = selectionState === 'all'
  const isSome = selectionState === 'some'
  const isCollapsed = collapsedDirs.has(node.fullPath)

  const selectedInDir = useMemo(
    () => node.allDescendantPaths.filter((p) => selectedPaths.has(p)).length,
    [node.allDescendantPaths, selectedPaths]
  )

  const isDepth1 = node.depth === 1

  return (
    <div className="w-full select-none">
      {/* Directory Row Header */}
      <div className="px-3 py-1.5 hover:bg-white/[0.03] rounded-lg flex items-center justify-between gap-2.5 transition-colors group/hdr">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Tri-state Folder Checkbox */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggleNode(node)
            }}
            aria-label={`Toggle selection for folder ${node.name}`}
            className={`w-4 h-4 rounded border flex items-center justify-center transition-all cursor-pointer shrink-0 ${
              isAll
                ? 'bg-indigo-600 border-indigo-400 text-white shadow-sm shadow-indigo-500/50'
                : isSome
                  ? 'bg-indigo-600/35 border-indigo-400/80 text-white'
                  : 'bg-white/[0.03] border-white/20 hover:border-white/40'
            }`}
            title={
              isAll
                ? `Deselect all ${node.totalFiles} files in ${node.name}/`
                : `Select all ${node.totalFiles} files in ${node.name}/`
            }
          >
            {isAll && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {isSome && (
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4">
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            )}
          </button>

          {/* Folder Name & Collapse Chevron Toggle */}
          <button
            type="button"
            onClick={() => onToggleCollapse(node.fullPath)}
            className="flex items-center gap-1.5 min-w-0 text-left hover:text-white transition-colors cursor-pointer"
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
              className={`text-gray-400 group-hover/hdr:text-white transition-transform duration-150 shrink-0 ${
                isCollapsed ? '-rotate-90' : 'rotate-0'
              }`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>

            {/* Folder Icon with depth aesthetic */}
            <span className={`text-xs shrink-0 ${isDepth1 ? 'text-cyan-400' : 'text-indigo-400/90'}`}>
              📁
            </span>

            <span
              className={`font-mono text-xs truncate ${
                isDepth1
                  ? 'font-semibold text-cyan-200/95 group-hover/hdr:text-cyan-100'
                  : 'font-normal text-gray-200/90 group-hover/hdr:text-white'
              }`}
            >
              {node.name}/
            </span>
          </button>
        </div>

        {/* Directory Metrics Badge */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-white/[0.03] border border-white/5 text-gray-400">
            {selectedInDir}/{node.totalFiles} ({formatBytes(node.totalBytes)})
          </span>
        </div>
      </div>

      {/* Expanded Directory Contents */}
      {!isCollapsed && (
        <div className="border-l border-white/[0.08] ml-3.5 pl-2.5 space-y-0.5 mt-0.5">
          {/* Direct Files in this folder */}
          {node.files.map((f) => {
            const isSelected = selectedPaths.has(f.path)
            const fileName = f.relativePath.includes('/')
              ? f.relativePath.substring(f.relativePath.lastIndexOf('/') + 1)
              : f.relativePath

            return (
              <div
                key={f.path}
                onClick={() => onToggleFile(f.path)}
                className={`px-2.5 py-1 rounded-md flex items-center justify-between gap-3 cursor-pointer transition-colors text-xs select-none ${
                  isSelected
                    ? 'bg-indigo-500/[0.06] hover:bg-indigo-500/[0.12]'
                    : 'opacity-40 hover:opacity-75 hover:bg-white/[0.01]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleFile(f.path)}
                    className="cursor-pointer rounded accent-indigo-500 shrink-0"
                  />
                  <span className={`truncate font-mono ${isSelected ? 'text-gray-200 font-medium' : 'text-gray-400'}`}>
                    {fileName}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {f.isSuggestedRemoval && (
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] font-sans font-medium bg-amber-500/15 border border-amber-500/30 text-amber-300"
                      title={f.removalReason}
                    >
                      {f.removalReason || 'Suggested removal'}
                    </span>
                  )}
                  <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-white/[0.04] text-gray-400 border border-white/5">
                    {f.extension}
                  </span>
                  <span className="text-gray-400 font-mono text-[10px] w-14 text-right">
                    {formatBytes(f.size)}
                  </span>
                </div>
              </div>
            )
          })}

          {/* Child Subdirectories */}
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.fullPath}
              node={child}
              selectedPaths={selectedPaths}
              collapsedDirs={collapsedDirs}
              onToggleNode={onToggleNode}
              onToggleCollapse={onToggleCollapse}
              onToggleFile={onToggleFile}
            />
          ))}
        </div>
      )}
    </div>
  )
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
    if (initial.size === 0 && allFiles.length > 0) {
      for (const f of allFiles) initial.add(f.path)
    }
    return initial
  })

  const [search, setSearch] = useState('')
  const [excludeSuggested, setExcludeSuggested] = useState(suggestedCount > 0)

  // Build full tree and search tree
  const fullTree = useMemo(() => buildFolderTree(allFiles), [allFiles])
  const allDirPaths = useMemo(() => getAllDirectoryPaths(fullTree), [fullTree])

  // Collapsed directories state: depth > 2 collapsed by default
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(() =>
    getDefaultCollapsedDirs(fullTree, 2)
  )

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
  const searchTree = useMemo(() => buildFolderTree(filteredFiles), [filteredFiles])

  // Auto-expand search ancestors or restore default depth on clear
  useEffect(() => {
    if (isSearching) {
      const expandedForSearch = getExpandedDirsForSearch(fullTree, filteredFiles)
      setCollapsedDirs((prev) => {
        const next = new Set(prev)
        for (const dir of expandedForSearch) {
          next.delete(dir)
        }
        return next
      })
    } else {
      setCollapsedDirs(getDefaultCollapsedDirs(fullTree, 2))
    }
  }, [search, fullTree, filteredFiles, isSearching])

  // Preview & Download state
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewContent, setPreviewContent] = useState<string>('')
  const [previewMeta, setPreviewMeta] = useState<{ fileCount: number; byteSize: number } | null>(null)
  const [copySuccess, setCopySuccess] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // Chunk Partition Drawer state
  const [isChunksDrawerOpen, setIsChunksDrawerOpen] = useState(false)
  const [maxChunkMb, setMaxChunkMb] = useState<number>(8)
  const [enableCompression, setEnableCompression] = useState<boolean>(true)
  const [partitionResult, setPartitionResult] = useState<PartitionResult | null>(null)
  const [isPartitioning, setIsPartitioning] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadChunkProgress | null>(null)
  const [isUploadingSequentially, setIsUploadingSequentially] = useState(false)
  const [expandedChunkIndices, setExpandedChunkIndices] = useState<Set<number>>(new Set())

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
    setCollapsedDirs(getDefaultCollapsedDirs(fullTree, 2))
    setIsPreviewOpen(false)
    setIsChunksDrawerOpen(false)
    setSaveStatus(null)
  }, [data, allFiles, fullTree, suggestedCount])

  // Listen to chunk upload progress events
  useEffect(() => {
    // @ts-ignore
    const cleanup = window.electron?.ipcRenderer?.on(
      'folder_upload_chunk_progress',
      (_e: any, progress: UploadChunkProgress) => {
        setUploadProgress(progress)
        if (progress.status === 'completed' && progress.currentChunk === progress.totalChunks) {
          setIsUploadingSequentially(false)
        }
      }
    )
    return () => {
      cleanup?.()
    }
  }, [])

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (isPreviewOpen) {
          setIsPreviewOpen(false)
        } else if (isChunksDrawerOpen) {
          setIsChunksDrawerOpen(false)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose, isPreviewOpen, isChunksDrawerOpen])

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

  // Contextual search select/deselect
  const selectMatching = useCallback(() => {
    setSelectedPaths((prev) => selectMatchingFiles(prev, filteredFiles))
  }, [filteredFiles])

  const deselectMatching = useCallback(() => {
    setSelectedPaths((prev) => deselectMatchingFiles(prev, filteredFiles))
  }, [filteredFiles])

  // Tree directory folding
  const toggleCollapseDir = useCallback((dirPath: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(dirPath)) next.delete(dirPath)
      else next.add(dirPath)
      return next
    })
  }, [])

  // Global Expand All / Collapse All toggle
  const isAllExpanded = collapsedDirs.size === 0
  const handleToggleExpandAll = useCallback(() => {
    if (isAllExpanded) {
      setCollapsedDirs(new Set(allDirPaths))
    } else {
      setCollapsedDirs(new Set())
    }
  }, [isAllExpanded, allDirPaths])

  // Tree node toggle (cascades to all descendants)
  const handleToggleNode = useCallback((node: FolderTreeNode) => {
    setSelectedPaths((prev) => toggleFolderNode(node, prev))
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

  // Pre-calculate partition whenever drawer opens or settings change
  const fetchPartitions = useCallback(
    async (chunkMb: number, compression: boolean) => {
      if (selectedStats.count === 0) return
      setIsPartitioning(true)
      try {
        // @ts-ignore
        const result = await window.electron?.ipcRenderer?.invoke('partition_folder_bundle', {
          folderPath: data.folderPath,
          selectedPaths: Array.from(selectedPaths),
          maxChunkBytes: chunkMb * 1024 * 1024,
          enableCompression: compression
        })
        if (result) {
          setPartitionResult(result)
        }
      } catch (err) {
        console.error('Failed to partition folder bundle:', err)
      } finally {
        setIsPartitioning(false)
      }
    },
    [data.folderPath, selectedPaths, selectedStats.count]
  )

  const handleOpenChunksDrawer = (): void => {
    setIsChunksDrawerOpen(true)
    fetchPartitions(maxChunkMb, enableCompression)
  }

  const handleChangeMaxChunk = (mb: number): void => {
    setMaxChunkMb(mb)
    fetchPartitions(mb, enableCompression)
  }

  const handleToggleCompression = (): void => {
    const nextVal = !enableCompression
    setEnableCompression(nextVal)
    fetchPartitions(maxChunkMb, nextVal)
  }

  // Upload all chunks sequentially
  const handleUploadAllSequentially = async (): Promise<void> => {
    if (!partitionResult || partitionResult.chunks.length === 0 || isUploadingSequentially) return
    setIsUploadingSequentially(true)
    try {
      // @ts-ignore
      await window.electron?.ipcRenderer?.invoke('upload_chunks_sequentially', {
        folderName: data.folderName,
        chunks: partitionResult.chunks
      })
    } catch (err) {
      console.error('Sequential upload failed:', err)
    } finally {
      setIsUploadingSequentially(false)
    }
  }

  // Upload single chunk
  const handleUploadSingleChunk = async (chunk: BundleChunk): Promise<void> => {
    try {
      // @ts-ignore
      await window.electron?.ipcRenderer?.invoke('upload_single_chunk', {
        folderName: data.folderName,
        chunk
      })
      setSaveStatus(`Uploaded Part ${chunk.index}`)
      setTimeout(() => setSaveStatus(null), 3000)
    } catch (err) {
      console.error('Upload single chunk failed:', err)
    }
  }

  // Save single chunk to disk
  const handleSaveSingleChunk = async (chunk: BundleChunk): Promise<void> => {
    try {
      // @ts-ignore
      const res = await window.electron?.ipcRenderer?.invoke('save_single_chunk_to_disk', {
        folderName: data.folderName,
        chunk
      })
      if (res?.success && res?.savedPath) {
        setSaveStatus(`Part ${chunk.index} saved`)
        setTimeout(() => setSaveStatus(null), 3000)
      }
    } catch (err) {
      console.error('Save single chunk failed:', err)
    }
  }

  // Toggle chunk accordion view
  const toggleChunkExpand = (index: number): void => {
    setExpandedChunkIndices((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
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
      } else if (!res?.canceled) {
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
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 sm:p-6 animate-in fade-in duration-200">
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

                {/* Smart Pruned / Truncated indicator */}
                {data.prunedDirs && data.prunedDirs.length > 0 && (
                  <span
                    className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-amber-500/15 border border-amber-500/35 text-amber-300 flex items-center gap-1 cursor-help"
                    title={`Auto-pruned ${data.prunedDirs.length} heavy bloat directories:\n${data.prunedDirs.join('\n')}`}
                  >
                    <span>⚡ Smart Filtered ({data.prunedDirs.length} dirs)</span>
                  </span>
                )}
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

        {/* Toolbar & Filter Controls */}
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

          {/* Contextual Select & Global Expand/Collapse Actions */}
          <div className="flex items-center gap-2">
            {/* Global Expand All / Collapse All Toggle Button */}
            <button
              type="button"
              onClick={handleToggleExpandAll}
              className="px-2.5 py-1.5 rounded-lg text-xs font-mono font-medium text-indigo-300 hover:text-white bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/25 transition-colors cursor-pointer flex items-center gap-1.5"
              title={isAllExpanded ? 'Collapse all folders' : 'Expand all folders'}
            >
              <span>{isAllExpanded ? '⊟ Collapse All' : '⊞ Expand All'}</span>
            </button>

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

          <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto pr-1">
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

        {/* Hierarchical Directory Tree View */}
        <div className="flex-1 overflow-y-auto max-h-[46vh] p-4 space-y-1">
          {filteredFiles.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">
              No files match your search query &quot;{search}&quot;
            </div>
          ) : (
            <div className="space-y-1">
              {/* Root level files */}
              {searchTree.files.length > 0 && (
                <div className="border border-white/5 rounded-xl p-2.5 bg-white/[0.01] space-y-0.5 mb-2">
                  <div className="px-2 py-1 text-[11px] font-mono text-gray-400 flex items-center gap-2">
                    <span className="text-cyan-400">📂</span>
                    <span>Root (/)</span>
                    <span className="text-gray-500">({searchTree.files.length} files)</span>
                  </div>
                  {searchTree.files.map((f) => {
                    const isSelected = selectedPaths.has(f.path)
                    return (
                      <div
                        key={f.path}
                        onClick={() => toggleFile(f.path)}
                        className={`px-3 py-1.5 rounded-lg flex items-center justify-between gap-3 cursor-pointer transition-colors text-xs select-none ${
                          isSelected
                            ? 'bg-indigo-500/[0.06] hover:bg-indigo-500/[0.12]'
                            : 'opacity-40 hover:opacity-75 hover:bg-white/[0.01]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleFile(f.path)}
                            className="cursor-pointer rounded accent-indigo-500 shrink-0"
                          />
                          <span className={`truncate font-mono ${isSelected ? 'text-gray-200 font-medium' : 'text-gray-400'}`}>
                            {f.relativePath}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {f.isSuggestedRemoval && (
                            <span
                              className="px-1.5 py-0.5 rounded text-[10px] font-sans font-medium bg-amber-500/15 border border-amber-500/30 text-amber-300"
                              title={f.removalReason}
                            >
                              {f.removalReason || 'Suggested removal'}
                            </span>
                          )}
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-white/[0.04] text-gray-400 border border-white/5">
                            {f.extension}
                          </span>
                          <span className="text-gray-400 font-mono text-[10px] w-14 text-right">
                            {formatBytes(f.size)}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Subdirectories rendered recursively */}
              {searchTree.children.map((childNode) => (
                <TreeNodeRow
                  key={childNode.fullPath}
                  node={childNode}
                  selectedPaths={selectedPaths}
                  collapsedDirs={collapsedDirs}
                  onToggleNode={handleToggleNode}
                  onToggleCollapse={toggleCollapseDir}
                  onToggleFile={toggleFile}
                />
              ))}
            </div>
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
            {/* Chunks & Partitions Manager Trigger */}
            <button
              type="button"
              disabled={selectedStats.count === 0}
              onClick={handleOpenChunksDrawer}
              className="px-3.5 py-2 rounded-xl text-xs font-medium text-purple-300 hover:text-white bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
              title="Inspect, compress, and partition codebase chunks for AI file size limits"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              <span>Chunks & Parts</span>
            </button>

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

        {/* Chunks & Partition Manager Drawer Overlay */}
        {isChunksDrawerOpen && (
          <div className="absolute inset-0 z-50 bg-[#090b10]/95 backdrop-blur-xl flex flex-col animate-in fade-in duration-150">
            {/* Drawer Header */}
            <div className="px-6 py-4 border-b border-purple-500/20 bg-purple-950/20 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <span>Bundle Partition & Chunks Manager</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-purple-500/15 border border-purple-500/30 text-purple-300">
                      {partitionResult?.chunks.length || 0} part(s)
                    </span>
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Stream large codebases safely into file-limited AI chats (ChatGPT, Claude, Gemini, DeepSeek)
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsChunksDrawerOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title="Close drawer"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Drawer Configuration Bar */}
            <div className="px-6 py-3 border-b border-white/5 bg-white/[0.02] flex flex-wrap items-center justify-between gap-4">
              {/* Max Chunk Size Selector */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 font-medium">Max Chunk Size:</span>
                <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/10">
                  {[5, 8, 10].map((mb) => (
                    <button
                      key={mb}
                      type="button"
                      onClick={() => handleChangeMaxChunk(mb)}
                      className={`px-3 py-1 rounded-lg text-xs font-mono font-medium transition-all cursor-pointer ${
                        maxChunkMb === mb
                          ? 'bg-purple-600 text-white shadow-sm shadow-purple-500/40'
                          : 'text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      {mb} MB
                    </button>
                  ))}
                </div>
              </div>

              {/* Compression Toggle */}
              <button
                type="button"
                onClick={handleToggleCompression}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border flex items-center gap-2 transition-all cursor-pointer ${
                  enableCompression
                    ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200 shadow-sm'
                    : 'bg-white/[0.03] border-white/10 text-gray-400 hover:text-gray-200'
                }`}
                title="Strips trailing whitespace and collapses duplicate blank lines"
              >
                <input
                  type="checkbox"
                  checked={enableCompression}
                  onChange={handleToggleCompression}
                  className="cursor-pointer rounded accent-cyan-500"
                />
                <span>Smart Context Compression</span>
              </button>

              {/* Compression Telemetry Pill */}
              {partitionResult && (
                <div className="flex items-center gap-2 text-xs font-mono bg-white/[0.03] px-3 py-1 rounded-xl border border-white/5">
                  <span className="text-gray-400">Total:</span>
                  <span className="text-gray-200 font-semibold">{formatBytes(partitionResult.totalBytes)}</span>
                  {partitionResult.savedBytes > 0 && (
                    <span className="text-emerald-400 text-[11px]">
                      (-{partitionResult.reductionPercent}%)
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Chunk Cards List */}
            <div className="flex-1 p-6 overflow-y-auto space-y-3">
              {isPartitioning ? (
                <div className="py-20 text-center text-sm text-purple-300 flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span>Computing optimal chunks...</span>
                </div>
              ) : !partitionResult || partitionResult.chunks.length === 0 ? (
                <div className="py-20 text-center text-sm text-gray-500">
                  No selected files to partition.
                </div>
              ) : (
                partitionResult.chunks.map((chunk) => {
                  const maxBytes = maxChunkMb * 1024 * 1024
                  const pct = Math.min(100, Math.round((chunk.byteSize / maxBytes) * 100))
                  const isExpanded = expandedChunkIndices.has(chunk.index)

                  return (
                    <div
                      key={chunk.index}
                      className="rounded-xl border border-white/10 bg-white/[0.02] hover:border-purple-500/30 transition-all p-4 space-y-3"
                    >
                      {/* Part Header & Telemetry */}
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-purple-500/20 border border-purple-500/35 text-purple-200">
                            Part {chunk.index} of {chunk.totalChunks}
                          </span>
                          <span className="text-xs text-gray-300 font-mono">
                            {formatBytes(chunk.byteSize)} / {maxChunkMb} MB
                          </span>
                          <span className="text-xs text-gray-500">· {chunk.fileCount} files</span>
                        </div>

                        <div className="flex items-center gap-2">
                          {/* Upload Part button */}
                          <button
                            type="button"
                            onClick={() => handleUploadSingleChunk(chunk)}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium text-cyan-300 hover:text-white bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 transition-colors cursor-pointer flex items-center gap-1"
                            title="Upload this single part directly to active AI chat"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <line x1="12" y1="19" x2="12" y2="5" />
                              <polyline points="5 12 12 5 19 12" />
                            </svg>
                            <span>Upload Part</span>
                          </button>

                          {/* Download Part button */}
                          <button
                            type="button"
                            onClick={() => handleSaveSingleChunk(chunk)}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium text-amber-300 hover:text-white bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition-colors cursor-pointer flex items-center gap-1"
                            title="Save this single part as a text file to disk"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                            <span>Download</span>
                          </button>

                          {/* Accordion toggle */}
                          <button
                            type="button"
                            onClick={() => toggleChunkExpand(chunk.index)}
                            className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                            title="Toggle files list"
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              className={`transition-transform duration-150 ${isExpanded ? 'rotate-180' : 'rotate-0'}`}
                            >
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </button>
                        </div>
                      </div>

                      {/* Capacity Progress Bar */}
                      <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            pct > 90 ? 'bg-amber-500' : 'bg-gradient-to-r from-purple-500 to-cyan-400'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>

                      {/* Expandable Files Accordion */}
                      {isExpanded && (
                        <div className="border border-white/5 rounded-lg p-2.5 bg-black/30 divide-y divide-white/[0.04] max-h-48 overflow-y-auto space-y-1">
                          {chunk.files.map((cf) => (
                            <div
                              key={cf.relativePath}
                              className="py-1 px-2 flex items-center justify-between text-xs font-mono text-gray-300"
                            >
                              <span className="truncate">{cf.relativePath}</span>
                              <span className="text-gray-500 shrink-0 ml-3">{formatBytes(cf.size)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>

            {/* Drawer Bottom Action Bar */}
            <div className="px-6 py-4 border-t border-purple-500/20 bg-purple-950/20 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-gray-400">
                {isUploadingSequentially ? (
                  <span className="text-cyan-300 font-mono animate-pulse">
                    ⚡ {uploadProgress?.message || 'Uploading chunks sequentially (1.5s delay)...'}
                  </span>
                ) : (
                  <span>
                    Upload all parts sequentially with automated pacing for AI model ingestion.
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsChunksDrawerOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-gray-300 hover:text-white hover:bg-white/10 border border-white/10 transition-colors cursor-pointer"
                >
                  Close
                </button>

                <button
                  type="button"
                  disabled={
                    !partitionResult ||
                    partitionResult.chunks.length === 0 ||
                    isUploadingSequentially
                  }
                  onClick={handleUploadAllSequentially}
                  className="px-5 py-2 rounded-xl text-xs font-medium text-white shadow-lg bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 shadow-purple-500/25 border border-purple-400/30 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isUploadingSequentially ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      <span>Uploading Sequentially...</span>
                    </>
                  ) : (
                    <>
                      <span>Upload All {partitionResult?.chunks.length || 0} Parts Sequentially</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="5" y1="12" x2="19" y2="12" />
                        <polyline points="12 5 19 12 12 19" />
                      </svg>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

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
