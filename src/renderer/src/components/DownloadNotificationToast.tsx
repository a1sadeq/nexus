import React, { useEffect, useState, useCallback, useRef } from 'react'
import { IconDownload, IconFolder, IconX, IconTerminal } from './BrandIcons'

export interface DownloadItemInfo {
  id: string
  filename: string
  fullPath: string
  directory: string
  fileSize: number
  mimeType?: string
  isProjectDir: boolean
  timestamp: number
}

function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

function getFileExtension(filename: string): string {
  const parts = filename.split('.')
  return parts.length > 1 ? parts.pop()?.toUpperCase() || 'FILE' : 'FILE'
}

interface ToastItem extends DownloadItemInfo {
  dismissTimer?: ReturnType<typeof setTimeout>
  isHovered?: boolean
}

export const DownloadNotificationToast: React.FC = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const toastsRef = useRef<ToastItem[]>([])
  toastsRef.current = toasts

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const startDismissTimer = useCallback((id: string) => {
    const timer = setTimeout(() => {
      removeToast(id)
    }, 8000)

    setToasts((prev) =>
      prev.map((t) => {
        if (t.id === id) {
          return { ...t, dismissTimer: timer }
        }
        return t
      })
    )
  }, [removeToast])

  const clearDismissTimer = useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((t) => {
        if (t.id === id && t.dismissTimer) {
          clearTimeout(t.dismissTimer)
          return { ...t, dismissTimer: undefined }
        }
        return t
      })
    )
  }, [])

  const handleCopyPath = useCallback((id: string, fullPath: string) => {
    try {
      navigator.clipboard.writeText(fullPath)
    } catch {}
    window.electron?.downloads?.copyPath?.(fullPath)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }, [])

  useEffect(() => {
    const unsubscribe = window.electron?.downloads?.onCompleted?.((info: DownloadItemInfo) => {
      setToasts((prev) => [info, ...prev.slice(0, 4)]) // Keep max 5 toasts
      startDismissTimer(info.id)
    })

    return () => {
      unsubscribe?.()
      toastsRef.current.forEach((t) => {
        if (t.dismissTimer) clearTimeout(t.dismissTimer)
      })
    }
  }, [startDismissTimer])

  if (toasts.length === 0) return null

  return (
    <div
      className="fixed bottom-5 right-5 z-[99999] flex flex-col gap-3 pointer-events-auto max-w-[420px] w-full"
      style={{ fontFamily: 'Inter, sans-serif' }}
    >
      {toasts.map((toast) => {
        const ext = getFileExtension(toast.filename)
        const isProject = toast.isProjectDir
        const shortDirName = toast.directory.split(/[/\\]/).filter(Boolean).pop() || toast.directory

        return (
          <div
            key={toast.id}
            onMouseEnter={() => clearDismissTimer(toast.id)}
            onMouseLeave={() => startDismissTimer(toast.id)}
            className="p-4 rounded-[8px] border flex flex-col gap-3 shadow-2xl transition-all duration-200 animate-in fade-in slide-in-from-bottom-4 hud-bracket"
            style={{
              background: 'linear-gradient(135deg, rgba(20, 24, 38, 0.96) 0%, rgba(10, 12, 20, 0.98) 100%)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              borderColor: isProject ? 'rgba(34, 211, 238, 0.4)' : 'rgba(99, 102, 241, 0.4)',
              boxShadow: isProject
                ? '0 12px 35px rgba(0, 0, 0, 0.6), 0 0 20px rgba(34, 211, 238, 0.15)'
                : '0 12px 35px rgba(0, 0, 0, 0.6), 0 0 20px rgba(99, 102, 241, 0.15)'
            }}
          >
            {/* Header: File info & Close */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {/* File badge icon */}
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border"
                  style={{
                    background: isProject ? 'rgba(34, 211, 238, 0.15)' : 'rgba(99, 102, 241, 0.15)',
                    borderColor: isProject ? 'rgba(34, 211, 238, 0.3)' : 'rgba(99, 102, 241, 0.3)',
                    color: isProject ? '#22d3ee' : '#818cf8'
                  }}
                >
                  <IconDownload size={20} />
                </div>

                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs sm:text-sm text-white truncate" title={toast.filename}>
                      {toast.filename}
                    </span>
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-white/10 text-white/80 shrink-0">
                      {ext}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-gray-400 mt-0.5">
                    <span>{formatBytes(toast.fileSize)}</span>
                    <span>•</span>
                    <span className="text-emerald-400 font-medium flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Downloaded
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                title="Dismiss"
              >
                <IconX size={14} />
              </button>
            </div>

            {/* Destination path indicator badge */}
            <div
              className="px-3 py-1.5 rounded-xl border text-[11px] font-mono flex items-center justify-between gap-2 overflow-hidden"
              style={{
                background: 'rgba(0, 0, 0, 0.4)',
                borderColor: isProject ? 'rgba(34, 211, 238, 0.2)' : 'rgba(255, 255, 255, 0.08)'
              }}
            >
              <div className="flex items-center gap-1.5 min-w-0 truncate text-gray-300">
                <IconFolder size={13} className={isProject ? 'text-cyan-400 shrink-0' : 'text-indigo-400 shrink-0'} />
                <span className="truncate" title={toast.directory}>
                  {isProject ? `Project: ${shortDirName}` : 'downloads/nexus'}
                </span>
              </div>
              {isProject && (
                <span className="text-[9px] px-1.5 py-0.2 rounded font-bold uppercase bg-cyan-500/20 text-cyan-300 shrink-0">
                  Project
                </span>
              )}
            </div>

            {/* Interactive Action Buttons */}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  window.electron?.downloads?.showItemInFolder(toast.fullPath)
                }}
                className="flex-1 px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer hover:brightness-110 active:scale-[0.98]"
                style={{
                  background: isProject ? 'linear-gradient(135deg, #0891b2 0%, #0284c7 100%)' : 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
                  color: '#ffffff'
                }}
              >
                <IconFolder size={14} />
                <span>📂 Open Location</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  window.electron?.downloads?.openPath(toast.fullPath)
                }}
                className="px-3 py-2 rounded-xl text-xs font-medium border border-white/15 bg-white/5 hover:bg-white/10 text-white flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-[0.98]"
              >
                <IconTerminal size={13} />
                <span>⚡ Open File</span>
              </button>

              <button
                type="button"
                onClick={() => handleCopyPath(toast.id, toast.fullPath)}
                className="px-2.5 py-2 rounded-xl text-xs font-medium border border-white/15 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white flex items-center justify-center transition-all cursor-pointer active:scale-[0.98]"
                title="Copy full file path"
              >
                {copiedId === toast.id ? (
                  <span className="text-emerald-400 font-bold text-xs">✓</span>
                ) : (
                  <span>📋</span>
                )}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
