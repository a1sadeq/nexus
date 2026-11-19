import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  partitionOfficeSelection,
  statusLabel,
  type OfficeQueueEntry,
  type OfficeSelectionReport
} from '../../../shared/officeBatch'
import {
  NO_CONSENT,
  consentLabel,
  type OfficeConsent,
  type OfficeConsentKey
} from '../../../shared/officePreview'

/**
 * Multi-file Office dialog (plan 02, stage 4) for folder drops and mixed selections.
 *
 * Differences from the single-file dialog, and why they matter:
 *  - consent is collected PER FILE. A folder can hold one deck with speaker notes next to a
 *    workbook with hidden sheets; approving one must not approve the other.
 *  - a file that cannot be read does not cancel the others: its row says why and the rest are
 *    still inserted.
 *  - non-Office files are listed with the reason they are not handled here, so a mixed
 *    selection never silently drops half of what the user picked.
 *  - there is still no Send: the action is "insert", and the user presses Send.
 */

export interface OfficeSelectionDialogProps {
  isOpen: boolean
  filePaths: string[]
  onClose: () => void
}

type Phase = 'idle' | 'preparing' | 'ready' | 'inserting' | 'inserted' | 'failed'

interface SelectionResponse {
  ok?: boolean
  report?: OfficeSelectionReport
  manifest?: string
  cancelled?: boolean
  message?: string
}

const CONSENT_ORDER: OfficeConsentKey[] = ['hiddenSheets', 'speakerNotes', 'hiddenSlides', 'comments']

