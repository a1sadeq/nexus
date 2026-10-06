export interface ScannedFileInfo {
  path: string
  relativePath: string
  size: number
  extension: string
  isSuggestedRemoval: boolean
  removalReason?: string
}

export interface FolderScanResult {
  folderPath: string
  folderName: string
  totalFiles: number
  totalBytes: number
  files: ScannedFileInfo[]
  prunedDirs?: string[]
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
  totalBytes: number
  totalFiles: number
  originalBytes: number
  savedBytes: number
  reductionPercent: number
}

export interface UploadChunkProgress {
  currentChunk: number
  totalChunks: number
  byteSize: number
  status: 'uploading' | 'completed' | 'failed'
  message?: string
}

