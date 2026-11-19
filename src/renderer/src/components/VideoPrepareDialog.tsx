import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { VIDEO_PACE_BUDGETS, type VideoPace } from '../../../shared/videoPlan'
import { capabilityBadge, type CapabilityVerdict } from '../../../shared/videoCapability'
import type { VideoJobSummary } from '../../../main/videoJob'

/**
 * Video approval dialog (plan 01, stage 2).
 *
 * Everything the user sees here is generated from the material that actually exists, and
 * the two things plan 01 forbids are structurally impossible in this component:
 *  - it never sends a message (there is no code path that presses Send);
 *  - it never claims a provider accepts video unless a recorded observation proves it.
 */

interface ToolStatus {
  ffprobe: boolean
  ffmpeg: boolean
  source: string
}

export interface VideoPrepareDialogProps {
  isOpen: boolean
  filePath: string | null
  providerKey?: string
  modelKey?: string
  onClose: () => void
}

type Phase = 'idle' | 'preparing' | 'ready' | 'attaching' | 'attached' | 'failed'

const PACE_ORDER: VideoPace[] = ['quick', 'balanced', 'detailed']

const formatMb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

export const VideoPrepareDialog: React.FC<VideoPrepareDialogProps> = ({
  isOpen,
  filePath,
  providerKey,
  modelKey,
  onClose
}) => {
  const [tools, setTools] = useState<ToolStatus | null>(null)
  const [capability, setCapability] = useState<CapabilityVerdict | null>(null)
  const [pace, setPace] = useState<VideoPace>('balanced')
  const [phase, setPhase] = useState<Phase>('idle')
  const [summary, setSummary] = useState<VideoJobSummary | null>(null)
  const [manifestText, setManifestText] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)

  const ipc = window.electron?.ipcRenderer

  const fileName = useMemo(() => (filePath ? filePath.split(/[\\/]/).pop() : null), [filePath])

  // State is keyed to the file: the parent remounts this component per video
  // (`key={filePath}`), which is cheaper and less error-prone than resetting in an effect.

  // Ask the main process what it can actually do, and what is known about this provider.
  useEffect(() => {
    if (!isOpen || !ipc) return
    let cancelled = false
    void (async () => {
      try {
        const [toolStatus, capabilityResult] = await Promise.all([
          ipc.invoke('get_media_tool_status'),
          ipc.invoke('get_video_capability', { provider: providerKey, model: modelKey })
        ])
        if (cancelled) return
        setTools((toolStatus as ToolStatus) ?? null)
        const verdict = (capabilityResult as { verdict?: CapabilityVerdict })?.verdict
        setCapability(verdict ?? null)
      } catch (err) {
        if (!cancelled) setError(`Could not read local media tooling: ${String(err)}`)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isOpen, ipc, providerKey, modelKey])

  const discardJob = useCallback(() => {
    if (summary?.jobId) ipc?.send('discard_video_job', summary.jobId)
  }, [ipc, summary])

  const close = useCallback(() => {
    if (phase === 'preparing') ipc?.send('cancel_video_preparation')
    // Frames must not outlive the dialog unless the user attached them.
    if (phase !== 'attached') discardJob()
    onClose()
  }, [discardJob, ipc, onClose, phase])

  const startPrepare = useCallback(async () => {
    if (!ipc || !filePath) return
    setPhase('preparing')
    setError(null)
    setMessage(null)
    try {
      const result = (await ipc.invoke('prepare_video', {
        filePath,
        pace,
        provider: providerKey,
        model: modelKey
      })) as { ok?: boolean; summary?: VideoJobSummary; message?: string; reason?: string }

      if (!result?.ok || !result.summary) {
        setPhase('failed')
        setError(result?.message ?? 'Preparation failed.')
        return
      }
      setSummary(result.summary)
      setManifestText(result.summary.manifest)
      setCapability(result.summary.capability)
      setPhase('ready')
    } catch (err) {
      setPhase('failed')
      setError(`Preparation failed: ${String(err)}`)
    }
  }, [filePath, ipc, modelKey, pace, providerKey])

  const attach = useCallback(async () => {
    if (!ipc || !summary) return
    setPhase('attaching')
    setError(null)
    try {
      const result = (await ipc.invoke('attach_prepared_video', {
        jobId: summary.jobId,
        manifestText,
        includeManifest: manifestText.trim().length > 0
      })) as { success?: boolean; message?: string }
      if (result?.success) {
        setPhase('attached')
        setMessage(
          `${result.message ?? 'Attached.'} Nothing was sent — review the attachments and press Send yourself.`
        )
      } else {
        setPhase('ready')
        setError(result?.message ?? 'Could not attach the prepared material.')
      }
    } catch (err) {
      setPhase('ready')
      setError(`Could not attach: ${String(err)}`)
    }
  }, [ipc, manifestText, summary])

  const recordObservation = useCallback(
    async (status: 'supported' | 'unsupported') => {
      if (!ipc || !providerKey) return
      setRecording(true)
      try {
        const result = (await ipc.invoke('record_video_capability_observation', {
          provider: providerKey,
          model: modelKey,
          status,
          fact: status === 'supported' ? 'attachment-confirmed' : 'provider-error',
          source: status === 'supported' ? 'live-dom' : 'provider-error'
        })) as { success?: boolean; verdict?: CapabilityVerdict; error?: string }
        if (result?.verdict) setCapability(result.verdict)
        setMessage(
          result?.success
            ? 'Recorded. This is your observation on this build and it expires — re-test after provider UI changes.'
            : `Not recorded: ${result?.error ?? 'invalid observation'}`
        )
      } finally {
        setRecording(false)
      }
    },
    [ipc, modelKey, providerKey]
  )

  if (!isOpen) return null

  const toolsMissing = tools !== null && !tools.ffmpeg
  const budget = VIDEO_PACE_BUDGETS[pace]
  const canPrepare = Boolean(filePath) && !toolsMissing && phase !== 'preparing' && tools !== null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[860px] max-h-[88vh] overflow-hidden rounded-2xl border border-white/10 bg-[#0d1117] shadow-2xl flex flex-col">
        <div className="px-6 py-4 border-b border-white/10 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-white">Prepare video for AI</h2>
            <p className="text-xs text-gray-400 mt-1 font-mono truncate max-w-[560px]" title={filePath ?? ''}>
              {fileName ?? 'no file selected'}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="px-2 py-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 text-xs cursor-pointer"
          >
            Close
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto space-y-4 text-sm text-gray-300">
          {/* Tooling */}
          {tools && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-xs">
              <span className="text-gray-400">Local tools: </span>
              <span className={tools.ffprobe ? 'text-emerald-300' : 'text-amber-300'}>
                ffprobe {tools.ffprobe ? 'found' : 'missing'}
              </span>
              {' · '}
              <span className={tools.ffmpeg ? 'text-emerald-300' : 'text-amber-300'}>
                ffmpeg {tools.ffmpeg ? 'found' : 'missing'}
              </span>
              {toolsMissing && (
                <p className="mt-2 text-amber-300/90 leading-relaxed">
                  Without ffmpeg Nexus cannot extract stills locally, so it will not pretend to prepare
                  anything. Install ffmpeg, or point <code className="font-mono">NEXUS_FFMPEG_PATH</code> at a
                  binary, or attach the original video instead.
                </p>
              )}
            </div>
          )}

          {/* Provider capability — never a guess */}
          {capability && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-400">Native video on {providerKey ?? 'this provider'}:</span>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-white/10 text-gray-200">
                  {capabilityBadge(capability)}
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">{capability.reason}</p>
              {providerKey && (
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[11px] text-gray-500">Record what you saw:</span>
                  <button
                    type="button"
                    disabled={recording}
                    onClick={() => void recordObservation('supported')}
                    className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 text-[11px] cursor-pointer disabled:opacity-50"
                  >
                    Attachment confirmed
                  </button>
                  <button
                    type="button"
                    disabled={recording}
                    onClick={() => void recordObservation('unsupported')}
                    className="px-2 py-0.5 rounded-md bg-rose-500/15 border border-rose-500/30 text-rose-200 text-[11px] cursor-pointer disabled:opacity-50"
                  >
                    Provider rejected it
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Pace */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-gray-400">Detail level</span>
              <span className="text-[11px] text-gray-500">
                max {budget.maxFrames} stills · every ~{budget.intervalSec}s · {budget.maxFrameEdgePx}px ·{' '}
                ≈{formatMb(budget.maxBytes)} budget
              </span>
            </div>
            <div className="flex gap-2">
              {PACE_ORDER.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={phase === 'preparing'}
                  onClick={() => setPace(option)}
                  className={`px-3 py-1.5 rounded-lg text-xs border cursor-pointer transition-colors ${
                    pace === option
                      ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-200'
                      : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                  }`}
                >
                  {VIDEO_PACE_BUDGETS[option].label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => void startPrepare()}
                disabled={!canPrepare}
                className="ml-auto px-3 py-1.5 rounded-lg text-xs bg-cyan-500/20 border border-cyan-400/40 text-cyan-100 cursor-pointer disabled:opacity-40"
              >
                {phase === 'preparing' ? 'Extracting stills…' : 'Prepare'}
              </button>
            </div>
          </div>

          {/* Preparation result */}
          {summary && (
            <div className="space-y-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
                <p className="text-xs text-gray-300">{summary.coverageSummary}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {summary.frameCount} still(s), {formatMb(summary.totalBytes)} total · {summary.pace}
                </p>
              </div>

              {summary.warnings.length > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                  <p className="text-xs text-amber-200 font-medium mb-1">Preparation warnings</p>
                  <ul className="text-xs text-amber-100/85 space-y-1 list-disc pl-4">
                    {summary.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
                <p className="text-xs text-gray-300 font-medium mb-1">What this material cannot promise</p>
                <ul className="text-xs text-gray-400 space-y-1 list-disc pl-4">
                  {summary.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1">
                  Manifest attached with the stills (editable — you approve these words)
                </label>
                <textarea
                  value={manifestText}
                  onChange={(event) => setManifestText(event.target.value)}
                  spellCheck={false}
                  className="w-full h-40 rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-[11px] font-mono text-gray-300 focus:outline-none focus:border-cyan-400/40"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  Leave it empty to attach only the images.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
              {error}
            </div>
          )}
          {message && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
              {message}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-white/10 flex items-center justify-between gap-3">
          <p className="text-[11px] text-gray-500 max-w-[460px]">
            Nexus prepares this locally. Nothing is uploaded by these buttons, and Nexus never presses
            Send for you — the original file stays untouched.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={close}
              className="px-3 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-gray-300 cursor-pointer"
            >
              {phase === 'attached' ? 'Done' : 'Cancel'}
            </button>
            <button
              type="button"
              onClick={() => void attach()}
              disabled={!summary || phase === 'attaching' || phase === 'attached'}
              className="px-3 py-1.5 rounded-lg text-xs bg-cyan-500/25 border border-cyan-400/40 text-cyan-100 cursor-pointer disabled:opacity-40"
            >
              {phase === 'attaching' ? 'Attaching…' : 'Attach prepared material'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default VideoPrepareDialog
