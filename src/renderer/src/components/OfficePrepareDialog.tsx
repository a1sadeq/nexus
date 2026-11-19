import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  NO_CONSENT,
  consentExclusionNote,
  consentLabel,
  describeConsentSurface,
  type OfficeConsent,
  type OfficeConsentKey,
  type OfficePrepareResponse
} from '../../../shared/officePreview'

/**
 * Office approval dialog (plan 02, stage 3).
 *
 * The dialog is the only place hidden material can be approved, and the three things plan 02
 * forbids are impossible here by construction:
 *  - there is no Send: the strongest action is "insert into the composer", which uploads
 *    nothing until the user presses Send themselves;
 *  - hidden worksheets, notes, hidden slides and comments are shown only when the matching
 *    box is ticked, and each tick re-prepares the file so the preview cannot drift from what
 *    would be attached;
 *  - it never says a provider accepts Office files — that verdict does not exist here.
 */

export interface OfficePrepareDialogProps {
  isOpen: boolean
  filePath: string | null
  onClose: () => void
  /** Set when the file was opened from the folder review modal rather than a single upload. */
  originLabel?: string
}

type Phase = 'preparing' | 'ready' | 'attaching' | 'inserted' | 'failed'

const bytes = (value: number): string =>
  value >= 1024 * 1024 ? `${(value / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(value / 1024)} KB`

