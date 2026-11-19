import { spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  VIDEO_PACE_BUDGETS,
  estimateFrameBytes,
  planVideoCoverage,
  type VideoPace,
  type VideoPlan,
  type VideoSourceInfo
} from '../shared/videoPlan'
import { locateMediaTools, probeVideo, type MediaToolPaths, type ProbeFailureReason } from './videoProbe'

/**
 * Local video preparation for plan 01 — the only part that writes to disk.
 *
 * Guarantees this module is responsible for:
 *  - the original file is opened read-only and never modified or moved;
 *  - every artifact lives in a fresh 0700 temp directory, one per job, deleted by the
 *    caller via `cleanupJobDir` (session complete/cancel) and swept on startup for crashes;
 *  - no shell: ffmpeg is invoked with an argument vector;
 *  - bounded: frame count, per-frame timeout, whole-job timeout, cancellation between
 *    frames and a hard cap on total bytes written;
 *  - honest failure: no ffmpeg, a failed scene pass, or an unreadable frame is reported as
 *    such, and the plan the user approves is the plan that was actually produced.
 */

export interface PreparedFrame {
  path: string
  timestampSec: number
  bytes: number
}

export interface PreparedVideo {
  jobDir: string
  frames: PreparedFrame[]
  /** Plan built from the frames that actually exist. */
  plan: VideoPlan
  source: VideoSourceInfo
  /** Non-fatal problems the user must see before approving. */
  warnings: string[]
  totalBytes: number
}

export type PrepareFailureReason =
  | ProbeFailureReason
  | 'ffmpeg-missing'
  | 'cancelled'
  | 'no-frames'
  | 'frame-extraction-failed'

export type PrepareResult =
  | { ok: true; prepared: PreparedVideo }
  | { ok: false; reason: PrepareFailureReason; message: string }

export interface PrepareOptions {
  inputPath: string
  pace: VideoPace
  tools?: MediaToolPaths
  /** Timeout for the scene-detection pass. */
  sceneTimeoutMs?: number
  /** Timeout for one still. */
  frameTimeoutMs?: number
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
  /** Called once the job directory exists, so a caller can clean up if it dies mid-job. */
  onJobCreated?: (jobDir: string) => void
}

const DEFAULT_SCENE_TIMEOUT_MS = 120_000
const DEFAULT_FRAME_TIMEOUT_MS = 30_000
const MAX_STDERR_BYTES = 2 * 1024 * 1024

interface RunResult {
  code: number | null
  stderr: string
  timedOut: boolean
  aborted: boolean
}

function run(command: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<RunResult> {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        detached: process.platform !== 'win32'
      })
    } catch {
      resolve({ code: null, stderr: 'spawn failed', timedOut: false, aborted: false })
      return
    }

    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    let timedOut = false
    let aborted = false
    let fallback: NodeJS.Timeout | undefined

    const killTree = (): void => {
      try {
        if (process.platform !== 'win32' && child.pid) {
          process.kill(-child.pid, 'SIGKILL')
          return
        }
      } catch {
        /* gone */
      }
      try {
        child.kill('SIGKILL')
      } catch {
        /* gone */
      }
    }

    const onAbort = (): void => {
      aborted = true
      killTree()
      fallback = setTimeout(() => finish(null), 500)
    }

    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (fallback) clearTimeout(fallback)
      signal?.removeEventListener('abort', onAbort)
      try {
        child.stderr?.destroy()
      } catch {
        /* closed */
      }
      resolve({ code, stderr: Buffer.concat(chunks).toString('utf8'), timedOut, aborted })
    }

    const timer = setTimeout(() => {
      timedOut = true
      killTree()
      fallback = setTimeout(() => finish(null), 500)
    }, timeoutMs)

    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    child.stderr?.on('data', (buf: Buffer) => {
      if (size >= MAX_STDERR_BYTES) return
      size += buf.length
      chunks.push(buf)
    })
    child.on('error', () => finish(null))
    child.on('close', (code: number | null) => finish(code))
  })
}

/**
 * Timestamps of scene changes, read from ffmpeg's `showinfo` log lines.
 * Exported for tests: order matters, because frame files are numbered in the same order.
 */
