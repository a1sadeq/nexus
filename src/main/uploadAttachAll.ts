import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { BundleChunk } from '../shared/folderUpload'

/**
 * Multi-part attachment support.
 *
 * Nexus previously refused to dispatch more than one bundle part and told the user to
 * attach parts manually. These helpers build every part up-front so a whole selection can
 * be attached to a single composer message with one injection, and so the outcome can be
 * described honestly (attached / unverified) instead of silently assumed.
 */

export interface PartFilePlan {
  index: number
  totalChunks: number
  fileName: string
  content: string
  byteSize: number
}

const TEMP_PREFIX = 'nexus-upload-'
const DEFAULT_RETENTION_MS = 10 * 60 * 1000 // Providers may read the file after the drop settles.

/** Sanitizes a folder name for use inside a temp file name. */
export function safeFolderSlug(folderName: string): string {
  const slug = (folderName || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug || 'bundle'
}

/**
 * Builds the ordered list of part files for a selection. Naming is deterministic so the
 * composer shows readable, ordered part labels (repo_part1_of_3_codebase.txt, ...).
 */
export function buildPartFilePlan(folderName: string, chunks: BundleChunk[]): PartFilePlan[] {
  const slug = safeFolderSlug(folderName)
  const total = chunks.length
  return chunks.map((chunk, i) => {
    const index = Number.isFinite(chunk.index) && chunk.index > 0 ? chunk.index : i + 1
    const totalChunks = Number.isFinite(chunk.totalChunks) && chunk.totalChunks > 0 ? chunk.totalChunks : total
    return {
      index,
      totalChunks,
      fileName: `${slug}_part${index}_of_${totalChunks}_codebase.txt`,
      content: chunk.content,
      byteSize: Buffer.byteLength(chunk.content || '', 'utf8')
    }
  })
}

/** Creates a private (0700) temp directory to hold outgoing part files. */
export function createUploadTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX))
}

/** Writes one part file into `dir` with owner-only permissions. */
export function writePartFile(dir: string, part: PartFilePlan): string {
  const target = path.join(dir, part.fileName)
  fs.writeFileSync(target, part.content, { encoding: 'utf-8', mode: 0o600 })
  return target
}

const pendingCleanups = new Map<string, NodeJS.Timeout>()

/**
 * Schedules deletion of a temp directory after a retention window. Files are never removed
 * while the drop is still settling: an early delete can break the provider reading them.
 */
export function scheduleUploadTempCleanup(dir: string, retentionMs = DEFAULT_RETENTION_MS): void {
  const existing = pendingCleanups.get(dir)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    pendingCleanups.delete(dir)
    removeUploadTempDir(dir)
  }, Math.max(0, retentionMs))
  if (typeof timer.unref === 'function') timer.unref()
  pendingCleanups.set(dir, timer)
}

