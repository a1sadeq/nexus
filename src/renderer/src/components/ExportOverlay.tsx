import React, { useEffect, useState, useRef, useMemo } from 'react'
import { IconX, IconCopy, IconCheck, IconDownload, IconZap, BrandIcon } from './BrandIcons'
import { BRAND_IDS, modelColor, modelLabel } from '../lib/modelVisuals'
import {
  type ConversationSnapshot,
  projectSnapshotToMarkdown,
  type ContinuationPacketResult,
  type ExportProjectionMode
} from '../../../shared/contextSnapshot'
import {
  buildAgentHandoffPrompt,
  type HandoffContextResult
} from '../../../shared/contextCompressor'
import type { ModelDef } from '../App'

interface ExportOverlayProps {
  activeModel: string
  activeTabTitle?: string
  models?: ModelDef[]
  onSwitchModel?: (modelKey: string) => void
  onClose: () => void
}

export const ExportOverlay: React.FC<ExportOverlayProps> = ({
  activeModel,
  activeTabTitle,
  models = [],
  onSwitchModel,
  onClose
}) => {
  const [status, setStatus] = useState<'extracting' | 'done' | 'error'>('extracting')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [isActionPending, setIsActionPending] = useState(false)

  // Immutable captured metadata
  const [snapshot, setSnapshot] = useState<ConversationSnapshot | null>(null)
  const [capturedProvider, setCapturedProvider] = useState<string>('')
  const [capturedTitle, setCapturedTitle] = useState<string>('')
  const [rawTranscript, setRawTranscript] = useState<string>('')
  const [coverageWarnings, setCoverageWarnings] = useState<string[]>([])

  const [copied, setCopied] = useState(false)
  const [downloaded, setDownloaded] = useState(false)

  // Projection Controls
  const [mode, setMode] = useState<ExportProjectionMode>('brief')
  const [stripPleasantries, setStripPleasantries] = useState(true)
  const [deduplicateCode, setDeduplicateCode] = useState(true)
  const [includeThinking, setIncludeThinking] = useState(false)

  // User-editable continuation fields
  const [userObjective, setUserObjective] = useState<string>('')
  const [userNextAction, setUserNextAction] = useState<string>('')
  const [showEditorFields, setShowEditorFields] = useState<boolean>(false)

  const color = modelColor(activeModel)
  const rootRef = useRef<HTMLDivElement>(null)

  // Fetch initial raw context from active guest webview
  useEffect(() => {
    let mounted = true
    const extract = async () => {
      try {
        // @ts-ignore
        if (!window.electron) throw new Error('Electron runtime not available')

        // @ts-ignore
        const res = await window.electron.ipcRenderer.invoke('extract_context', {
          mode: 'brief',
          stripPleasantries: true,
          deduplicateCode: true,
          excludeThinking: true
        })

        if (!mounted) return

        if (!res) throw new Error('No context could be extracted from active tab')
        if (res.success === false && res.error) {
          throw new Error(res.error)
        }

        if (res.snapshot) {
          setSnapshot(res.snapshot)
          setCapturedProvider(res.providerName || modelLabel(activeModel))
          setCapturedTitle(res.title || activeTabTitle || '')
          setCoverageWarnings(res.coverageWarnings || res.snapshot.coverage?.warnings || [])
          setUserObjective(res.currentObjective || '')
          setUserNextAction(res.nextActionCandidate || '')
        }

        const raw = typeof res === 'string' ? res : res.rawText || res.prompt || ''
        if (!raw && !res.snapshot) throw new Error('Empty transcript extracted from active webview')

        setRawTranscript(raw)
        setStatus('done')
      } catch (err: any) {
        if (!mounted) return
        console.error('Failed to extract context:', err)
        setErrorMessage(err?.message || 'Failed to extract context from active session')
        setStatus('error')
      }
    }

    extract()
    return () => {
      mounted = false
    }
  }, [])

  // Auto-focus overlay and claim window focus
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true })
    // @ts-ignore
    window.electron?.ipcRenderer.send('claim_window_focus')
  }, [])

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Deterministic projection recalculation
  const projectionData: ContinuationPacketResult | HandoffContextResult | null = useMemo(() => {
    if (snapshot) {
      return projectSnapshotToMarkdown({
        snapshot,
        options: {
          mode,
          stripPleasantries,
          deduplicateExactCode: deduplicateCode,
          includeThinkingSummary: includeThinking,
          userObjectiveOverride: userObjective.trim() ? userObjective : undefined,
          userNextActionOverride: userNextAction.trim() ? userNextAction : undefined
        }
      })
    }

    if (!rawTranscript) return null

    // Legacy fallback if snapshot is absent
    return buildAgentHandoffPrompt({
      providerName: capturedProvider || modelLabel(activeModel),
      rawText: rawTranscript,
      options: {
        mode: mode === 'transcript' ? 'clean' : mode === 'compact' ? 'compact' : 'handoff',
        stripPleasantries,
        deduplicateCode,
        excludeThinking: !includeThinking,
        userObjectiveOverride: userObjective.trim() ? userObjective : undefined,
        userNextActionOverride: userNextAction.trim() ? userNextAction : undefined
      }
    })
  }, [
    snapshot,
    rawTranscript,
    capturedProvider,
    activeModel,
    mode,
    stripPleasantries,
    deduplicateCode,
    includeThinking,
    userObjective,
    userNextAction
  ])

  const activePromptText = projectionData?.prompt || rawTranscript || ''
  const stats = projectionData?.stats
  const outputTokensEstimate = stats
    ? 'outputTokensEstimate' in stats
      ? stats.outputTokensEstimate
      : stats.compressedTokensEstimate
    : 0

  const handleCopy = async (): Promise<boolean> => {
    if (!activePromptText || isActionPending) return false
    setIsActionPending(true)
    setCopyError(null)
    try {
      let ok = false
      // @ts-ignore
      if (window.electron?.ipcRenderer) {
        // @ts-ignore
        const res = await window.electron.ipcRenderer.invoke('clipboard_write', activePromptText)
        if (res && res.success === false) {
          throw new Error(res.error || 'Failed to write to clipboard')
        }
        ok = true
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(activePromptText)
        ok = true
      }

      if (ok) {
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
        return true
      }
      throw new Error('Clipboard interface unavailable')
    } catch (e: any) {
      console.error('Failed to copy to clipboard:', e)
      setCopyError(e?.message || 'Failed to copy to clipboard')
      return false
    } finally {
      setIsActionPending(false)
    }
  }

  const handleDownload = () => {
    if (!activePromptText || isActionPending) return
    try {
      const blob = new Blob([activePromptText], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const safeModel = (capturedProvider || activeModel).toLowerCase().replace(/[^a-z0-9]/g, '-')
      const snapId = snapshot?.snapshotId?.slice(0, 8) || 'snap'
      const dateStr = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD
      a.href = url
      a.download = `nexus-agent-handoff-${safeModel}-${snapId}-${dateStr}.md`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)

      setDownloaded(true)
      setTimeout(() => setDownloaded(false), 2500)
    } catch (e: any) {
      console.error('Failed to download markdown:', e)
      setCopyError(e?.message || 'Failed to download context packet')
    }
  }

  const handleHandoffToModel = async (targetKey: string) => {
    if (isActionPending) return
    const success = await handleCopy()
    if (!success) {
      // Abort switch on clipboard write failure; leave overlay open with error alert
      return
    }
    if (onSwitchModel) {
      onSwitchModel(targetKey)
    }
    onClose()
  }

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="absolute inset-0 z-[999999] flex items-center justify-center p-4 sm:p-6 md:p-8 bg-black/75 backdrop-blur-md animate-in fade-in duration-200 outline-none"
      onClick={(e) => {
        if (e.target === rootRef.current) onClose()
      }}
    >
      <div
        className="w-full max-w-4xl h-[88vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden relative border transition-all"
        style={{
          borderColor: color ? `${color}55` : 'rgba(245, 158, 11, 0.4)',
          backgroundColor: 'var(--bg)',
          boxShadow: `0 25px 60px -15px rgba(0, 0, 0, 0.7), 0 0 35px ${color ? `${color}33` : 'rgba(245, 158, 11, 0.15)'}`
        }}
      >
        {/* Header */}
        <div
          className="flex flex-wrap items-center justify-between px-6 py-4 border-b gap-3 shrink-0"
          style={{
            borderColor: 'rgba(255, 255, 255, 0.08)',
            background: 'linear-gradient(to right, rgba(245, 158, 11, 0.12), rgba(0, 0, 0, 0.4))'
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg border border-amber-500/30"
              style={{ background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(15, 17, 26, 0.9))' }}
            >
              {BRAND_IDS[activeModel] ? (
                <BrandIcon id={activeModel} size={20} className="text-amber-400 drop-shadow" />
              ) : (
                <span className="text-amber-300 font-bold">{activeModel.charAt(0).toUpperCase()}</span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white tracking-wide flex items-center gap-1.5">
                  <span>Agent Context Handoff Studio</span>
                </h2>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase tracking-wider">
                  Session Limit Rescuer
                </span>
              </div>
              <p className="text-xs text-amber-200/70 font-medium">
                Captured state from <span className="text-white font-bold">{capturedProvider || modelLabel(activeModel)}</span>
                {(capturedTitle || activeTabTitle) ? <span className="text-white/80"> &bull; &ldquo;{capturedTitle || activeTabTitle}&rdquo;</span> : ''} into a structured continuation packet
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
              title="Close (Esc)"
            >
              <IconX size={20} />
            </button>
          </div>
        </div>

        {/* Coverage or Error Banner */}
        {copyError && (
          <div className="px-6 py-2 bg-rose-500/20 border-b border-rose-500/30 flex items-center justify-between text-xs text-rose-200 shrink-0">
            <span>⚠️ {copyError}</span>
            <button
              onClick={() => setCopyError(null)}
              className="text-rose-400 hover:text-white font-bold cursor-pointer ml-3"
            >
              Dismiss
            </button>
          </div>
        )}

        {coverageWarnings.length > 0 && status === 'done' && (
          <div className="px-6 py-2 bg-amber-500/15 border-b border-amber-500/25 flex items-center gap-2 text-xs text-amber-200 shrink-0">
            <span>⚠️ <strong>Partial Capture Notice:</strong> {coverageWarnings.join('; ')}</span>
          </div>
        )}

        {/* Live Compression Metrics Bar */}
        {status === 'done' && stats && (
          <div className="px-6 py-2.5 bg-black/40 border-b border-white/5 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
            <div className="flex items-center gap-3 sm:gap-6 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-white/50">Size:</span>
                <span className="font-mono text-white/70 line-through text-[11px]">
                  ~{stats.rawTokensEstimate.toLocaleString()} tokens
                </span>
                <span className="text-white/40">➔</span>
                <span className="font-mono font-bold text-amber-300">
                  ~{outputTokensEstimate.toLocaleString()} tokens
                </span>
                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                  stats.isExpanded
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                    : stats.reductionPercent > 0
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    : 'bg-white/10 text-white/70 border-white/20'
                }`}>
                  {stats.isExpanded
                    ? `+${(stats.signedDeltaChars || 0).toLocaleString()} chars (Expanded)`
                    : stats.reductionPercent > 0
                    ? `🟢 -${stats.reductionPercent}% Compressed`
                    : 'Structured Output'}
                </span>
              </div>

              <div className="flex items-center gap-4 text-white/70 text-[11px] font-mono">
                <span>
                  Turns: <strong className="text-white">{stats.turnCount}</strong> ({stats.userTurns} User, {stats.assistantTurns} AI)
                </span>
                {stats.codeBlockCount > 0 && (
                  <span>
                    Code Blocks: <strong className="text-amber-300">{stats.codeBlockCount}</strong>
                  </span>
                )}
                {((projectionData as any)?.artifacts?.length || (projectionData as any)?.detectedFiles?.length) > 0 && (
                  <span className="hidden sm:inline">
                    Artifacts: <strong className="text-cyan-300">
                      {(projectionData as any)?.artifacts?.length || (projectionData as any)?.detectedFiles?.length}
                    </strong>
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-[11px] text-amber-200/80">
              <IconZap size={13} className="text-amber-400" />
              <span>Captured Content Preserved</span>
            </div>
          </div>
        )}

        {/* Mode Selector & Compression Controls */}
        {status === 'done' && (
          <div className="px-6 py-2.5 bg-black/20 border-b border-white/5 flex flex-wrap items-center justify-between gap-3 shrink-0">
            {/* Mode Switcher Tabs */}
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-black/40 border border-white/10">
              <button
                type="button"
                onClick={() => setMode('brief')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  mode === 'brief'
                    ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40 shadow-sm'
                    : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
                title="Structured continuation brief with provenance, artifacts, objective, and transcript"
              >
                <span>🚀 Continuation Brief</span>
                <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300">
                  Recommended
                </span>
              </button>

              <button
                type="button"
                onClick={() => setMode('transcript')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  mode === 'transcript'
                    ? 'bg-purple-500/25 text-purple-300 border border-purple-500/40 shadow-sm'
                    : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
                title="Faithful raw captured transcript preserving exact turns, code, and links"
              >
                <span>📜 Faithful Transcript</span>
              </button>

              <button
                type="button"
                onClick={() => setMode('compact')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  mode === 'compact'
                    ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 shadow-sm'
                    : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
                title="High-density evidence pack without prose fluff or stopword destruction"
              >
                <span>⚡ High-Density Pack</span>
              </button>
            </div>

            {/* Granular Toggles & Objective Editor Button */}
            <div className="flex items-center gap-3 text-xs text-white/80 flex-wrap">
              <button
                type="button"
                onClick={() => setShowEditorFields(!showEditorFields)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                  showEditorFields
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-white/5 text-white/70 hover:text-white border-white/10'
                }`}
              >
                ✏️ Edit Objective / Next Action
              </button>

              <label className="flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors" title="Deduplicate identical code blocks across turns">
                <input
                  type="checkbox"
                  checked={deduplicateCode}
                  onChange={(e) => setDeduplicateCode(e.target.checked)}
                  className="accent-amber-500 cursor-pointer"
                />
                <span>Deduplicate Exact Code</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors" title="Strip greetings and pleasantries from assistant prose only">
                <input
                  type="checkbox"
                  checked={stripPleasantries}
                  onChange={(e) => setStripPleasantries(e.target.checked)}
                  className="accent-amber-500 cursor-pointer"
                />
                <span>Strip Fluff</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors" title="Include user-visible reasoning summary (does not strip code think tags)">
                <input
                  type="checkbox"
                  checked={includeThinking}
                  onChange={(e) => setIncludeThinking(e.target.checked)}
                  className="accent-amber-500 cursor-pointer"
                />
                <span>Include Thinking</span>
              </label>
            </div>
          </div>
        )}

        {/* Optional Editable Continuation Fields Panel */}
        {status === 'done' && showEditorFields && (
          <div className="px-6 py-3 bg-black/40 border-b border-white/10 flex flex-col gap-2 shrink-0 animate-in fade-in duration-150">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-amber-300 uppercase tracking-wide">
                Current User Request / Objective:
              </label>
              <textarea
                value={userObjective}
                onChange={(e) => setUserObjective(e.target.value)}
                placeholder="Describe current objective..."
                rows={2}
                className="w-full p-2 rounded-lg bg-black/50 border border-white/10 text-xs text-white focus:outline-none focus:border-amber-500 resize-none font-mono"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold text-cyan-300 uppercase tracking-wide">
                Next Immediate Action Candidate:
              </label>
              <input
                type="text"
                value={userNextAction}
                onChange={(e) => setUserNextAction(e.target.value)}
                placeholder="Next action for incoming AI..."
                className="w-full px-2.5 py-1.5 rounded-lg bg-black/50 border border-white/10 text-xs text-white focus:outline-none focus:border-amber-500 font-mono"
              />
            </div>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-hidden p-4 sm:p-6 bg-(--surface) flex flex-col gap-3 min-h-0">
          {status === 'extracting' && (
            <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-(--text2)">
              <div className="w-10 h-10 border-4 border-t-transparent rounded-full animate-spin border-amber-500" />
              <div className="flex flex-col items-center gap-1">
                <p className="text-sm font-bold text-white animate-pulse">Extracting Deep Session Context...</p>
                <p className="text-xs text-white/50">Reading conversation tree and isolating code and message blocks</p>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="w-full h-full flex flex-col items-center justify-center text-center p-6 gap-3">
              <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40 flex items-center justify-center text-xl font-bold">
                ✕
              </div>
              <h3 className="text-base font-bold text-white">Extraction Failed</h3>
              <p className="text-xs text-rose-300 max-w-md">{errorMessage || 'Could not detect active messages on the current AI webview.'}</p>
              <p className="text-[11px] text-white/40 max-w-sm">Tip: Make sure the AI chat page has finished loading its messages before exporting.</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-2 px-4 py-1.5 rounded-lg text-xs font-bold bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {status === 'done' && (
            <div className="flex-1 flex flex-col min-h-0 relative rounded-xl border border-white/10 bg-black/60 overflow-hidden shadow-inner">
              <div className="flex items-center justify-between px-3.5 py-2 bg-black/40 border-b border-white/5 text-[11px] text-white/50 font-mono">
                <span>
                  Preview: {mode === 'brief' ? 'Continuation Brief' : mode === 'transcript' ? 'Faithful Transcript' : 'High-Density Pack'} ({activePromptText.split('\n').length} lines)
                </span>
                <span className="text-amber-300/80">Ready to paste into incoming AI</span>
              </div>
              <textarea
                readOnly
                value={activePromptText}
                className="flex-1 w-full p-4 font-mono text-xs text-gray-200 bg-transparent resize-none focus:outline-none custom-scrollbar leading-relaxed selection:bg-amber-500/30 selection:text-white"
                spellCheck={false}
              />
            </div>
          )}
        </div>

        {/* Footer Actions */}
        {status === 'done' && (
          <div className="px-6 py-4 border-t border-white/10 bg-black/40 flex flex-wrap items-center justify-between gap-3 shrink-0">
            {/* Quick Handoff Switcher */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-white/50 font-medium hidden sm:inline">Hand off to:</span>
              {(models.length > 0
                ? models.map((m) => ({ key: m.key, label: m.label }))
                : [
                    { key: 'claude', label: 'Claude' },
                    { key: 'chatgpt', label: 'ChatGPT' },
                    { key: 'gemini', label: 'Gemini' },
                    { key: 'deepseek', label: 'DeepSeek' }
                  ]
              )
                .filter((p) => p.key.toLowerCase() !== activeModel.toLowerCase())
                .slice(0, 4)
                .map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    disabled={isActionPending}
                    onClick={() => handleHandoffToModel(p.key)}
                    className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 hover:text-white transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    title={`Copy continuation packet and switch to ${p.label}`}
                  >
                    <span>➔ {p.label}</span>
                  </button>
                ))}
            </div>

            {/* Primary Action Buttons */}
            <div className="flex items-center gap-2.5 ml-auto flex-wrap">
              <button
                type="button"
                disabled={isActionPending}
                onClick={handleDownload}
                className="px-3.5 py-2 rounded-xl text-xs font-bold border border-white/10 bg-white/5 hover:bg-white/10 text-white transition-all flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95 disabled:opacity-50"
                title="Download this full context packet as a .md file"
              >
                {downloaded ? <IconCheck size={14} className="text-emerald-400" /> : <IconDownload size={14} />}
                <span>{downloaded ? 'Downloaded .md!' : 'Download .md'}</span>
              </button>

              <button
                type="button"
                disabled={isActionPending}
                onClick={() => handleCopy()}
                className="px-5 py-2 rounded-xl text-xs font-bold text-black transition-all flex items-center gap-2 shadow-lg active:scale-95 cursor-pointer disabled:opacity-50"
                style={{
                  background: copied
                    ? 'linear-gradient(135deg, #10b981, #059669)'
                    : 'linear-gradient(135deg, #f59e0b, #d97706)',
                  color: copied ? '#ffffff' : '#000000',
                  boxShadow: copied
                    ? '0 0 20px rgba(16, 185, 129, 0.4)'
                    : '0 0 20px rgba(245, 158, 11, 0.35)'
                }}
              >
                {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
                <span>{copied ? '✓ Copied Continuation Prompt!' : 'Copy Continuation Prompt'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
