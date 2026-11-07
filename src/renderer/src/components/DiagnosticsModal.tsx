import React, { useState, useEffect, useCallback } from 'react'
import {
  IconActivity,
  IconDownload,
  IconCopy,
  IconRotate,
  IconX,
  IconCheck
} from './BrandIcons'

export interface ProcessDiagnostic {
  pid: number
  type: string
  name: string
  tabId?: string
  modelKey?: string
  domain?: string
  cpuPercent: number
  idleWakeupsPerSecond: number
  memoryMB: number
  peakMemoryMB: number
  privateMemoryMB: number
  sharedMemoryMB: number
  isThrottled?: boolean
  isMuted?: boolean
}

export interface TabDiagnostic {
  id: string
  modelKey: string
  title: string
  domain: string
  isActive: boolean
  isPinned: boolean
  isEvicted: boolean
  isThrottled: boolean
  isMuted: boolean
}

export interface DiagnosticReport {
  timestamp: string
  appVersion: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
  v8Version: string
  os: {
    platform: string
    arch: string
    release: string
    totalMemoryGB: number
    freeMemoryGB: number
    cpuModel: string
    cpuCores: number
    loadAvg1m: number
  }
  summary: {
    totalProcesses: number
    totalCpuPercent: number
    totalMemoryMB: number
    mainMemoryMB: number
    gpuMemoryMB: number
    rendererMemoryMB: number
    activeTabsCount: number
    discardedTabsCount: number
    diskCacheMB: number
  }
  cache: {
    rootCacheBytes: number
    partitionCacheBytes: number
    totalCacheBytes: number
    totalCacheMB: number
    processMemoryMB: number
    heapUsedMB: number
  }
  tabDiscardPolicy: {
    tabDiscardMinutes: number
    maxActiveTabs: number
  }
  tabs: TabDiagnostic[]
  processes: ProcessDiagnostic[]
}

export interface DiagnosticsModalProps {
  isOpen: boolean
  onClose: () => void
}