export const OfficePrepareDialog: React.FC<OfficePrepareDialogProps> = ({
  isOpen,
  filePath,
  onClose,
  originLabel
}) => {
  const ipc = window.electron?.ipcRenderer
  const [phase, setPhase] = useState<Phase>('preparing')
  const [consent, setConsent] = useState<OfficeConsent>(NO_CONSENT)
  const [jobId, setJobId] = useState<string | null>(null)
  const [preview, setPreview] = useState<OfficePrepareResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [attachPdf, setAttachPdf] = useState(false)
  const [showManifest, setShowManifest] = useState(false)
  const [copiedPart, setCopiedPart] = useState<number | null>(null)

  const fileName = useMemo(() => (filePath ? filePath.split(/[\\/]/).pop() : null), [filePath])

  const prepare = useCallback(
    async (nextConsent: OfficeConsent, previousJobId?: string | null) => {
      if (!ipc || !filePath) return
      setPhase('preparing')
      setError(null)
      setNotice(null)
      try {
        const response = (await ipc.invoke('prepare_office', {
          filePath,
          consent: nextConsent,
          wantPdf: true,
          discardJobId: previousJobId ?? undefined
        })) as OfficePrepareResponse & { jobId?: string }
        setPreview(response)
        if (response?.ok) {
          setJobId(response.jobId ?? previousJobId ?? null)
          setPhase('ready')
        } else {
          setPhase('failed')
          setError(response?.message ?? 'Preparation failed.')
        }
      } catch (err) {
        setPhase('failed')
        setError(`Preparation failed: ${String(err)}`)
      }
    },
    [filePath, ipc]
  )

  // Keyed per file by the parent (`key={filePath}`), so a new file remounts with clean state.
  // The first read is deferred by a tick: preparing synchronously inside an effect would
  // cascade a render before the dialog is even painted.
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    const timer = setTimeout(() => {
      if (!cancelled) void prepare(NO_CONSENT, null)
    }, 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [isOpen, prepare])

  const toggleConsent = useCallback(
    (key: OfficeConsentKey) => {
      const next = { ...consent, [key]: !consent[key] }
      setConsent(next)
      // Re-prepare from scratch: the preview must show exactly what would be attached.
      void prepare(next, jobId)
    },
    [consent, jobId, prepare]
  )

  const copyPart = useCallback(
    async (index: number) => {
      if (!ipc || !jobId) return
      try {
        const result = (await ipc.invoke('read_office_part', { jobId, index })) as {
          ok?: boolean
          content?: string
          message?: string
        }
        if (!result?.ok || typeof result.content !== 'string') {
          setError(result?.message ?? 'That part is no longer available.')
          return
        }
        await navigator.clipboard.writeText(result.content)
        setCopiedPart(index)
        setTimeout(() => setCopiedPart((current) => (current === index ? null : current)), 1500)
      } catch (err) {
        setError(`Could not copy: ${String(err)}`)
      }
    },
    [ipc, jobId]
  )

  const insert = useCallback(async () => {
    if (!ipc || !jobId) return
    setPhase('attaching')
    setError(null)
    try {
      const result = (await ipc.invoke('attach_prepared_office', {
        jobId,
        attachPdf,
        includeManifest: true
      })) as { success?: boolean; message?: string; awaitingUserSend?: boolean }
      if (!result?.success) {
        setPhase('ready')
        setError(result?.message ?? 'The text could not be inserted.')
        return
      }
      setPhase('inserted')
      setNotice(
        result.awaitingUserSend
          ? 'Inserted into the composer. Nothing has been sent — press Send when you are ready.'
          : 'Inserted. Nothing has been sent.'
      )
    } catch (err) {
      setPhase('ready')
      setError(`Could not insert: ${String(err)}`)
    }
  }, [attachPdf, ipc, jobId])

  const close = useCallback(() => {
    if (jobId) ipc?.send('discard_office_job', jobId)
    onClose()
  }, [ipc, jobId, onClose])

  if (!isOpen) return null

  const ok = preview?.ok === true ? preview : null
  const needed = ok?.consentNeeded ?? []
  const excluded = ok ? consentExclusionNote(needed, ok.consent) : []
  const surface = {
    hiddenSheets: 0,
    sheetsWithNotes: 0,
    hiddenSlides: 0,
    slidesWithNotes: 0,
    comments: 0,
    ...(ok
      ? {
          hiddenSheets: ok.consentNeeded.includes('hiddenSheets') ? 1 : 0,
          hiddenSlides: ok.consentNeeded.includes('hiddenSlides') ? 1 : 0,
          slidesWithNotes: ok.consentNeeded.includes('speakerNotes') ? 1 : 0,
          comments: ok.consentNeeded.includes('comments') ? 1 : 0
        }
      : {})
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-2xl bg-neutral-900 border border-neutral-700 shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-neutral-800">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white truncate">
              Prepare {ok ? ok.kind : 'Office'} file
            </h2>
            <p className="text-[11px] font-mono text-neutral-400 truncate">{fileName}</p>
            {originLabel && <p className="text-[11px] text-neutral-500 mt-0.5">{originLabel}</p>}
          </div>
          <button
            type="button"
            onClick={close}
            className="px-2 py-1 rounded-md text-[11px] text-neutral-300 bg-neutral-800 hover:bg-neutral-700 cursor-pointer"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {!ok && phase !== 'preparing' && error && (
            <div className="rounded-xl border border-amber-600/40 bg-amber-950/30 px-3 py-2 text-[12px] text-amber-200">
              {error}
              {preview && preview.ok === false && preview.pdfPath && (
                <p className="mt-1 text-amber-300/90">
                  A PDF of the original was rendered at:
                  <span className="font-mono text-[11px] break-all"> {preview.pdfPath}</span>
                </p>
              )}
            </div>
          )}

          {phase === 'preparing' && (
            <p className="text-[12px] text-neutral-400">
              Reading the file locally — nothing is uploaded and no external service is used.
            </p>
          )}

          {ok && (
            <>
              <div className="rounded-xl border border-sky-700/40 bg-sky-950/30 px-3 py-2 text-[12px] text-sky-100">
                {ok.untrustedNotice}
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                {ok.inventory.map((line) => (
                  <div key={line.label} className="flex items-baseline justify-between gap-3">
                    <span className="text-[11px] text-neutral-400">{line.label}</span>
                    <span className="text-[11px] font-mono text-neutral-200 text-right">{line.value}</span>
                  </div>
                ))}
              </div>

              {needed.length > 0 && (
                <div className="rounded-xl border border-fuchsia-700/40 bg-fuchsia-950/20 px-3 py-3">
                  <p className="text-[11px] uppercase tracking-wide text-fuchsia-300 mb-2">
                    Hidden material found
                  </p>
                  <div className="space-y-1.5">
                    {needed.map((key) => (
                      <label key={key} className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={consent[key]}
                          onChange={() => toggleConsent(key)}
                          className="mt-0.5 accent-fuchsia-500"
                        />
                        <span className="text-[12px] text-neutral-200">
                          {consentLabel(key, true)}
                          <span className="block text-[11px] text-neutral-400">
                            {describeConsentSurface(surface, key)} — excluded unless you tick this.
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {excluded.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {excluded.map((line) => (
                        <li key={line} className="text-[11px] text-neutral-400">
                          · {line}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {ok.warnings.length > 0 && (
                <div className="rounded-xl border border-neutral-700 bg-neutral-800/60 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-neutral-400 mb-1">Warnings</p>
                  <ul className="space-y-1">
                    {ok.warnings.map((warning) => (
                      <li key={warning} className="text-[11px] text-neutral-300">
                        · {warning}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-wide text-neutral-400">
                    Text parts ({ok.parts.length}) · {ok.totalChars.toLocaleString()} characters
                  </p>
                  {!ok.hasText && (
                    <span className="text-[11px] text-amber-300">no extractable text — PDF only</span>
                  )}
                </div>
                <div className="mt-1 divide-y divide-neutral-800 rounded-xl border border-neutral-800 overflow-hidden">
                  {ok.parts.length === 0 && (
                    <p className="px-3 py-2 text-[11px] text-neutral-500">No text parts.</p>
                  )}
                  {ok.parts.map((part) => (
                    <div key={part.index} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[12px] text-white truncate">
                          {part.index}. {part.label}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] font-mono text-neutral-500">
                            {part.chars.toLocaleString()} ch
                          </span>
                          <button
                            type="button"
                            onClick={() => copyPart(part.index)}
                            className="px-2 py-0.5 rounded-md text-[10px] text-neutral-200 bg-neutral-800 hover:bg-neutral-700 cursor-pointer"
                          >
                            {copiedPart === part.index ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                      </div>
                      <p className="text-[10px] font-mono text-neutral-500 truncate">{part.covers}</p>
                      <p className="mt-0.5 text-[11px] text-neutral-400 line-clamp-2">{part.excerpt}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-neutral-800 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-neutral-400">Original layout (PDF)</p>
                {ok.pdf.state === 'available' && (
                  <p className="text-[12px] text-neutral-200">
                    Rendered locally: {ok.pdf.pages} page(s), {bytes(ok.pdf.bytes)}.
                  </p>
                )}
                {ok.pdf.state === 'unavailable' && (
                  <p className="text-[12px] text-amber-200">{ok.pdf.reason}</p>
                )}
                {ok.pdf.state === 'not-requested' && (
                  <p className="text-[12px] text-neutral-400">
                    Not applicable — workbooks are exported as coordinates and values, not as a PDF.
                  </p>
                )}
                {ok.pdf.state === 'available' && (
                  <label className="mt-1 flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={attachPdf}
                      onChange={() => setAttachPdf((value) => !value)}
                      className="mt-0.5 accent-cyan-500"
                    />
                    <span className="text-[11px] text-neutral-300">
                      Attach the PDF as a file too. Nexus has not verified that your provider accepts PDFs, so
                      check it appears in the composer before sending.
                    </span>
                  </label>
                )}
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setShowManifest((value) => !value)}
                  className="text-[11px] text-neutral-400 hover:text-neutral-200 cursor-pointer"
                >
                  {showManifest ? 'Hide' : 'Show'} manifest
                </button>
                {showManifest && (
                  <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-black/60 border border-neutral-800 p-2 text-[10px] font-mono text-neutral-300 whitespace-pre-wrap">
                    {ok.manifest}
                  </pre>
                )}
              </div>
            </>
          )}

          {error && ok && (
            <p className="text-[11px] text-rose-300">{error}</p>
          )}
          {notice && <p className="text-[12px] text-emerald-300">{notice}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-neutral-800">
          <p className="text-[11px] text-neutral-500">
            Local only. No conversion service, no automatic upload.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={close}
              className="px-3 py-1.5 rounded-lg text-[12px] text-neutral-200 bg-neutral-800 hover:bg-neutral-700 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!ok || !ok.hasText || phase === 'attaching' || phase === 'inserted'}
              onClick={insert}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-cyan-500/20 border border-cyan-500/40 text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              title="Puts the text in the composer. You still press Send."
            >
              {phase === 'attaching'
                ? 'Inserting…'
                : phase === 'inserted'
                  ? 'Inserted — press Send'
                  : 'Insert into composer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
