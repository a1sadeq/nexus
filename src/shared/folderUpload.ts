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
