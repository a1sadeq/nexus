import { describe, expect, it } from 'vitest'
import {
  DEFAULT_UPLOAD_PART_SIZE_MB,
  UPLOAD_PART_SIZE_MB,
  normalisePartSizeMb,
  normaliseRelativePath,
  partSizeBytes,
  partSizeMb
} from './folderUpload'

/**
 * Build 54 — the two things a Windows folder upload got wrong.
 *
 * 1. `path.relative()` answers with backslashes on Windows, and everything that reads a scanned file path —
 *    the popup's folder tree, the search, the bundle headers — splits on `/`. A folder picked on Windows
 *    therefore arrived as one flat row of `folder\file.py folder\file2.py` instead of the folders that
 *    were selected. One spelling, decided where the path is made.
 *
 * 2. The part size existed only inside the Chunks & Parts drawer, and the button that actually attaches
 *    files ignored it. It is now a control on the upload popup, remembered, over a closed list of sizes.
 */

describe('path separators', () => {
  it('turns a Windows relative path into the one spelling the app reads', () => {
    expect(normaliseRelativePath('src\\main\\index.ts')).toBe('src/main/index.ts')
    expect(normaliseRelativePath('folder\\file.py')).toBe('folder/file.py')
  })

  it('leaves a path that is already correct alone', () => {
    expect(normaliseRelativePath('src/main/index.ts')).toBe('src/main/index.ts')
    expect(normaliseRelativePath('index.ts')).toBe('index.ts')
  })

  it('handles a mixed path, which is what a UNC or hybrid selection produces', () => {
    expect(normaliseRelativePath('src\\main/utils/helper.ts')).toBe('src/main/utils/helper.ts')
  })

  it('strips the prefixes that would otherwise create an empty first segment', () => {
    expect(normaliseRelativePath('./src/index.ts')).toBe('src/index.ts')
    expect(normaliseRelativePath('/src/index.ts')).toBe('src/index.ts')
    expect(normaliseRelativePath('src//main///index.ts')).toBe('src/main/index.ts')
  })

  it('does not touch anything that is not a string', () => {
    expect(normaliseRelativePath(undefined as unknown as string)).toBe('')
    expect(normaliseRelativePath(null as unknown as string)).toBe('')
  })

  it('survives a filename that legitimately contains a backslash', () => {
    // Only separators are normalised; the result is still one segment per separator, which is what the
    // tree can render. A file named `a\b.txt` on Unix becomes `a/b.txt` — and that is the honest trade:
    // the tree hazard of a segment containing a slash is worse than a renamed label in a bundle header.
    expect(normaliseRelativePath('a\\b.txt')).toBe('a/b.txt')
  })
})

describe('the offered part sizes', () => {
  it('are the sizes that were asked for', () => {
    expect([...UPLOAD_PART_SIZE_MB]).toEqual([5, 10, 15, 20, 25])
  })

  it('start at 10 MB, which is an offered size', () => {
    expect(UPLOAD_PART_SIZE_MB).toContain(DEFAULT_UPLOAD_PART_SIZE_MB)
  })

  it('snap anything remembered onto an offered size', () => {
    expect(normalisePartSizeMb(5)).toBe(5)
    expect(normalisePartSizeMb(25)).toBe(25)
    // The old drawer offered 8 MB; a stored 8 must open the popup on a real choice.
    expect(normalisePartSizeMb(8)).toBe(10)
    expect(normalisePartSizeMb(12)).toBe(10)
    expect(normalisePartSizeMb(13)).toBe(15)
    expect(normalisePartSizeMb(1000)).toBe(25)
    expect(normalisePartSizeMb(1)).toBe(5)
  })

  it('accepts the string a store gives back', () => {
    expect(normalisePartSizeMb('15')).toBe(15)
    expect(normalisePartSizeMb(' 20 ')).toBe(20)
  })

  it('falls back to the default rather than to a broken upload', () => {
    expect(normalisePartSizeMb(null)).toBe(DEFAULT_UPLOAD_PART_SIZE_MB)
    expect(normalisePartSizeMb(undefined)).toBe(DEFAULT_UPLOAD_PART_SIZE_MB)
    expect(normalisePartSizeMb('')).toBe(DEFAULT_UPLOAD_PART_SIZE_MB)
    expect(normalisePartSizeMb('banana')).toBe(DEFAULT_UPLOAD_PART_SIZE_MB)
    expect(normalisePartSizeMb(0)).toBe(DEFAULT_UPLOAD_PART_SIZE_MB)
    expect(normalisePartSizeMb(-10)).toBe(DEFAULT_UPLOAD_PART_SIZE_MB)
    expect(normalisePartSizeMb(Number.NaN)).toBe(DEFAULT_UPLOAD_PART_SIZE_MB)
    expect(normalisePartSizeMb(Number.POSITIVE_INFINITY)).toBe(DEFAULT_UPLOAD_PART_SIZE_MB)
  })

  it('converts to bytes without drifting', () => {
    expect(partSizeBytes(5)).toBe(5 * 1024 * 1024)
    expect(partSizeBytes(25)).toBe(25 * 1024 * 1024)
    expect(partSizeBytes('10')).toBe(10 * 1024 * 1024)
    expect(partSizeBytes(undefined)).toBe(DEFAULT_UPLOAD_PART_SIZE_MB * 1024 * 1024)
  })

  it('reads a byte count back as the size it means', () => {
    expect(partSizeMb(5 * 1024 * 1024)).toBe(5)
    expect(partSizeMb(25 * 1024 * 1024)).toBe(25)
    // A byte count from a build that used 8 MB still maps onto an offered size.
    expect(partSizeMb(8 * 1024 * 1024)).toBe(10)
    expect(partSizeMb(0)).toBe(DEFAULT_UPLOAD_PART_SIZE_MB)
    expect(partSizeMb(null)).toBe(DEFAULT_UPLOAD_PART_SIZE_MB)
  })
})