function removeUploadTempDir(dir: string): void {
  try {
    if (path.basename(dir).startsWith(TEMP_PREFIX)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  } catch {
    // Leftover temp files are swept on the next launch instead.
  }
}

/**
 * Deletes stale `nexus-upload-*` directories from previous runs. Bundled source code should
 * not sit in the OS temp folder indefinitely.
 */
export function cleanupStaleUploadTempDirs(maxAgeMs = 60 * 60 * 1000, now = Date.now()): number {
  let removed = 0
  let entries: string[]
  try {
    entries = fs.readdirSync(os.tmpdir())
  } catch {
    return 0
  }
  for (const entry of entries) {
    if (!entry.startsWith(TEMP_PREFIX)) continue
    const full = path.join(os.tmpdir(), entry)
    try {
      const stat = fs.statSync(full)
      if (!stat.isDirectory()) continue
      if (now - stat.mtimeMs < maxAgeMs) continue
      removeUploadTempDir(full)
      removed++
    } catch {
      // Ignore entries that vanish mid-sweep.
    }
  }
  return removed
}

/** Removes every temp directory this process still owns (called on quit). */
export function cleanupAllUploadTempDirs(): void {
  for (const timer of pendingCleanups.values()) clearTimeout(timer)
  pendingCleanups.clear()
  cleanupStaleUploadTempDirs(0)
}

/**
 * Runs inside the provider webview. Counts attachment chips/elements in the composer.
 * Returns `null` when nothing recognisable is present, so callers can distinguish
 * "no attachments" from "cannot tell" instead of inventing a number.
 */
export const ATTACHMENT_PROBE_SCRIPT = `(() => {
  try {
    const selectors = [
      '[data-testid*="attachment"]',
      '[data-testid*="file-chip"]',
      '[class*="attachment-chip"]',
      '[class*="file-chip"]',
      '[class*="fileChip"]',
      '[class*="attachment-pill"]',
      '[class*="uploaded-file"]',
      'file-chip',
      '[aria-label*="Remove file"]',
      '[aria-label*="remove attachment"]',
      '[title^="Remove"]'
    ];
    const seen = new Set();
    for (const sel of selectors) {
      let nodes;
      try { nodes = document.querySelectorAll(sel); } catch { continue; }
      for (const n of nodes) {
        if (n instanceof Element) seen.add(n);
      }
    }
    // Ignore empty containers so a wrapper element is not counted as a file.
    const files = [...seen].filter((el) => (el.textContent || '').trim().length > 0 || el.querySelector('img,svg'));
    return { ok: true, count: files.length };
  } catch (e) {
    return { ok: false, count: null };
  }
})()`

/** Narrows the webview probe reply. Returns null when the count could not be read. */
export function parseAttachmentProbeResult(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const reply = value as { ok?: unknown; count?: unknown }
  if (reply.ok === false) return null
  if (typeof reply.count !== 'number' || !Number.isFinite(reply.count) || reply.count < 0) return null
  return Math.floor(reply.count)
}

export interface AttachOutcome {
  requested: number
  /** Verified number of attached parts, or null when the provider could not be read. */
  attached: number | null
  verified: boolean
  message: string
  /** True when the dispatch worked but the composer does not show every part. */
  needsUserCheck: boolean
}

/**
 * Turns a before/after attachment count into a user-facing message. Never claims success
 * that was not observed, and never blocks the upload.
 */
export function describeAttachOutcome(
  requested: number,
  before: number | null,
  after: number | null,
  unit: 'part' | 'file' = 'part'
): AttachOutcome {
  const parts = Math.max(1, requested)
  const noun = unit === 'file' ? (parts === 1 ? 'file' : 'files') : parts === 1 ? 'part' : 'parts'
  if (before === null || after === null) {
    return {
      requested: parts,
      attached: null,
      verified: false,
      needsUserCheck: true,
      message:
        parts === 1
          ? 'Attachment sent to the composer. Check it is listed before pressing Send.'
          : `All ${parts} ${noun} sent to the composer. Check they are listed before pressing Send.`
    }
  }
  const delta = Math.max(0, after - before)
  const attached = Math.min(parts, delta)
  if (attached >= parts) {
    return {
      requested: parts,
      attached,
      verified: true,
      needsUserCheck: false,
      message:
        parts === 1
          ? `${unit === 'file' ? 'File' : 'Part'} 1 attached. Review and press Send.`
          : `All ${parts} ${noun} attached. Review and press Send.`
    }
  }
  if (attached === 0) {
    return {
      requested: parts,
      attached,
      verified: true,
      needsUserCheck: true,
      message:
        parts === 1
          ? 'Nothing was attached. Retry, or use Download to attach it manually.'
          : `None of the ${parts} ${noun} appear in the composer. Retry, or use Download per part.`
    }
  }
  return {
    requested: parts,
    attached,
    verified: true,
    needsUserCheck: true,
    message: `Only ${attached} of ${parts} ${noun} are attached. Add the rest before pressing Send.`
  }
}

/** Provider-agnostic guard: some providers cap attachments per message. */
export const ATTACHMENT_COUNT_WARNING_THRESHOLD = 10

export function attachCountWarning(partCount: number): string | null {
  if (partCount <= ATTACHMENT_COUNT_WARNING_THRESHOLD) return null
  return `${partCount} parts attached; some providers cap attachments per message. Check the composer.`
}
