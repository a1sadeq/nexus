import { describe, it, expect } from 'vitest'
import {
  groupFilesByDirectory,
  selectMatchingFiles,
  deselectMatchingFiles,
  getDirectorySelectionState,
  toggleDirectorySelection,
  buildFolderTree,
  getNodeSelectionState,
  toggleFolderNode,
  getDefaultCollapsedDirs,
  getExpandedDirsForSearch,
  getAllDirectoryPaths
} from './folderUploadHelpers'
import type { ScannedFileInfo } from '../../../shared/folderUpload'

const sampleFiles: ScannedFileInfo[] = [
  { path: '/project/package.json', relativePath: 'package.json', size: 500, extension: '.json', isSuggestedRemoval: false },
  { path: '/project/README.md', relativePath: 'README.md', size: 1200, extension: '.md', isSuggestedRemoval: false },
  { path: '/project/src/index.ts', relativePath: 'src/index.ts', size: 800, extension: '.ts', isSuggestedRemoval: false },
  { path: '/project/src/renderer/App.tsx', relativePath: 'src/renderer/App.tsx', size: 2500, extension: '.tsx', isSuggestedRemoval: false },
  { path: '/project/src/renderer/App.test.tsx', relativePath: 'src/renderer/App.test.tsx', size: 1500, extension: '.tsx', isSuggestedRemoval: false },
  { path: '/project/docs/guide.md', relativePath: 'docs/guide.md', size: 3000, extension: '.md', isSuggestedRemoval: false }
]

