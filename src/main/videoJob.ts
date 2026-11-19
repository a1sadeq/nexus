import * as fs from 'fs'
import * as path from 'path'
import type { BundleChunk } from '../shared/folderUpload'
import {
  assessVideoCapability,
  type CapabilityObservation,
  type CapabilityVerdict
} from '../shared/videoCapability'
import { buildVideoManifest, type ManifestPart } from '../shared/videoManifest'
import type { VideoPace, VideoPlan, VideoSourceInfo } from '../shared/videoPlan'
import { cleanupJobDir, prepareVideo, type PreparedVideo } from './videoPrepare'
import { attachChunksAsOneMessage } from './uploadManager'
import type { AttachAllResult } from '../shared/folderUpload'

/**
 * Video preparation jobs (plan 01, stage 2).
 *
 * A job is the unit the user approves: it owns a temp directory, a plan that was actually
 * produced, and a provider capability verdict. Nothing is attached without an explicit
 * `attachPreparedVideo` call, and nothing is uploaded by attaching — the user still presses
 * Send in the provider UI.
 *
 * Temp-directory lifetime: the frames must exist while the provider's file input reads
 * them, which happens asynchronously *after* we dispatch. So a successful attach schedules
 * cleanup after a grace period instead of deleting immediately, and `discard` can be called
 * at any time (cancel, tab closed, user said no).
 */

export interface VideoJobSummary {
  jobId: string
  fileName: string
  source: VideoSourceInfo
  pace: VideoPace
  frameCount: number
  totalBytes: number
  coverageSummary: string
  limitations: string[]
  warnings: string[]
  /** What we can honestly say about this provider accepting the material. */
  capability: CapabilityVerdict
  /** Exactly what will be attached if the user approves — editable before sending. */
  manifest: string
}

export type PrepareJobResult =
  | { ok: true; summary: VideoJobSummary }
  | { ok: false; reason: string; message: string }

export interface PrepareJobInput {
  filePath: string
  pace: VideoPace
  /** Provider/model identity the material is aimed at; drives the capability verdict. */
  provider?: string
  model?: string
  /** Observations come from the caller's store so this module owns no persistence. */
  observations?: CapabilityObservation[]
  userNote?: string
  signal?: AbortSignal
}

interface StoredJob {
  jobId: string
  fileName: string
  prepared: PreparedVideo
  pace: VideoPace
  summaryBase: Omit<VideoJobSummary, 'capability' | 'manifest'>
  completionTimer?: NodeJS.Timeout
}

export interface VideoJobManagerOptions {
  prepare?: typeof prepareVideo
  cleanup?: (jobDir: string) => void
  now?: () => number
  /** How long a job may sit unattended before it is swept. */
  idleTtlMs?: number
  /** How long prepared frames survive after a successful attach. */
  postAttachGraceMs?: number
  /** Concurrent jobs allowed (each one holds disk). */
  maxJobs?: number
}

const DEFAULT_IDLE_TTL_MS = 30 * 60 * 1000
const DEFAULT_POST_ATTACH_GRACE_MS = 5 * 60 * 1000
const DEFAULT_MAX_JOBS = 2

let jobCounter = 0

const makeJobId = (now: number): string => {
  jobCounter += 1
  return `vid-${now.toString(36)}-${jobCounter.toString(36)}`
}

const mb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

export class VideoJobManager {
  private jobs = new Map<string, StoredJob>()
  private readonly prepareFn: typeof prepareVideo
  private readonly cleanupFn: (jobDir: string) => void
  private readonly now: () => number
  private readonly idleTtlMs: number
  private readonly postAttachGraceMs: number
  private readonly maxJobs: number

  constructor(options: VideoJobManagerOptions = {}) {
    this.prepareFn = options.prepare ?? prepareVideo
    this.cleanupFn = options.cleanup ?? cleanupJobDir
    this.now = options.now ?? Date.now
    this.idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS
    this.postAttachGraceMs = options.postAttachGraceMs ?? DEFAULT_POST_ATTACH_GRACE_MS
    this.maxJobs = options.maxJobs ?? DEFAULT_MAX_JOBS
  }

  /** Number of live jobs (frames on disk). */
  get activeCount(): number {
    return this.jobs.size
  }

  async prepareJob(input: PrepareJobInput): Promise<PrepareJobResult> {
    if (!input.filePath || !fs.existsSync(input.filePath)) {
      return { ok: false, reason: 'file-missing', message: 'That video file no longer exists.' }
    }
    this.evictOverflow()

    const prepared = await this.prepareFn({
      inputPath: input.filePath,
      pace: input.pace,
      signal: input.signal
    })
    if (!prepared.ok) {
      return { ok: false, reason: prepared.reason, message: prepared.message }
    }

    const jobId = makeJobId(this.now())
    const fileName = path.basename(input.filePath)
    const { plan, source, frames, warnings, totalBytes } = prepared.prepared

    const summaryBase: Omit<VideoJobSummary, 'capability' | 'manifest'> = {
      jobId,
      fileName,
      source,
      pace: input.pace,
      frameCount: frames.length,
      totalBytes,
      coverageSummary: plan.coverageSummary,
      limitations: plan.limitations,
      warnings
    }

    this.jobs.set(jobId, {
      jobId,
      fileName,
      prepared: prepared.prepared,
      pace: input.pace,
      summaryBase
    })

    return {
      ok: true,
      summary: {
        ...summaryBase,
        capability: this.assess(input),
        manifest: this.buildManifest(jobId, input.userNote)
      }
    }
  }

  /** Recompute the capability verdict (e.g. after the user records new evidence). */
  capabilityFor(
    jobId: string,
    input: { provider?: string; model?: string; observations?: CapabilityObservation[] }
  ): CapabilityVerdict | null {
    if (!this.jobs.has(jobId)) return null
    return this.assess(input)
  }