export const OfficeSelectionDialog: React.FC<OfficeSelectionDialogProps> = ({
  isOpen,
  filePaths,
  onClose
}) => {
  const ipc = window.electron?.ipcRenderer
  const partition = useMemo(() => partitionOfficeSelection(filePaths), [filePaths])

  const [phase, setPhase] = useState<Phase>('idle')
  const [report, setReport] = useState<OfficeSelectionReport | null>(null)
  const [manifest, setManifest] = useState('')
  const [consentByPath, setConsentByPath] = useState<Record<string, OfficeConsent>>({})
  const [attachPdf, setAttachPdf] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)

  const prepare = useCallback(
    async (consent: Record<string, OfficeConsent>) => {
      if (!ipc || partition.office.length === 0) return
      setPhase('preparing')
      setError(null)
      setNotice(null)
      try {
        const response = (await ipc.invoke('prepare_office_selection', {
          filePaths: partition.office,
          consentByPath: consent,
          wantPdf: true
        })) as SelectionResponse
        if (!response?.ok || !response.report) {
          setPhase('failed')
          setError(response?.message ?? 'Preparing the selection failed.')
          return
        }
        setReport(response.report)
        setManifest(response.manifest ?? '')
        if (response.cancelled) setNotice('Preparation was cancelled part-way through.')
        setPhase('ready')
      } catch (err) {
        setPhase('failed')
        setError(`Preparing the selection failed: ${String(err)}`)
      }
    },
    [ipc, partition.office]
  )

  // Deferred by a tick for the same reason as the single-file dialog: no setState cascade
  // inside the effect body.
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    const timer = setTimeout(() => {
      if (!cancelled) void prepare({})
    }, 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [isOpen, prepare])

  useEffect(() => {
    if (!ipc || !isOpen) return
    const dispose = ipc.on(
      'office_selection_progress',
      (_event: unknown, payload: { fileName?: string; index?: number; total?: number }) => {
        if (!payload?.fileName) return
        setProgress(`Reading ${payload.index}/${payload.total}: ${payload.fileName}`)
      }
    )
    return () => dispose?.()
  }, [ipc, isOpen])

  const toggleConsent = useCallback(
    (filePath: string, key: OfficeConsentKey) => {
      const current = consentByPath[filePath] ?? NO_CONSENT
      const next = { ...consentByPath, [filePath]: { ...current, [key]: !current[key] } }
      setConsentByPath(next)
      // Re-prepare: the preview must be exactly what would be inserted.
      void prepare(next)
    },
    [consentByPath, prepare]
  )

  const insert = useCallback(async () => {
    if (!ipc || !report) return
    const jobIds = report.entries
      .filter((entry) => entry.status === 'ready' && entry.jobId)
      .map((entry) => entry.jobId as string)
    if (jobIds.length === 0) return
    setPhase('inserting')
    setError(null)
    try {
      const result = (await ipc.invoke('attach_prepared_office_selection', {
        jobIds,
        attachPdf,
        manifestText: manifest
      })) as { success?: boolean; message?: string; awaitingUserSend?: boolean }
      if (!result?.success) {
        setPhase('ready')
        setError(result?.message ?? 'The files could not be inserted.')
        return
      }
      setPhase('inserted')
      setNotice(
        result.awaitingUserSend
          ? 'Inserted into the composer. Nothing has been sent — press Send when you are ready.'
          : 'Inserted.'
      )
    } catch (err) {
      setPhase('ready')
      setError(`Could not insert: ${String(err)}`)
    }
  }, [attachPdf, ipc, manifest, report])

  const close = useCallback(() => {
    if (report) {
      for (const entry of report.entries) {
        if (entry.jobId) ipc?.send('discard_office_job', entry.jobId)
      }
    }
    onClose()
  }, [ipc, onClose, report])

  if (!isOpen) return null

  const readyEntries = report?.entries.filter((entry) => entry.status === 'ready') ?? []
  const anyPdf = readyEntries.some((entry) => entry.pdfPages)

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-2xl bg-neutral-900 border border-neutral-700 shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-neutral-800">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white">
              Prepare {partition.office.length} Office file
              {partition.office.length === 1 ? '' : 's'}
            </h2>
            <p className="text-[11px] text-neutral-400">
              Read locally, one verdict per file. Nothing is uploaded until you press Send.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="px-2 py-1 rounded-md text-[11px] text-neutral-300 bg-neutral-800 hover:bg-neutral-700 cursor-pointer"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {phase === 'preparing' && (
            <p className="text-[12px] text-neutral-400">
              {progress ?? 'Reading the files locally — no external service is contacted.'}
            </p>
          )}

          {partition.other.length > 0 && (
            <div className="rounded-xl border border-neutral-700 bg-neutral-800/60 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-neutral-400 mb-1">
                Not handled here ({partition.other.length})
              </p>
              <ul className="space-y-0.5">
                {partition.other.map((entry) => (
                  <li key={entry.path} className="text-[11px] text-neutral-400">
                    · <span className="font-mono">{entry.path.split(/[\\/]/).pop()}</span> — {entry.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {partition.overCap.length > 0 && (
            <p className="text-[11px] text-amber-300">
              {partition.overCap.length} more Office file(s) were not read: prepare them in a second pass.
            </p>
          )}

          <div className="divide-y divide-neutral-800 rounded-xl border border-neutral-800 overflow-hidden">
            {(report?.entries ?? []).map((entry: OfficeQueueEntry) => (
              <div key={entry.filePath} className="px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12px] text-white truncate">
                    {entry.order}. {entry.fileName}
                  </span>
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      entry.status === 'ready'
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : entry.status === 'preparing' || entry.status === 'pending'
                          ? 'bg-neutral-700/40 text-neutral-300'
                          : 'bg-amber-500/15 text-amber-300'
                    }`}
                  >
                    {statusLabel(entry.status)}
                  </span>
                </div>

                {entry.status === 'ready' && (
                  <p className="text-[11px] text-neutral-400">
                    {entry.kind ?? 'office'} · {entry.partCount ?? 0} part(s) ·{' '}
                    {(entry.totalChars ?? 0).toLocaleString()} chars
                    {entry.pdfPages ? ` · PDF ${entry.pdfPages}p` : ''}
                    {entry.hasText === false ? ' · no extractable text' : ''}
                  </p>
                )}

                {entry.status !== 'ready' && (entry.message || entry.reason) && (
                  <p className="text-[11px] text-amber-300/90">{entry.message ?? entry.reason}</p>
                )}

                {entry.consentNeeded.length > 0 && entry.status === 'ready' && (
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    {CONSENT_ORDER.filter((key) => entry.consentNeeded.includes(key)).map((key) => (
                      <label key={key} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean((consentByPath[entry.filePath] ?? NO_CONSENT)[key])}
                          onChange={() => toggleConsent(entry.filePath, key)}
                          className="accent-fuchsia-500"
                        />
                        <span className="text-[11px] text-neutral-300">{consentLabel(key, true)}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {(!report || report.entries.length === 0) && (
              <p className="px-3 py-2 text-[11px] text-neutral-500">No Office files in this selection.</p>
            )}
          </div>

          {(report?.warnings ?? []).length > 0 && (
            <ul className="space-y-0.5">
              {report?.warnings.map((warning) => (
                <li key={warning} className="text-[11px] text-neutral-400">
                  · {warning}
                </li>
              ))}
            </ul>
          )}

          {anyPdf && (
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={attachPdf}
                onChange={() => setAttachPdf((value) => !value)}
                className="mt-0.5 accent-cyan-500"
              />
              <span className="text-[11px] text-neutral-300">
                Attach the rendered PDFs as files too. Nexus has not verified that your provider accepts
                PDFs — check they appear in the composer before sending.
              </span>
            </label>
          )}

          {error && <p className="text-[11px] text-rose-300">{error}</p>}
          {notice && <p className="text-[12px] text-emerald-300">{notice}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-neutral-800">
          <p className="text-[11px] text-neutral-500">
            {report
              ? `${report.ready} ready · ${report.refused} not prepared · ${report.totalParts} part(s)`
              : 'Nothing prepared yet.'}
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
              disabled={readyEntries.length === 0 || phase === 'inserting' || phase === 'inserted'}
              onClick={insert}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-cyan-500/20 border border-cyan-500/40 text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              title="Puts the extracted text in the composer. You still press Send."
            >
              {phase === 'inserting'
                ? 'Inserting…'
                : phase === 'inserted'
                  ? 'Inserted — press Send'
                  : `Insert ${readyEntries.length || ''} file(s)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