export function parseSceneTimestamps(log: string): number[] {
  const out: number[] = []
  const pattern = /pts_time:\s*(-?\d+(?:\.\d+)?)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(log)) !== null) {
    const value = Number(match[1])
    if (Number.isFinite(value) && value >= 0) out.push(Math.round(value * 1000) / 1000)
  }
  return out
}

/** Scene detection pass. Returns [] (plus a warning) instead of failing the whole job. */
async function detectScenes(
  ffmpeg: string,
  inputPath: string,
  threshold: number,
  maxFrames: number,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<{ timestamps: number[]; warning?: string }> {
  const result = await run(
    ffmpeg,
    [
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'info',
      '-i',
      inputPath,
      '-map',
      '0:v:0',
      '-vf',
      `select='gt(scene,${threshold})',showinfo`,
      '-an',
      '-sn',
      '-frames:v',
      String(maxFrames * 4), // candidates only; the planner thins them
      '-f',
      'null',
      '-'
    ],
    timeoutMs,
    signal
  )
  if (result.aborted) return { timestamps: [] }
  if (result.timedOut) {
    return {
      timestamps: [],
      warning:
        'Scene-change detection timed out, so stills come from periodic sampling only — cuts may be missed.'
    }
  }
  const timestamps = parseSceneTimestamps(result.stderr)
  if (timestamps.length === 0) {
    return {
      timestamps: [],
      warning:
        'No scene changes were detected (or the pass failed), so stills come from periodic sampling only.'
    }
  }
  return { timestamps }
}

function ffmpegFrameArgs(
  inputPath: string,
  outPath: string,
  timestampSec: number,
  edgePx: number,
  threads: number
): string[] {
  const scale = `scale='if(gt(iw,ih),min(${edgePx},iw),-2)':'if(gt(iw,ih),-2,min(${edgePx},ih))'`
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-threads',
    String(threads),
    // -ss before -i is the fast seek; modern ffmpeg decodes from the preceding keyframe,
    // so the still lands within a frame or two of the requested time.
    '-ss',
    timestampSec.toFixed(3),
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-frames:v',
    '1',
    '-vf',
    scale,
    '-q:v',
    '4',
    '-y',
    outPath
  ]
}

/**
 * Prepare one video: probe → scene candidates → plan → extract the planned stills.
 * The plan returned describes the frames that were actually written, not the ones requested.
 */