  private assess(input: {
    provider?: string
    model?: string
    observations?: CapabilityObservation[]
  }): CapabilityVerdict {
    return assessVideoCapability(
      {
        provider: input.provider ?? 'unknown-provider',
        model: input.model,
        kind: 'video',
        now: new Date(this.now())
      },
      input.observations ?? []
    )
  }

  get(jobId: string): StoredJob | null {
    return this.jobs.get(jobId) ?? null
  }

  /** Ordered stills that will be attached, for the manifest and for delivery. */
  framePaths(jobId: string): string[] {
    const job = this.jobs.get(jobId)
    return job ? job.prepared.frames.map((f) => f.path) : []
  }

  buildManifest(jobId: string, userNote?: string): string {
    const job = this.jobs.get(jobId)
    if (!job) return ''
    const plan = job.prepared.plan
    const parts: ManifestPart[] = [
      {
        index: 1,
        description: `manifest (this text)`
      },
      {
        index: 2,
        description: `${job.prepared.frames.length} still image(s), ordered by timestamp`
      }
    ]
    return buildVideoManifest({
      fileName: job.fileName,
      source: job.prepared.source,
      plan: {
        ...plan,
        // The manifest is generated from the frames that exist, so the numbers cannot drift.
        estimatedImages: job.prepared.frames.length
      } as VideoPlan,
      parts,
      transcript: null,
      ocr: null,
      userNote
    })
  }

  /**
   * Attach the approved material: manifest as a text part, stills as original files, in one
   * injection. Never sends anything — the user still presses Send in the provider UI.
   */
  async attachPreparedVideo(options: {
    jobId: string
    view: Parameters<typeof attachChunksAsOneMessage>[0]
    customSelector?: string
    userNote?: string
    includeManifest?: boolean
    /** The user-edited manifest. Sent verbatim when provided. */
    manifestText?: string
  }): Promise<AttachAllResult & { jobId: string }> {
    const job = this.jobs.get(options.jobId)
    if (!job) {
      return {
        jobId: options.jobId,
        success: false,
        totalParts: 0,
        attachedParts: null,
        message: 'That prepared video is no longer available — prepare it again.'
      }
    }

    const includeManifest = options.includeManifest !== false
    const manifest = includeManifest
      ? (options.manifestText?.trim() ? options.manifestText : this.buildManifest(job.jobId, options.userNote))
      : ''
    const chunks: BundleChunk[] = manifest
      ? [
          {
            index: 1,
            totalChunks: 1,
            byteSize: Buffer.byteLength(manifest, 'utf8'),
            fileCount: 1,
            files: [{ relativePath: `${job.fileName}.manifest.txt`, size: Buffer.byteLength(manifest, 'utf8') }],
            content: manifest
          }
        ]
      : []

    const frames = this.framePaths(job.jobId)
    if (frames.length === 0 && chunks.length === 0) {
      return {
        jobId: job.jobId,
        success: false,
        totalParts: 0,
        attachedParts: null,
        message: 'This job has no stills and no manifest to attach.'
      }
    }

    const result = await attachChunksAsOneMessage(
      options.view,
      chunks,
      `${job.fileName} (prepared)`,
      options.customSelector,
      frames
    )

    if (result.success) this.schedulePostAttachCleanup(job.jobId)
    return { ...result, jobId: job.jobId }
  }

  /**
   * The provider's file input reads the frames asynchronously after dispatch, so the
   * directory is kept for a grace period and then removed. `discard` shortens that.
   */
  private schedulePostAttachCleanup(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (!job) return
    if (job.completionTimer) clearTimeout(job.completionTimer)
    job.completionTimer = setTimeout(() => {
      this.discard(jobId)
    }, this.postAttachGraceMs)
    // Never keep the process alive just to clean a temp dir.
    job.completionTimer.unref?.()
  }

  /** Delete the job's frames now. Safe to call twice, and safe on unknown ids. */
  discard(jobId: string): boolean {
    const job = this.jobs.get(jobId)
    if (!job) return false
    if (job.completionTimer) clearTimeout(job.completionTimer)
    this.cleanupFn(job.prepared.jobDir)
    this.jobs.delete(jobId)
    return true
  }

  /** Cancel on user request: kills any in-flight preparation and drops all jobs. */
  disposeAll(): void {
    for (const jobId of [...this.jobs.keys()]) this.discard(jobId)
  }

  /** Sweep jobs that were never approved, so a forgotten dialog cannot pin disk. */
  sweepIdle(): string[] {
    const removed: string[] = []
    const cutoff = this.now() - this.idleTtlMs
    for (const [jobId, job] of [...this.jobs]) {
      // createdAt is encoded in the id, so no extra bookkeeping is needed
      const stamp = Number.parseInt(job.jobId.split('-')[1] ?? '', 36)
      if (Number.isFinite(stamp) && stamp < cutoff) {
        this.discard(jobId)
        removed.push(jobId)
      }
    }
    return removed
  }

  private evictOverflow(): void {
    while (this.jobs.size >= this.maxJobs) {
      const oldest = [...this.jobs.keys()][0]
      if (!oldest) break
      this.discard(oldest)
    }
  }
}

/** One-line summary for a toast/log: what the user is about to hand over. */
export function describeVideoJob(summary: VideoJobSummary): string {
  const cap =
    summary.capability.status === 'supported'
      ? 'native upload verified'
      : summary.capability.status === 'unsupported'
        ? 'native upload rejected — prepared route'
        : 'native upload unverified'
  return `${summary.fileName}: ${summary.frameCount} still(s), ${mb(summary.totalBytes)}, ${summary.pace} · ${cap}`
}
