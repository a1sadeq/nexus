import {
  buildSelectionManifest,
  emptyEntry,
  partitionOfficeSelection,
  summarizeSelection,
  type OfficeQueueEntry,
  type OfficeSelectionReport
} from '../shared/officeBatch'
import type { OfficeConsent } from '../shared/officePreview'
import {
  prepareOfficeDocument,
  type PrepareOfficeOptions,
  type PrepareOfficeResult
} from './officePrepare'

/**
 * Prepare several Office files from one selection (plan 02, stage 4).
 *
 * Sequential on purpose: each file is parsed in full, and running four workbook parsers at
 * once would just make the UI unresponsive for longer. Every file gets its own verdict —
 * one unreadable workbook does not cancel the others, and nothing is dropped without a
 * sentence explaining why.
 */

export interface BatchPreparedFile {
  filePath: string
  fileName: string
  order: number
  parts: { index: number; label: string; covers: string; content: string }[]
  preview: Extract<PrepareOfficeResult, { ok: true }>['preview']
  jobDir?: string
  pdfPath?: string
  consent: OfficeConsent
}

export interface PrepareSelectionOptions {
  filePaths: string[]
  consentByPath?: Record<string, Partial<OfficeConsent>>
  wantPdf?: boolean
  maxFiles?: number
  signal?: AbortSignal
  maxCharsPerPart?: number
  /** Injectable for tests; defaults to the real extractor. */
  prepare?: (options: PrepareOfficeOptions) => Promise<PrepareOfficeResult>
  onProgress?: (entry: OfficeQueueEntry, index: number, total: number) => void
}

export interface PrepareSelectionResult {
  report: OfficeSelectionReport
  prepared: BatchPreparedFile[]
  manifest: string
  cancelled: boolean
}

export async function prepareOfficeSelection(
  options: PrepareSelectionOptions
): Promise<PrepareSelectionResult> {
  const prepare = options.prepare ?? prepareOfficeDocument
  const partition = partitionOfficeSelection(options.filePaths, options.maxFiles)
  const entries: OfficeQueueEntry[] = partition.office.map((filePath, index) =>
    emptyEntry(filePath, index + 1)
  )
  const prepared: BatchPreparedFile[] = []
  let cancelled = false

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    if (options.signal?.aborted) {
      cancelled = true
      for (const rest of entries.slice(index)) {
        rest.status = 'cancelled'
        rest.message = 'Cancelled before this file was read.'
      }
      break
    }

    entry.status = 'preparing'
    options.onProgress?.(entry, index + 1, entries.length)

    const consent = options.consentByPath?.[entry.filePath] ?? {}
    const result = await prepare({
      filePath: entry.filePath,
      consent,
      wantPdf: options.wantPdf === true,
      maxCharsPerPart: options.maxCharsPerPart,
      signal: options.signal
    })

    if (result.ok) {
      entry.status = 'ready'
      entry.consent = result.preview.consent
      entry.consentNeeded = result.preview.consentNeeded
      entry.partCount = result.parts.length
      entry.totalChars = result.preview.totalChars
      entry.hasText = result.preview.hasText
      if (result.preview.pdf.state === 'available') entry.pdfPages = result.preview.pdf.pages
      prepared.push({
        filePath: entry.filePath,
        fileName: entry.fileName,
        order: entry.order,
        parts: result.parts,
        preview: result.preview,
        jobDir: result.jobDir,
        pdfPath: result.pdfPath,
        consent: result.preview.consent
      })
    } else {
      entry.status = result.reason === 'cancelled' ? 'cancelled' : 'refused'
      entry.reason = result.reason
      entry.message = result.message
    }
    options.onProgress?.(entry, index + 1, entries.length)
  }

  const report = summarizeSelection(entries, partition)
  const manifest = buildSelectionManifest(entries)
  return { report, prepared, manifest, cancelled }
}
