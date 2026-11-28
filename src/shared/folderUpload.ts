import type { UploadFileKind } from './uploadFileKind'

export interface ScannedFileInfo {
  path: string
  relativePath: string
  size: number
  extension: string
  /** How this file will be delivered (text bundle vs original attachment). */
  kind?: UploadFileKind
  isSuggestedRemoval: boolean
  removalReason?: string
  variantOf?: string
  variantKind?: 'ai-companion' | 'backup' | 'copy'
  isPreferredVariant?: boolean
}

/**
 * A directory that was NOT scanned (version control, dependencies, build output).
 * Reported to the user instead of being silently dropped (plan 03).
 */
export interface SkippedDirectory {
  relativePath: string
  reason: string
}

export interface FolderScanResult {
  folderPath: string
  folderName: string
  totalFiles: number
  totalBytes: number
  files: ScannedFileInfo[]
  prunedDirs?: string[]
  /** Directories deliberately not scanned, with the reason shown in the UI. */
  skippedDirs?: SkippedDirectory[]
  isTruncated?: boolean
}

export interface ConfirmFolderUploadPayload {
  folderPath: string
  selectedPaths: string[]
  /**
   * How large each attached part may be, in bytes. Absent means "the app's default": the renderer sends
   * this from the upload popup's part-size control, which is the same value the Chunks & Parts drawer
   * shows, so the two can never disagree about what will be attached.
   */
  partSizeBytes?: number
}

/**
 * The part sizes the upload popup offers, in MB.
 *
 * A chat composer accepts a handful of attachments and each one has to arrive as a single file, so the
 * part size is a real constraint, not a preference: too big and the provider rejects the attachment, too
 * small and one folder arrives as thirty parts shuffled by a model that only reads the first. These are
 * the sizes that were actually asked for, and the list is closed so a typo cannot produce a 0 MB part.
 */
export const UPLOAD_PART_SIZE_MB = [5, 10, 15, 20, 25] as const

export type UploadPartSizeMb = (typeof UPLOAD_PART_SIZE_MB)[number]

/**
 * What the popup starts at when nothing has been remembered.
 *
 * 10 MB rather than the 8 MB the code used to hard-code: 8 was never offered to the user, and 10 is the
 * closest offered size that keeps a folder in fewer parts.
 */
export const DEFAULT_UPLOAD_PART_SIZE_MB: UploadPartSizeMb = 10

/**
 * Snap any value onto an offered size, in MB.
 *
 * Ties go to the larger size (a part too small is the failure the user actually sees), strings are
 * accepted because the remembered value comes back out of a string store, and anything that is not a
 * number at all falls back to the default — a corrupt remembered value must never produce a broken upload.
 */
export function normalisePartSizeMb(value: unknown): UploadPartSizeMb {
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : value
  if (typeof numeric !== 'number' || !Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_UPLOAD_PART_SIZE_MB
  }
  let best: UploadPartSizeMb = UPLOAD_PART_SIZE_MB[0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of UPLOAD_PART_SIZE_MB) {
    const distance = Math.abs(candidate - numeric)
    if (distance < bestDistance || (distance === bestDistance && candidate > best)) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

/** MB to the byte count the partitioner takes. */
export function partSizeBytes(mb: unknown): number {
  return Math.round(normalisePartSizeMb(mb) * 1024 * 1024)
}

/** The reverse, for a byte count that came from the main process. */
export function partSizeMb(bytes: unknown): UploadPartSizeMb {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) {
    return DEFAULT_UPLOAD_PART_SIZE_MB
  }
  return normalisePartSizeMb(bytes / (1024 * 1024))
}

/**
 * One spelling for every path the app shows or bundles.
 *
 * On Windows `path.relative()` answers `src\main\index.ts`, and everything downstream — the popup's
 * folder tree, the bundle headers, the search — splits on `/`. A folder uploaded from Windows therefore
 * arrived as one flat row of `folder\file.py folder\file2.py` instead of the folders that were picked,
 * which is exactly what was reported. The separator is normalised once, where the path is made.
 */
export function normaliseRelativePath(value: string): string {
  if (typeof value !== 'string') return ''
  let path = value.replace(/\\/g, '/')
  while (path.startsWith('./')) path = path.slice(2)
  path = path.replace(/\/{2,}/g, '/')
  if (path.startsWith('/')) path = path.replace(/^\/+/, '')
  return path
}

export interface BundlePreviewResult {
  text: string
  fileCount: number
  byteSize: number
  filesIncluded: string[]
  /** Files left out of the text bundle because they must be attached as originals. */
  omittedFromTextBundle?: string[]
}

export interface SaveBundleResult {
  success: boolean
  canceled?: boolean
  savedPath?: string
  error?: string
}

export interface ChunkFileItem {
  relativePath: string
  size: number
}

export interface OriginalAttachment {
  path: string
  relativePath: string
  size: number
  kind: UploadFileKind
}

export interface BundleChunk {
  index: number
  totalChunks: number
  byteSize: number
  fileCount: number
  files: ChunkFileItem[]
  content: string
}

export interface PartitionResult {
  chunks: BundleChunk[]
  /** Selected files delivered as originals instead of text parts. */
  originalAttachments?: OriginalAttachment[]
  totalBytes: number
  totalFiles: number
  originalBytes: number
  savedBytes: number
  reductionPercent: number
}

export interface AttachAllResult {
  success: boolean
  totalParts: number
  /** Attached parts confirmed in the composer, or null when the provider could not be read. */
  attachedParts: number | null
  verified?: boolean
  needsUserCheck?: boolean
  message: string
}

export interface UploadChunkProgress {
  currentChunk: number
  totalChunks: number
  byteSize: number
  status: 'uploading' | 'completed' | 'failed'
  message?: string
}