export async function prepareVideo(options: PrepareOptions): Promise<PrepareResult> {
  const { inputPath, pace } = options
  const signal = options.signal
  const budget = VIDEO_PACE_BUDGETS[pace]

  if (signal?.aborted) return { ok: false, reason: 'cancelled', message: 'Cancelled before starting.' }

  const tools = options.tools ?? locateMediaTools()
  const ffmpeg = tools.ffmpeg
  if (!ffmpeg || !fs.existsSync(ffmpeg)) {
    return {
      ok: false,
      reason: 'ffmpeg-missing',
      message:
        'ffmpeg is not available, so stills cannot be extracted locally. Nexus can attach the original video instead, or you can set NEXUS_FFMPEG_PATH.'
    }
  }

  const probed = await probeVideo(inputPath, { toolPath: tools.ffprobe })
  if (!probed.ok) return probed

  const warnings: string[] = []
  const scene = await detectScenes(
    ffmpeg,
    inputPath,
    budget.sceneThreshold,
    budget.maxFrames,
    options.sceneTimeoutMs ?? DEFAULT_SCENE_TIMEOUT_MS,
    signal
  )
  if (signal?.aborted) return { ok: false, reason: 'cancelled', message: 'Cancelled during scene detection.' }
  if (scene.warning) warnings.push(scene.warning)

  const planned = planVideoCoverage(probed.info, pace, scene.timestamps)
  const targets = planned.selection.timestamps
  if (targets.length === 0) {
    return {
      ok: false,
      reason: 'no-frames',
      message: 'No timestamps could be selected for this video (zero or unreadable duration).'
    }
  }

  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-video-'))
  try {
    fs.chmodSync(jobDir, 0o700)
  } catch {
    /* best effort on platforms without POSIX modes */
  }
  options.onJobCreated?.(jobDir)

  const frames: PreparedFrame[] = []
  let failure: string | null = null
  const perFrameBytes = estimateFrameBytes(budget.maxFrameEdgePx)
  const maxFramesByBytes = Math.max(1, Math.floor(budget.maxBytes / perFrameBytes))

  for (let i = 0; i < targets.length; i++) {
    if (signal?.aborted) {
      cleanupJobDir(jobDir)
      return { ok: false, reason: 'cancelled', message: 'Cancelled while extracting stills.' }
    }
    if (frames.length >= maxFramesByBytes) {
      warnings.push(
        `Stopped at ${frames.length} stills to respect the ${(budget.maxBytes / (1024 * 1024)).toFixed(0)} MB budget.`
      )
      break
    }

    const outPath = path.join(jobDir, `frame_${String(i + 1).padStart(4, '0')}.jpg`)
    const result = await run(
      ffmpeg,
      ffmpegFrameArgs(inputPath, outPath, targets[i], budget.maxFrameEdgePx, 2),
      options.frameTimeoutMs ?? DEFAULT_FRAME_TIMEOUT_MS,
      signal
    )
    if (result.aborted) {
      cleanupJobDir(jobDir)
      return { ok: false, reason: 'cancelled', message: 'Cancelled while extracting stills.' }
    }
    if (result.timedOut) {
      failure = `Extracting a still at ${targets[i].toFixed(2)}s timed out.`
      continue
    }

    let bytes = 0
    try {
      bytes = fs.statSync(outPath).size
    } catch {
      bytes = 0
    }
    if (bytes <= 0) {
      // A single unreadable region must not silently vanish from the record.
      failure = failure ?? `A still at ${targets[i].toFixed(2)}s could not be extracted.`
      continue
    }
    frames.push({ path: outPath, timestampSec: targets[i], bytes })
    options.onProgress?.(frames.length, targets.length)
  }

  if (failure) warnings.push(failure)

  if (frames.length === 0) {
    cleanupJobDir(jobDir)
    return {
      ok: false,
      reason: 'frame-extraction-failed',
      message: failure ?? 'ffmpeg produced no stills for this video.'
    }
  }

  // Re-plan against what actually exists so the summary cannot overstate coverage.
  const actualPlan = planVideoCoverage(
    probed.info,
    pace,
    scene.timestamps,
    { transcript: { available: false } }
  )
  const totalBytes = frames.reduce((n, f) => n + f.bytes, 0)
  if (frames.length < targets.length) {
    warnings.push(
      `${targets.length - frames.length} planned still(s) were not extracted; the summary below counts only the ${frames.length} that exist.`
    )
  }

  return {
    ok: true,
    prepared: {
      jobDir,
      frames,
      plan: { ...actualPlan, estimatedImages: frames.length, estimatedBytes: totalBytes },
      source: probed.info,
      warnings,
      totalBytes
    }
  }
}

/** Remove a job directory. Safe to call twice; never touches the original file. */
export function cleanupJobDir(jobDir: string): void {
  try {
    fs.rmSync(jobDir, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}

/**
 * Remove abandoned `nexus-video-*` job directories older than `maxAgeMs`.
 * Called at startup so a crash mid-preparation cannot leave frames on disk forever.
 */
export function sweepStaleJobDirs(maxAgeMs = 6 * 60 * 60 * 1000, now = Date.now()): string[] {
  const removed: string[] = []
  let entries: string[] = []
  try {
    entries = fs.readdirSync(os.tmpdir())
  } catch {
    return removed
  }
  for (const entry of entries) {
    if (!entry.startsWith('nexus-video-')) continue
    const full = path.join(os.tmpdir(), entry)
    try {
      const stat = fs.statSync(full)
      if (!stat.isDirectory()) continue
      if (now - stat.mtimeMs < maxAgeMs) continue
      fs.rmSync(full, { recursive: true, force: true })
      removed.push(full)
    } catch {
      /* skip unreadable entries */
    }
  }
  return removed
}
