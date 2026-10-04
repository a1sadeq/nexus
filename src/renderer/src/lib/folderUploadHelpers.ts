import type { ScannedFileInfo } from '../../../shared/folderUpload'

export interface DirectoryGroup {
  dirKey: string
  displayPath: string
  files: ScannedFileInfo[]
  totalBytes: number
}

/**
 * Groups a list of scanned files by their relative directory path.
 * Root-level files (no slash in relativePath) are grouped under dirKey="" with displayPath="Root (/)".
 * Subdirectory files are grouped under their directory path ending with "/".
 * Root group is sorted first, followed by alphabetical order of directory keys.
 */
export function groupFilesByDirectory(files: ScannedFileInfo[]): DirectoryGroup[] {
  const map = new Map<string, { displayPath: string; files: ScannedFileInfo[]; totalBytes: number }>()

  for (const f of files) {
    let dirKey = ''
    let displayPath = 'Root (/)'
    const lastSlash = f.relativePath.lastIndexOf('/')
    if (lastSlash !== -1) {
      dirKey = f.relativePath.substring(0, lastSlash)
      displayPath = dirKey + '/'
    }
    const existing = map.get(dirKey) || { displayPath, files: [], totalBytes: 0 }
    existing.files.push(f)
    existing.totalBytes += f.size
    map.set(dirKey, existing)
  }

  return Array.from(map.entries())
    .map(([dirKey, val]) => ({
      dirKey,
      displayPath: val.displayPath,
      files: val.files,
      totalBytes: val.totalBytes
    }))
    .sort((a, b) => {
      if (a.dirKey === '') return -1
      if (b.dirKey === '') return 1
      return a.dirKey.localeCompare(b.dirKey)
    })
}

/**
 * Selects only matching files, adding them to current selection without altering others.
 */
export function selectMatchingFiles(
  currentSelected: Set<string>,
  matchingFiles: ScannedFileInfo[]
): Set<string> {
  const next = new Set(currentSelected)
  for (const f of matchingFiles) {
    next.add(f.path)
  }
  return next
}

/**
 * Deselects only matching files, removing them from current selection without altering others.
 */
export function deselectMatchingFiles(
  currentSelected: Set<string>,
  matchingFiles: ScannedFileInfo[]
): Set<string> {
  const next = new Set(currentSelected)
  for (const f of matchingFiles) {
    next.delete(f.path)
  }
  return next
}

/**
 * Determines whether a directory's files are all, partially, or none selected.
 */
export function getDirectorySelectionState(
  currentSelected: Set<string>,
  dirFiles: ScannedFileInfo[]
): 'all' | 'some' | 'none' {
  if (dirFiles.length === 0) return 'none'
  let count = 0
  for (const f of dirFiles) {
    if (currentSelected.has(f.path)) {
      count++
    }
  }
  if (count === dirFiles.length) return 'all'
  if (count > 0) return 'some'
  return 'none'
}

/**
 * Toggles a directory: if all files are currently selected, deselects them all;
 * otherwise, selects all files in the directory.
 */
export function toggleDirectorySelection(
  currentSelected: Set<string>,
  dirFiles: ScannedFileInfo[]
): Set<string> {
  const next = new Set(currentSelected)
  const isAll = dirFiles.every((f) => next.has(f.path))
  if (isAll) {
    for (const f of dirFiles) {
      next.delete(f.path)
    }
  } else {
    for (const f of dirFiles) {
      next.add(f.path)
    }
  }
  return next
}
