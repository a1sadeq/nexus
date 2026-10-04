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
