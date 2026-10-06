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

export interface FolderTreeNode {
  name: string
  fullPath: string
  depth: number
  files: ScannedFileInfo[]
  children: FolderTreeNode[]
  totalFiles: number
  totalBytes: number
  allDescendantPaths: string[]
}

/**
 * Builds a true recursive directory tree from scanned files,
 * computing nested children, depths, descendant paths, and cumulative statistics.
 */
export function buildFolderTree(files: ScannedFileInfo[]): FolderTreeNode {
  const root: FolderTreeNode = {
    name: 'root',
    fullPath: '',
    depth: 0,
    files: [],
    children: [],
    totalFiles: 0,
    totalBytes: 0,
    allDescendantPaths: []
  }

  const dirNodeMap = new Map<string, FolderTreeNode>()
  dirNodeMap.set('', root)

  const getOrCreateDirNode = (dirPath: string): FolderTreeNode => {
    if (dirNodeMap.has(dirPath)) {
      return dirNodeMap.get(dirPath)!
    }

    const segments = dirPath.split('/')
    let currentPath = ''
    let parentNode = root

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      currentPath = currentPath ? `${currentPath}/${seg}` : seg

      let node = dirNodeMap.get(currentPath)
      if (!node) {
        node = {
          name: seg,
          fullPath: currentPath,
          depth: i + 1,
          files: [],
          children: [],
          totalFiles: 0,
          totalBytes: 0,
          allDescendantPaths: []
        }
        parentNode.children.push(node)
        dirNodeMap.set(currentPath, node)
      }
      parentNode = node
    }

    return parentNode
  }

  for (const f of files) {
    const lastSlash = f.relativePath.lastIndexOf('/')
    const dirPath = lastSlash !== -1 ? f.relativePath.substring(0, lastSlash) : ''
    const targetNode = getOrCreateDirNode(dirPath)
    targetNode.files.push(f)
  }

  const postProcess = (node: FolderTreeNode): void => {
    node.children.sort((a, b) => a.name.localeCompare(b.name))
    node.files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))

    let totalFiles = node.files.length
    let totalBytes = node.files.reduce((acc, f) => acc + f.size, 0)
    const descendantPaths = node.files.map((f) => f.path)

    for (const child of node.children) {
      postProcess(child)
      totalFiles += child.totalFiles
      totalBytes += child.totalBytes
      descendantPaths.push(...child.allDescendantPaths)
    }

    node.totalFiles = totalFiles
    node.totalBytes = totalBytes
    node.allDescendantPaths = descendantPaths
  }

  postProcess(root)
  return root
}

/**
 * Determines whether a tree node's descendant files are all, partially, or none selected.
 */
export function getNodeSelectionState(
  node: FolderTreeNode,
  selectedPaths: Set<string>
): 'all' | 'some' | 'none' {
  if (node.allDescendantPaths.length === 0) return 'none'

  let count = 0
  for (const p of node.allDescendantPaths) {
    if (selectedPaths.has(p)) count++
  }

  if (count === node.allDescendantPaths.length) return 'all'
  if (count > 0) return 'some'
  return 'none'
}

/**
 * Toggles a tree node: if all descendant files are currently selected, deselects them all;
 * otherwise, selects all descendant files across all nested subfolders.
 */
export function toggleFolderNode(
  node: FolderTreeNode,
  currentSelected: Set<string>
): Set<string> {
  const next = new Set(currentSelected)
  const isAll = getNodeSelectionState(node, next) === 'all'

  if (isAll) {
    for (const p of node.allDescendantPaths) {
      next.delete(p)
    }
  } else {
    for (const p of node.allDescendantPaths) {
      next.add(p)
    }
  }

  return next
}

/**
 * Computes default collapsed directory paths for folders beyond the target depth (e.g. depth > 2).
 */
export function getDefaultCollapsedDirs(
  tree: FolderTreeNode,
  defaultMaxOpenDepth: number = 2
): Set<string> {
  const collapsed = new Set<string>()

  const traverse = (node: FolderTreeNode): void => {
    if (node.depth > defaultMaxOpenDepth && node.fullPath) {
      collapsed.add(node.fullPath)
    }
    for (const child of node.children) {
      traverse(child)
    }
  }

  traverse(tree)
  return collapsed
}

/**
 * Computes all ancestor directory paths containing matching search files so they can be expanded.
 */
export function getExpandedDirsForSearch(
  _tree: FolderTreeNode,
  matchingFiles: ScannedFileInfo[]
): Set<string> {
  const expanded = new Set<string>()

  for (const f of matchingFiles) {
    const parts = f.relativePath.split('/')
    let currentPath = ''
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i]
      expanded.add(currentPath)
    }
  }

  return expanded
}

/**
 * Retrieves all directory paths across the tree (excluding the root wrapper).
 */
export function getAllDirectoryPaths(tree: FolderTreeNode): Set<string> {
  const all = new Set<string>()

  const traverse = (node: FolderTreeNode): void => {
    if (node.fullPath) {
      all.add(node.fullPath)
    }
    for (const child of node.children) {
      traverse(child)
    }
  }

  traverse(tree)
  return all
}