describe('folderUploadHelpers', () => {
  describe('groupFilesByDirectory', () => {
    it('groups root files under Root (/) and subdirectories under their respective paths', () => {
      const groups = groupFilesByDirectory(sampleFiles)

      expect(groups.length).toBe(4)

      // Root is always first
      expect(groups[0].dirKey).toBe('')
      expect(groups[0].displayPath).toBe('Root (/)')
      expect(groups[0].files.map((f) => f.relativePath)).toEqual(['package.json', 'README.md'])
      expect(groups[0].totalBytes).toBe(1700)

      // Other directories sorted alphabetically
      expect(groups[1].dirKey).toBe('docs')
      expect(groups[1].displayPath).toBe('docs/')
      expect(groups[1].files.map((f) => f.relativePath)).toEqual(['docs/guide.md'])

      expect(groups[2].dirKey).toBe('src')
      expect(groups[2].displayPath).toBe('src/')

      expect(groups[3].dirKey).toBe('src/renderer')
      expect(groups[3].displayPath).toBe('src/renderer/')
      expect(groups[3].files.length).toBe(2)
    })
  })

  describe('selectMatchingFiles and deselectMatchingFiles', () => {
    it('adds only matching files without dropping existing non-matching selections', () => {
      const initial = new Set(['/project/package.json'])
      const matching = [sampleFiles[2], sampleFiles[3]] // src/index.ts, src/renderer/App.tsx

      const next = selectMatchingFiles(initial, matching)
      expect(next.has('/project/package.json')).toBe(true)
      expect(next.has('/project/src/index.ts')).toBe(true)
      expect(next.has('/project/src/renderer/App.tsx')).toBe(true)
      expect(next.size).toBe(3)
    })

    it('removes only matching files while keeping non-matching selections untouched', () => {
      const initial = new Set([
        '/project/package.json',
        '/project/src/index.ts',
        '/project/src/renderer/App.tsx'
      ])
      const matching = [sampleFiles[2]] // src/index.ts

      const next = deselectMatchingFiles(initial, matching)
      expect(next.has('/project/package.json')).toBe(true)
      expect(next.has('/project/src/renderer/App.tsx')).toBe(true)
      expect(next.has('/project/src/index.ts')).toBe(false)
      expect(next.size).toBe(2)
    })
  })

  describe('getDirectorySelectionState and toggleDirectorySelection', () => {
    const dirFiles = [sampleFiles[3], sampleFiles[4]] // App.tsx and App.test.tsx

    it('returns "none" when no files in directory are selected', () => {
      const selected = new Set<string>()
      expect(getDirectorySelectionState(selected, dirFiles)).toBe('none')
    })

    it('returns "some" when partially selected', () => {
      const selected = new Set([dirFiles[0].path])
      expect(getDirectorySelectionState(selected, dirFiles)).toBe('some')
    })

    it('returns "all" when all files in directory are selected', () => {
      const selected = new Set([dirFiles[0].path, dirFiles[1].path])
      expect(getDirectorySelectionState(selected, dirFiles)).toBe('all')
    })

    it('toggles from none/partial to all selected', () => {
      const partial = new Set([dirFiles[0].path, '/other/file.txt'])
      const result = toggleDirectorySelection(partial, dirFiles)
      expect(result.has(dirFiles[0].path)).toBe(true)
      expect(result.has(dirFiles[1].path)).toBe(true)
      expect(result.has('/other/file.txt')).toBe(true)
    })

    it('toggles from all selected to deselecting the entire folder', () => {
      const allSelected = new Set([dirFiles[0].path, dirFiles[1].path, '/other/file.txt'])
      const result = toggleDirectorySelection(allSelected, dirFiles)
      expect(result.has(dirFiles[0].path)).toBe(false)
      expect(result.has(dirFiles[1].path)).toBe(false)
      expect(result.has('/other/file.txt')).toBe(true)
    })
  })

  describe('Folder Tree and Cascading Selection', () => {
    it('builds a true hierarchical tree with recursive counts and sizes', () => {
      const tree = buildFolderTree(sampleFiles)

      expect(tree.depth).toBe(0)
      expect(tree.totalFiles).toBe(6)
      expect(tree.totalBytes).toBe(500 + 1200 + 800 + 2500 + 1500 + 3000)
      expect(tree.files.map((f) => f.relativePath)).toEqual(['package.json', 'README.md'])

      // Children of root: docs and src
      expect(tree.children.map((c) => c.name)).toEqual(['docs', 'src'])

      const docsNode = tree.children.find((c) => c.name === 'docs')!
      expect(docsNode.depth).toBe(1)
      expect(docsNode.totalFiles).toBe(1)
      expect(docsNode.fullPath).toBe('docs')

      const srcNode = tree.children.find((c) => c.name === 'src')!
      expect(srcNode.depth).toBe(1)
      expect(srcNode.totalFiles).toBe(3)
      expect(srcNode.children.map((c) => c.name)).toEqual(['renderer'])

      const rendererNode = srcNode.children[0]
      expect(rendererNode.depth).toBe(2)
      expect(rendererNode.fullPath).toBe('src/renderer')
      expect(rendererNode.totalFiles).toBe(2)
      expect(rendererNode.files.length).toBe(2)
    })

    it('computes tri-state node selection state correctly', () => {
      const tree = buildFolderTree(sampleFiles)
      const srcNode = tree.children.find((c) => c.name === 'src')!

      // None selected
      expect(getNodeSelectionState(srcNode, new Set())).toBe('none')

      // Partial (1 of 3 selected)
      const partial = new Set(['/project/src/index.ts'])
      expect(getNodeSelectionState(srcNode, partial)).toBe('some')

      // All 3 selected
      const all = new Set(['/project/src/index.ts', '/project/src/renderer/App.tsx', '/project/src/renderer/App.test.tsx'])
      expect(getNodeSelectionState(srcNode, all)).toBe('all')
    })

    it('cascades toggleFolderNode down through all nested subfolders and files', () => {
      const tree = buildFolderTree(sampleFiles)
      const srcNode = tree.children.find((c) => c.name === 'src')!

      // Selecting src cascades to src/index.ts AND src/renderer/App.tsx AND src/renderer/App.test.tsx
      const initial = new Set(['/project/package.json'])
      const selected = toggleFolderNode(srcNode, initial)

      expect(selected.has('/project/package.json')).toBe(true)
      expect(selected.has('/project/src/index.ts')).toBe(true)
      expect(selected.has('/project/src/renderer/App.tsx')).toBe(true)
      expect(selected.has('/project/src/renderer/App.test.tsx')).toBe(true)
      expect(selected.size).toBe(4)

      // Toggling src when fully selected deselects all descendants
      const deselected = toggleFolderNode(srcNode, selected)
      expect(deselected.has('/project/package.json')).toBe(true)
      expect(deselected.has('/project/src/index.ts')).toBe(false)
      expect(deselected.has('/project/src/renderer/App.tsx')).toBe(false)
      expect(deselected.has('/project/src/renderer/App.test.tsx')).toBe(false)
      expect(deselected.size).toBe(1)
    })

    it('defaults collapsed dirs for depth > 2', () => {
      const deepFiles: ScannedFileInfo[] = [
        ...sampleFiles,
        {
          path: '/project/src/renderer/components/ui/Button.tsx',
          relativePath: 'src/renderer/components/ui/Button.tsx',
          size: 400,
          extension: '.tsx',
          isSuggestedRemoval: false
        }
      ]
      const tree = buildFolderTree(deepFiles)
      const collapsed = getDefaultCollapsedDirs(tree, 2)

      // depth 1 (docs, src) and depth 2 (src/renderer) are NOT collapsed
      expect(collapsed.has('docs')).toBe(false)
      expect(collapsed.has('src')).toBe(false)
      expect(collapsed.has('src/renderer')).toBe(false)

      // depth 3 (src/renderer/components) and depth 4 (src/renderer/components/ui) ARE collapsed
      expect(collapsed.has('src/renderer/components')).toBe(true)
      expect(collapsed.has('src/renderer/components/ui')).toBe(true)
    })

    it('auto-expands ancestor chains for search matches', () => {
      const tree = buildFolderTree(sampleFiles)
      const matching = [sampleFiles[3]] // src/renderer/App.tsx
      const expanded = getExpandedDirsForSearch(tree, matching)

      expect(expanded.has('src')).toBe(true)
      expect(expanded.has('src/renderer')).toBe(true)
      expect(expanded.has('docs')).toBe(false)
    })

    it('retrieves all directory paths for global collapse all', () => {
      const tree = buildFolderTree(sampleFiles)
      const allDirs = getAllDirectoryPaths(tree)
      expect(Array.from(allDirs).sort()).toEqual(['docs', 'src', 'src/renderer'])
    })
  })
})

