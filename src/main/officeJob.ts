import { attachChunksAsOneMessage } from './uploadManager'
import type { BundleChunk } from '../shared/folderUpload'
import type { OfficePreviewPayload } from '../shared/officePreview'
import type { OfficePreparedPart } from './officePrepare'

/**
 * Holds prepared Office material between "the user opened the dialog" and "the user pressed
 * Send" (plan 02, stage 3).
 *
 * Responsibilities, and the plan rules behind them:
 *  - the prepared parts live in memory; the only thing on disk is the optional PDF, in a
 *    per-job temp directory that is removed when the job is discarded, superseded, or times
 *    out — a cancelled dialog must not leave a converted document behind;
 *  - `attach` never sends. It hands the parts to the composer as one message and returns; the
 *    user still presses Send in the provider UI. There is no code path here that submits;
 *  - attaching is explicit: nothing is attached from `prepare`, so viewing a workbook in the
 *    dialog uploads nothing.
 */

export interface OfficeJob {
  jobId: string
  fileName: string
  parts: OfficePreparedPart[]
  preview: OfficePreviewPayload
  jobDir?: string
  pdfPath?: string
  createdAt: number
  completionTimer?: NodeJS.Timeout
}

export interface OfficeJobManagerOptions {
  cleanupFn?: (dir?: string) => void
  now?: () => number
  /** How long an unattached job may sit before it is dropped. */
  idleTtlMs?: number
  maxJobs?: number
  /** After a successful attach the PDF is kept briefly, then deleted. */
  postAttachGraceMs?: number
  /** Injectable for tests; defaults to the real composer injection. */
  attach?: typeof attachChunksAsOneMessage
}

export interface AttachPreparedOfficeOptions {
  jobId: string
  view: Parameters<typeof attachChunksAsOneMessage>[0]
  customSelector?: string
  /** Include the manifest part that describes what was extracted (default true). */
  includeManifest?: boolean
  /** The user-edited manifest text, sent verbatim when provided. */
  manifestText?: string
  /** Attach the rendered PDF as a native file. Off unless the user asked. */
  attachPdf?: boolean
}

export interface AttachPreparedOfficeResult {
  jobId: string
  success: boolean
  message: string
  attachedParts: number
  pdfAttached: boolean
  /** True when the parts reached the composer but Send was deliberately not pressed. */
  awaitingUserSend: boolean
}

const defaultCleanup = (dir?: string): void => {
  if (!dir) return
  void import('./officeConvert').then(({ cleanupConversionDir }) => cleanupConversionDir(dir))
}

let counter = 0

export class OfficeJobManager {
  private jobs = new Map<string, OfficeJob>()
  private cleanupFn: (dir?: string) => void
  private now: () => number
  private idleTtlMs: number
  private maxJobs: number
  private postAttachGraceMs: number
  private attach: typeof attachChunksAsOneMessage

  constructor(options: OfficeJobManagerOptions = {}) {
    this.cleanupFn = options.cleanupFn ?? defaultCleanup
    this.now = options.now ?? Date.now
    this.idleTtlMs = options.idleTtlMs ?? 30 * 60 * 1000
    this.maxJobs = options.maxJobs ?? 8
    this.postAttachGraceMs = options.postAttachGraceMs ?? 15_000
    this.attach = options.attach ?? attachChunksAsOneMessage
  }

  /** Register a prepared file and return its job id. Oldest job is evicted past the cap. */
  add(job: Omit<OfficeJob, 'jobId' | 'createdAt'>): string {
    this.evictOverflow()
    counter += 1
    const jobId = `office-${counter}-${Math.random().toString(36).slice(2, 8)}`
    this.jobs.set(jobId, { ...job, jobId, createdAt: this.now() })
    return jobId
  }

  get(jobId: string): OfficeJob | undefined {
    return this.jobs.get(jobId)
  }

  /** Full text of one part. The dialog shows excerpts; this is what "copy" fetches. */
  partText(
    jobId: string,
    index: number
  ): { ok: true; label: string; covers: string; content: string } | { ok: false; message: string } {
    const job = this.jobs.get(jobId)
    if (!job) return { ok: false, message: 'That prepared file is no longer available — prepare it again.' }
    const part = job.parts.find((entry) => entry.index === index)
    if (!part) return { ok: false, message: `There is no part ${index} in this file.` }
    return { ok: true, label: part.label, covers: part.covers, content: part.content }
  }

  /** Every part joined, for a plain "copy all" without a renderer round-trip per part. */
  allText(jobId: string): { ok: true; fileName: string; content: string } | { ok: false; message: string } {
    const job = this.jobs.get(jobId)
    if (!job) return { ok: false, message: 'That prepared file is no longer available — prepare it again.' }
    return {
      ok: true,
      fileName: job.fileName,
      content: job.parts.map((part) => part.content).join('\n\n')
    }
  }

