import React, { useEffect, useState, useRef, useMemo } from 'react'
import { IconX, IconCopy, IconCheck, IconDownload, IconZap, BrandIcon } from './BrandIcons'
import { BRAND_IDS, modelColor, modelLabel } from '../lib/modelVisuals'
import {
  buildAgentHandoffPrompt,
  type HandoffContextResult,
  type CompressionOptions
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
  const [rawTranscript, setRawTranscript] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const [downloaded, setDownloaded] = useState(false)

  // Compression Controls
  const [mode, setMode] = useState<CompressionOptions['mode']>('handoff')
  const [stripPleasantries, setStripPleasantries] = useState(true)
  const [deduplicateCode, setDeduplicateCode] = useState(true)
  const [excludeThinking, setExcludeThinking] = useState(true)

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
          mode: 'handoff',
          stripPleasantries: true,
          deduplicateCode: true,
          excludeThinking: true
        })

        if (!mounted) return

        if (!res) throw new Error('No context could be extracted from active tab')
        if (res.success === false && res.error) {
          throw new Error(res.error)
        }

        const raw = typeof res === 'string' ? res : res.rawText || res.prompt || ''
        if (!raw) throw new Error('Empty transcript extracted from active webview')

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

  // Instant re-computation when compression options or mode change
  const handoffData: HandoffContextResult | null = useMemo(() => {
    if (!rawTranscript) return null

    return buildAgentHandoffPrompt({
      providerName: modelLabel(activeModel),
      rawText: rawTranscript,
      options: {
        mode,
        stripPleasantries,
        deduplicateCode,
        excludeThinking
      }
    })
  }, [rawTranscript, activeModel, mode, stripPleasantries, deduplicateCode, excludeThinking])

  const activePromptText = handoffData?.prompt || rawTranscript || ''
  const stats = handoffData?.stats

  const handleCopy = async () => {
    if (!activePromptText) return
    try {
      // @ts-ignore
      if (window.electron?.clipboard) {
        // @ts-ignore
        await window.electron.clipboard.writeText(activePromptText)
      } else {
        await navigator.clipboard.writeText(activePromptText)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch (e) {
      console.error('Failed to copy to clipboard:', e)
    }
  }

  const handleDownload = () => {
    if (!activePromptText) return
    try {
      const blob = new Blob([activePromptText], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const safeModel = activeModel.toLowerCase().replace(/[^a-z0-9]/g, '-')
      const dateStr = new Date().toISOString().slice(0, 10)
      a.href = url
      a.download = `nexus-agent-handoff-${safeModel}-${dateStr}.md`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setDownloaded(true)
      setTimeout(() => setDownloaded(false), 2500)
    } catch (e) {
      console.error('Failed to download markdown:', e)
    }
  }

  const handleHandoffToModel = (targetKey: string) => {
    handleCopy()
    if (onSwitchModel) {
      onSwitchModel(targetKey)
    }
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
                Compresses session state from <span className="text-white font-bold">{modelLabel(activeModel)}</span>
                {activeTabTitle ? <span className="text-white/80"> &bull; &ldquo;{activeTabTitle}&rdquo;</span> : ''} into a high-density context file for another AI to continue seamlessly
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
                  ~{stats.compressedTokensEstimate.toLocaleString()} tokens
                </span>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {stats.reductionPercent > 0 ? `🟢 -${stats.reductionPercent}% Compressed` : 'Optimized'}
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
                {handoffData?.detectedFiles && handoffData.detectedFiles.length > 0 && (
                  <span className="hidden sm:inline">
                    Files: <strong className="text-cyan-300">{handoffData.detectedFiles.length}</strong>
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-[11px] text-amber-200/80">
              <IconZap size={13} className="text-amber-400" />
              <span>Zero Context Loss</span>
            </div>
          </div>
        )}

        {/* Mode Selector & Compression Controls */}
        {status === 'done' && (
          <div className="px-6 py-3 bg-black/20 border-b border-white/5 flex flex-wrap items-center justify-between gap-3 shrink-0">
            {/* Mode Switcher Tabs */}
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-black/40 border border-white/10">
              <button
                type="button"
                onClick={() => setMode('handoff')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  mode === 'handoff'
                    ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40 shadow-sm'
                    : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
                title="Generates complete prompt with Goal, Decisions, Architecture, Immediate Next Action, and Dialogue"
              >
                <span>🚀 Agent Handoff Prompt</span>
                <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300">
                  Recommended
                </span>
              </button>

              <button
                type="button"
                onClick={() => setMode('compact')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  mode === 'compact'
                    ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 shadow-sm'
                    : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
                title="Ultra-compact caveman style: high-signal bullets, no filler articles, exact code"
              >
                <span>⚡ High-Density Compact</span>
              </button>

              <button
                type="button"
                onClick={() => setMode('clean')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  mode === 'clean'
                    ? 'bg-purple-500/25 text-purple-300 border border-purple-500/40 shadow-sm'
                    : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
                title="Clean dialogue transcript with UI noise stripped"
              >
                <span>📜 Clean Dialogue</span>
              </button>
            </div>

            {/* Granular Toggles */}
            <div className="flex items-center gap-3 text-xs text-white/80 flex-wrap">
              <label className="flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors" title="Deduplicate identical code blocks across turns">
                <input
                  type="checkbox"
                  checked={deduplicateCode}
                  onChange={(e) => setDeduplicateCode(e.target.checked)}
                  className="accent-amber-500 cursor-pointer"
                />
                <span>Deduplicate Code</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors" title="Strip greetings, polite filler, and sign-offs">
                <input
                  type="checkbox"
                  checked={stripPleasantries}
                  onChange={(e) => setStripPleasantries(e.target.checked)}
                  className="accent-amber-500 cursor-pointer"
                />
                <span>Strip Fluff</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors" title="Exclude massive internal chain-of-thought blocks">
                <input
                  type="checkbox"
                  checked={excludeThinking}
                  onChange={(e) => setExcludeThinking(e.target.checked)}
                  className="accent-amber-500 cursor-pointer"
                />
                <span>Exclude Thinking</span>
              </label>
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
                <p className="text-xs text-white/50">Reading conversation tree and sanitizing DOM artifacts across turns</p>
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
                  Preview: {mode === 'handoff' ? 'Agent Handoff Specification' : mode === 'compact' ? 'High-Density Caveman Context' : 'Clean Dialogue'} ({activePromptText.split('\n').length} lines)
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
                    onClick={() => handleHandoffToModel(p.key)}
                    className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 hover:text-white transition-all flex items-center gap-1.5 cursor-pointer"
                    title={`Copy handoff prompt and switch to ${p.label}`}
                  >
                    <span>➔ {p.label}</span>
                  </button>
                ))}
            </div>

            {/* Primary Action Buttons */}
            <div className="flex items-center gap-2.5 ml-auto flex-wrap">
              <button
                type="button"
                onClick={handleDownload}
                className="px-3.5 py-2 rounded-xl text-xs font-bold border border-white/10 bg-white/5 hover:bg-white/10 text-white transition-all flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
                title="Download this full context packet as a .md file"
              >
                {downloaded ? <IconCheck size={14} className="text-emerald-400" /> : <IconDownload size={14} />}
                <span>{downloaded ? 'Downloaded .md!' : 'Download .md'}</span>
              </button>

              <button
                type="button"
                onClick={handleCopy}
                className="px-5 py-2 rounded-xl text-xs font-bold text-black transition-all flex items-center gap-2 shadow-lg active:scale-95 cursor-pointer"
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
                <span>{copied ? '✓ Copied Handoff Prompt!' : 'Copy Agent Handoff Prompt'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
