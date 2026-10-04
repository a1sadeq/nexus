import { describe, it, expect } from 'vitest'
import {
  groupFilesByDirectory,
  selectMatchingFiles,
  deselectMatchingFiles,
  getDirectorySelectionState,
  toggleDirectorySelection
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
})