export const DiagnosticsModal: React.FC<DiagnosticsModalProps> = ({ isOpen, onClose }) => {
  const [report, setReport] = useState<DiagnosticReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [exportedPath, setExportedPath] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'processes' | 'tabs' | 'system'>('processes')

  const fetchDiagnostics = useCallback(async (samplingMs: number = 2000) => {
    setLoading(true)
    setExportedPath(null)
    setExportError(null)
    try {
      const res = await (window.electron?.diagnostics?.capture
        ? window.electron.diagnostics.capture(samplingMs)
        : (window.electron?.ipcRenderer?.invoke?.('capture_diagnostics', samplingMs) as any))
      if (res?.success && res?.report) {
        setReport(res.report)
      }
    } catch (err) {
      console.error('Failed to capture diagnostics:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      fetchDiagnostics(2000)
    } else {
      setReport(null)
      setCopied(false)
      setExportedPath(null)
    }
  }, [isOpen, fetchDiagnostics])

  const handleCopyClipboard = async () => {
    if (!report) return
    try {
      const jsonStr = JSON.stringify(report, null, 2)
      await navigator.clipboard.writeText(jsonStr)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch (err) {
      console.error('Failed to copy to clipboard:', err)
    }
  }

  const handleExportFile = async () => {
    if (!report) return
    setExportError(null)
    try {
      const res = await (window.electron?.diagnostics?.exportToFile
        ? window.electron.diagnostics.exportToFile(report)
        : (window.electron?.ipcRenderer?.invoke?.('export_diagnostics_file', report) as any))
      if (res?.success && res?.filePath) {
        setExportedPath(res.filePath)
      } else {
        setExportError(res?.error || 'Failed to write diagnostics file')
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleOpenFolder = (path: string) => {
    try {
      window.electron?.downloads?.showItemInFolder?.(path)
    } catch (err) {
      console.error('Failed to reveal file:', err)
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="w-full max-w-4xl max-h-[85vh] rounded-2xl border flex flex-col shadow-2xl overflow-hidden text-slate-200"
        style={{
          background: 'var(--bg, #0d0f12)',
          borderColor: 'var(--border, rgba(255, 255, 255, 0.12))'
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b shrink-0"
          style={{ borderColor: 'var(--border, rgba(255, 255, 255, 0.1))' }}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center border border-indigo-500/30">
              <IconActivity size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
                Nexus Performance & System Diagnostics
                {report && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                    Live
                  </span>
                )}
              </h2>
              <p className="text-[11px] opacity-60">
                Sampled CPU breakdown, memory allocations, background webviews, and cache footprint
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fetchDiagnostics(2000)}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 transition-all flex items-center gap-1.5 disabled:opacity-50"
              title="Sample CPU over 2 seconds"
            >
              <span className={loading ? 'animate-spin' : ''}>
                <IconRotate size={13} />
              </span>
              <span>{loading ? 'Sampling (2s)...' : 'Re-sample'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Close"
            >
              <IconX size={16} />
            </button>
          </div>
        </div>

        {/* Loading Banner */}
        {loading && (
          <div className="px-6 py-2.5 bg-indigo-500/10 border-b border-indigo-500/20 flex items-center gap-2.5 text-xs text-indigo-300">
            <span className="w-3.5 h-3.5 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin shrink-0" />
            <span>Measuring 2-second CPU attribution differential across all processes...</span>
          </div>
        )}

        {/* Export Success/Error Feedback */}
        {exportedPath && (
          <div className="px-6 py-2 bg-emerald-500/10 border-b border-emerald-500/20 flex items-center justify-between text-xs text-emerald-300">
            <div className="flex items-center gap-2 truncate">
              <IconCheck size={14} className="shrink-0 text-emerald-400" />
              <span className="truncate">Saved report to: <span className="font-mono text-white">{exportedPath}</span></span>
            </div>
            <button
              type="button"
              onClick={() => handleOpenFolder(exportedPath)}
              className="px-2.5 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 text-[11px] font-semibold transition-colors shrink-0 ml-3"
            >
              Show in Folder
            </button>
          </div>
        )}

        {exportError && (
          <div className="px-6 py-2 bg-rose-500/10 border-b border-rose-500/20 text-xs text-rose-300">
            Export failed: {exportError}
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5 custom-scrollbar min-h-0">
          {report ? (
            <>
              {/* Stat Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div
                  className="p-3.5 rounded-xl border flex flex-col gap-1"
                  style={{ background: 'var(--surface, #13171d)', borderColor: 'var(--border, rgba(255,255,255,0.08))' }}
                >
                  <span className="text-[11px] font-medium opacity-60">Total Nexus CPU</span>
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={`text-xl font-bold font-mono ${
                        report.summary.totalCpuPercent > 25
                          ? 'text-rose-400'
                          : report.summary.totalCpuPercent > 10
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {report.summary.totalCpuPercent}%
                    </span>
                    <span className="text-[10px] opacity-50">2s avg</span>
                  </div>
                </div>

                <div
                  className="p-3.5 rounded-xl border flex flex-col gap-1"
                  style={{ background: 'var(--surface, #13171d)', borderColor: 'var(--border, rgba(255,255,255,0.08))' }}
                >
                  <span className="text-[11px] font-medium opacity-60">Total Process RAM</span>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xl font-bold font-mono text-indigo-400">
                      {report.summary.totalMemoryMB} MB
                    </span>
                    <span className="text-[10px] opacity-50">working set</span>
                  </div>
                </div>

                <div
                  className="p-3.5 rounded-xl border flex flex-col gap-1"
                  style={{ background: 'var(--surface, #13171d)', borderColor: 'var(--border, rgba(255,255,255,0.08))' }}
                >
                  <span className="text-[11px] font-medium opacity-60">AI WebViews</span>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xl font-bold font-mono text-cyan-400">
                      {report.summary.activeTabsCount} Active
                    </span>
                    {report.summary.discardedTabsCount > 0 && (
                      <span className="text-[10px] opacity-60 text-slate-400">
                        ({report.summary.discardedTabsCount} evicted)
                      </span>
                    )}
                  </div>
                </div>

                <div
                  className="p-3.5 rounded-xl border flex flex-col gap-1"
                  style={{ background: 'var(--surface, #13171d)', borderColor: 'var(--border, rgba(255,255,255,0.08))' }}
                >
                  <span className="text-[11px] font-medium opacity-60">Disk & Media Cache</span>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xl font-bold font-mono text-purple-400">
                      {report.summary.diskCacheMB} MB
                    </span>
                    <span className="text-[10px] opacity-50">capped @ 100MB</span>
                  </div>
                </div>
              </div>

              {/* Sub-nav Tabs */}
              <div className="flex items-center gap-2 border-b pb-2" style={{ borderColor: 'var(--border, rgba(255,255,255,0.08))' }}>
                <button
                  type="button"
                  onClick={() => setActiveTab('processes')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    activeTab === 'processes'
                      ? 'bg-white/10 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Process Tree ({report.processes.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('tabs')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    activeTab === 'tabs'
                      ? 'bg-white/10 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Tab Lifecycle ({report.tabs.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('system')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    activeTab === 'system'
                      ? 'bg-white/10 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Host & Hardware Specs
                </button>
              </div>

              {/* Tab 1: Process Table */}
              {activeTab === 'processes' && (
                <div
                  className="rounded-xl border overflow-hidden"
                  style={{ background: 'var(--surface, #13171d)', borderColor: 'var(--border, rgba(255,255,255,0.08))' }}
                >
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-white/5 bg-white/5 text-[11px] font-semibold text-slate-400">
                        <th className="py-2.5 px-3">Process Name & Role</th>
                        <th className="py-2.5 px-3">PID</th>
                        <th className="py-2.5 px-3">CPU Usage</th>
                        <th className="py-2.5 px-3">Working Set</th>
                        <th className="py-2.5 px-3">Peak RAM</th>
                        <th className="py-2.5 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 font-mono">
                      {report.processes.map((p) => (
                        <tr key={p.pid} className="hover:bg-white/5 transition-colors font-sans">
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2">
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${
                                  p.type === 'Browser'
                                    ? 'bg-blue-400'
                                    : p.type === 'GPU'
                                    ? 'bg-emerald-400'
                                    : p.type === 'Renderer'
                                    ? 'bg-amber-400'
                                    : 'bg-purple-400'
                                }`}
                              />
                              <div>
                                <span className="font-medium text-slate-200">{p.name}</span>
                                {p.domain && (
                                  <span className="block text-[10px] text-slate-400 font-mono">
                                    {p.domain}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-400 text-[11px]">{p.pid}</td>
                          <td className="py-2.5 px-3 font-mono">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                                p.cpuPercent > 15
                                  ? 'bg-rose-500/20 text-rose-300'
                                  : p.cpuPercent > 5
                                  ? 'bg-amber-500/20 text-amber-300'
                                  : 'text-slate-300'
                              }`}
                            >
                              {p.cpuPercent}%
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-200">{p.memoryMB} MB</td>
                          <td className="py-2.5 px-3 font-mono text-slate-400">{p.peakMemoryMB} MB</td>
                          <td className="py-2.5 px-3">
                            {p.isThrottled ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                                Throttled (1Hz)
                              </span>
                            ) : p.type === 'Tab' ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/20">
                                Active Foreground
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-500">System</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tab 2: Tab Lifecycle Table */}
              {activeTab === 'tabs' && (
                <div
                  className="rounded-xl border overflow-hidden"
                  style={{ background: 'var(--surface, #13171d)', borderColor: 'var(--border, rgba(255,255,255,0.08))' }}
                >
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-white/5 bg-white/5 text-[11px] font-semibold text-slate-400">
                        <th className="py-2.5 px-3">Provider</th>
                        <th className="py-2.5 px-3">Title</th>
                        <th className="py-2.5 px-3">Origin (Sanitized)</th>
                        <th className="py-2.5 px-3">State</th>
                        <th className="py-2.5 px-3">Background CPU</th>
                        <th className="py-2.5 px-3">Audio</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {report.tabs.map((t) => (
                        <tr key={t.id} className="hover:bg-white/5 transition-colors">
                          <td className="py-2.5 px-3 font-semibold uppercase text-[10px] tracking-wider text-indigo-400">
                            {t.modelKey}
                          </td>
                          <td className="py-2.5 px-3 font-medium text-slate-200 truncate max-w-[200px]">
                            {t.title}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400">
                            {t.domain}
                          </td>
                          <td className="py-2.5 px-3">
                            {t.isActive ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300">
                                Focused Active
                              </span>
                            ) : t.isEvicted ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-300">
                                Discarded (0 MB)
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-500/20 text-slate-300">
                                Resident Background
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            {t.isThrottled ? (
                              <span className="text-emerald-400 font-medium">Frozen / Throttled</span>
                            ) : (
                              <span className="text-slate-400">Full Rate</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-slate-400">
                            {t.isMuted ? 'Muted' : 'Audible'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tab 3: System Hardware Specs */}
              {activeTab === 'system' && (
                <div
                  className="p-4 rounded-xl border grid grid-cols-2 gap-4 text-xs"
                  style={{ background: 'var(--surface, #13171d)', borderColor: 'var(--border, rgba(255,255,255,0.08))' }}
                >
                  <div className="flex flex-col gap-2">
                    <span className="font-bold text-white text-[13px] border-b border-white/5 pb-1">Host System Specs</span>
                    <div className="flex justify-between py-1 border-b border-white/5">
                      <span className="text-slate-400">Operating System:</span>
                      <span className="font-mono text-slate-200">{report.os.platform} ({report.os.release})</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-white/5">
                      <span className="text-slate-400">Architecture:</span>
                      <span className="font-mono text-slate-200">{report.os.arch}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-white/5">
                      <span className="text-slate-400">CPU Model:</span>
                      <span className="font-mono text-slate-200 truncate max-w-[200px]" title={report.os.cpuModel}>
                        {report.os.cpuModel}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-white/5">
                      <span className="text-slate-400">CPU Cores:</span>
                      <span className="font-mono text-slate-200">{report.os.cpuCores} cores</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-400">Host Total RAM:</span>
                      <span className="font-mono text-slate-200">{report.os.totalMemoryGB} GB ({report.os.freeMemoryGB} GB free)</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <span className="font-bold text-white text-[13px] border-b border-white/5 pb-1">Runtime & Engine Versions</span>
                    <div className="flex justify-between py-1 border-b border-white/5">
                      <span className="text-slate-400">Nexus Version:</span>
                      <span className="font-mono text-slate-200">v{report.appVersion}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-white/5">
                      <span className="text-slate-400">Electron:</span>
                      <span className="font-mono text-slate-200">v{report.electronVersion}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-white/5">
                      <span className="text-slate-400">Chromium:</span>
                      <span className="font-mono text-slate-200">v{report.chromeVersion}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-white/5">
                      <span className="text-slate-400">V8 JavaScript Engine:</span>
                      <span className="font-mono text-slate-200">v{report.v8Version}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-400">Node.js:</span>
                      <span className="font-mono text-slate-200">v{report.nodeVersion}</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
              <span className="w-8 h-8 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
              <span className="text-xs">Sampling system telemetry...</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          className="flex items-center justify-between px-6 py-3.5 border-t shrink-0 bg-black/20"
          style={{ borderColor: 'var(--border, rgba(255, 255, 255, 0.1))' }}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportFile}
              disabled={!report || loading}
              className="px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border transition-all active:scale-95 disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(147, 51, 234, 0.2))',
                borderColor: 'rgba(59, 130, 246, 0.4)',
                color: '#fff'
              }}
            >
              <IconDownload size={14} />
              <span>Export JSON to Downloads</span>
            </button>

            <button
              type="button"
              onClick={handleCopyClipboard}
              disabled={!report || loading}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 transition-all text-slate-200 disabled:opacity-50"
            >
              {copied ? <IconCheck size={14} className="text-emerald-400" /> : <IconCopy size={14} />}
              <span>{copied ? 'Copied to Clipboard!' : 'Copy to Clipboard'}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