  /**
   * Put the approved material in the composer as ONE message. Never sends, never submits,
   * never presses Enter — the return value says so explicitly.
   */
  async attachPreparedOffice(options: AttachPreparedOfficeOptions): Promise<AttachPreparedOfficeResult> {
    const job = this.jobs.get(options.jobId)
    if (!job) {
      return {
        jobId: options.jobId,
        success: false,
        message: 'That prepared file is no longer available — prepare it again.',
        attachedParts: 0,
        pdfAttached: false,
        awaitingUserSend: false
      }
    }

    const includeManifest = options.includeManifest !== false
    const manifest = includeManifest
      ? options.manifestText?.trim()
        ? options.manifestText
        : job.preview.manifest
      : ''
    const body = job.parts.map((part) => part.content).join('\n\n')
    if (!body.trim() && !manifest.trim()) {
      return {
        jobId: job.jobId,
        success: false,
        message: 'There is no text to attach from this file.',
        attachedParts: 0,
        pdfAttached: false,
        awaitingUserSend: false
      }
    }

    const content = manifest ? `${manifest}\n\n${body}` : body
    const chunk: BundleChunk = {
      index: 1,
      totalChunks: 1,
      byteSize: Buffer.byteLength(content, 'utf8'),
      fileCount: 1,
      files: [
        {
          relativePath: `${job.fileName}.extracted.txt`,
          size: Buffer.byteLength(content, 'utf8')
        }
      ],
      content
    }

    const pdfAttached = Boolean(options.attachPdf && job.pdfPath)
    const result = await this.attach(
      options.view,
      [chunk],
      `${job.fileName} (extracted)`,
      options.customSelector,
      pdfAttached && job.pdfPath ? [job.pdfPath] : undefined
    )

    if (result.success) this.schedulePostAttachCleanup(job.jobId)

    return {
      jobId: job.jobId,
      success: result.success,
      message: pdfAttached
        ? `${result.message} The PDF was attached too — whether the provider accepts PDFs is unverified.`
        : result.message,
      attachedParts: result.success ? job.parts.length : 0,
      pdfAttached: result.success && pdfAttached,
      awaitingUserSend: result.success
    }
  }

  /**
   * Attach several prepared files as ONE message: one part per file, indexed in the user's
   * selection order, plus the selection manifest. Used for folder drops and mixed selections,
   * where six separate attachments would be indistinguishable in the transcript.
   */
  async attachPreparedOfficeMany(options: {
    jobIds: string[]
    view: AttachPreparedOfficeOptions['view']
    customSelector?: string
    manifestText?: string
    attachPdf?: boolean
  }): Promise<AttachPreparedOfficeResult> {
    const jobs = options.jobIds
      .map((jobId) => this.jobs.get(jobId))
      .filter((job): job is OfficeJob => Boolean(job))
    const missing = options.jobIds.filter((jobId) => !this.jobs.has(jobId))

    if (jobs.length === 0) {
      return {
        jobId: options.jobIds[0] ?? '',
        success: false,
        message: 'Those prepared files are no longer available — prepare them again.',
        attachedParts: 0,
        pdfAttached: false,
        awaitingUserSend: false
      }
    }

    const manifest = options.manifestText?.trim() ?? ''
    const chunks: BundleChunk[] = jobs.map((job, index) => {
      const body = job.parts.map((part) => part.content).join('\n\n')
      const content = index === 0 && manifest ? `${manifest}\n\n${body}` : `${job.fileName}:\n\n${body}`
      return {
        index: index + 1,
        totalChunks: jobs.length,
        byteSize: Buffer.byteLength(content, 'utf8'),
        fileCount: 1,
        files: [
          {
            relativePath: `${job.fileName}.extracted.txt`,
            size: Buffer.byteLength(content, 'utf8')
          }
        ],
        content
      }
    })

    const pdfs = options.attachPdf ? jobs.map((job) => job.pdfPath).filter((p): p is string => Boolean(p)) : []
    const result = await this.attach(
      options.view,
      chunks,
      `${jobs.length} Office file(s) (extracted)`,
      options.customSelector,
      pdfs.length > 0 ? pdfs : undefined
    )

    if (result.success) {
      for (const job of jobs) this.schedulePostAttachCleanup(job.jobId)
    }

    const extra = missing.length > 0 ? ` ${missing.length} prepared file(s) were no longer available.` : ''
    return {
      jobId: jobs.map((job) => job.jobId).join(','),
      success: result.success,
      message: `${result.message}${extra}${pdfs.length > 0 ? ' PDFs were attached too — whether the provider accepts PDFs is unverified.' : ''}`,
      attachedParts: result.success ? jobs.reduce((sum, job) => sum + job.parts.length, 0) : 0,
      pdfAttached: result.success && pdfs.length > 0,
      awaitingUserSend: result.success
    }
  }

  /**
   * The provider reads the PDF asynchronously after dispatch, so the directory is kept for a
   * short grace period and then removed. The text is already in the composer by then.
   */
  private schedulePostAttachCleanup(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (!job) return
    if (job.completionTimer) clearTimeout(job.completionTimer)
    job.completionTimer = setTimeout(() => this.discard(jobId), this.postAttachGraceMs)
    job.completionTimer.unref?.()
  }

  /** Delete the job's temp directory now. Safe twice, safe on unknown ids. */
  discard(jobId: string): boolean {
    const job = this.jobs.get(jobId)
    if (!job) return false
    if (job.completionTimer) clearTimeout(job.completionTimer)
    this.cleanupFn(job.jobDir)
    this.jobs.delete(jobId)
    return true
  }

  discardAll(): string[] {
    const ids = [...this.jobs.keys()]
    for (const id of ids) this.discard(id)
    return ids
  }

  disposeAll(): void {
    this.discardAll()
  }

  /** Drop jobs the user never approved, so a forgotten dialog cannot pin disk or memory. */
  sweepIdle(): string[] {
    const removed: string[] = []
    const cutoff = this.now() - this.idleTtlMs
    for (const [jobId, job] of [...this.jobs]) {
      if (job.createdAt < cutoff) {
        this.discard(jobId)
        removed.push(jobId)
      }
    }
    return removed
  }

  private evictOverflow(): void {
    while (this.jobs.size >= this.maxJobs) {
      const oldest = this.jobs.keys().next().value
      if (!oldest) break
      this.discard(oldest)
    }
  }
}
