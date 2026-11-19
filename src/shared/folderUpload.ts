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

