import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Build 54 — a Windows folder arrives as folders, and the part size is chosen where the upload happens.
 *
 * Two reports, one popup:
 *
 *   1. "when a windows user tried to upload a folder its popup listed it as `folder/file.py folder/file2.py`
 *      instead of the folders we have" — `path.relative()` answers with backslashes on Windows and every
 *      reader below it splits on `/`, so the whole scan collapsed into one flat row.
 *   2. "add in the uploading popup an easy to control part's size that remembers last value … instead of
 *      pressing the chunks & parts" — the size was selectable, but only inside a different drawer, and the
 *      button that actually attaches files ignored it in favour of a hard-coded 8 MB.
 *
 * The behaviour is covered by `shared/folderUpload.test.ts`, `renderer/src/lib/uploadPartSize.test.ts` and
 * the two new cases in `folderUploadHelpers.test.ts`. This file pins the wiring between them, in source,
 * because the popup and the attach path cannot be started in a test runner.
 */

const read = (...parts: string[]): string => readFileSync(join(__dirname, ...parts), 'utf8')

const uploadManager = read('uploadManager.ts')
const index = read('index.ts')
const shared = read('../shared/folderUpload.ts')
const modal = read('../renderer/src/components/FolderUploadModal.tsx')
const app = read('../renderer/src/App.tsx')
const helpers = read('../renderer/src/lib/folderUploadHelpers.ts')

describe('1. one spelling for a scanned path', () => {
  it('normalises where the path is made', () => {
    expect(shared).toContain('export function normaliseRelativePath')
    expect(uploadManager).toContain('normaliseRelativePath(path.relative(common, file.path))')
  })

  it('normalises the paths that go into bundle headers too', () => {
    // A part's header is a path the model reads; `src\\main\\index.ts` in there is a different file name
    // to every tool downstream, and to the drawer's own listing.
    const partition = uploadManager.slice(uploadManager.indexOf('export function partitionCodebaseFiles'))
    expect(partition).toContain('normaliseRelativePath(path.relative(folderPath, fullPath))')
    expect(partition).toContain('relativePath: normaliseRelativePath(path.relative(folderPath, fullPath)),')
  })

  it('normalises again in the tree, so one forgotten caller cannot flatten a folder', () => {
    expect(helpers).toContain('normaliseRelativePath')
    const tree = helpers.slice(helpers.indexOf('export function buildFolderTree'))
    expect(tree.slice(0, 700)).toContain('normaliseRelativePath(file.relativePath)')
    const search = helpers.slice(helpers.indexOf('export function getExpandedDirsForSearch'))
    expect(search.slice(0, 900)).toContain('normaliseRelativePath(f.relativePath).split')
  })
})

describe('2. a part size chosen on the popup, and remembered', () => {
  it('offers exactly the sizes that were asked for', () => {
    expect(shared).toContain('export const UPLOAD_PART_SIZE_MB = [5, 10, 15, 20, 25] as const')
    expect(modal).toContain('UPLOAD_PART_SIZE_MB.map')
    // The drawer used to offer 5/8/10; two lists that can drift is how the two panels disagree.
    expect(modal).not.toContain('[5, 8, 10].map')
  })

  it('puts the control on the upload popup itself, not only in the drawer', () => {
    // The control has to be outside the `isChunksDrawerOpen` branch — that branch *is* the drawer.
    const drawerStart = modal.indexOf('isChunksDrawerOpen && (')
    const control = modal.indexOf('{/* Part size — chosen here, where the upload happens, and remembered next time. */}')
    expect(control).toBeGreaterThan(-1)
    expect(control).toBeLessThan(drawerStart)
    expect(modal.slice(control, control + 900)).toContain('Part size')
  })

  it('opens on the remembered value and stores every change', () => {
    expect(modal).toContain('useState<UploadPartSizeMb>(() => loadPartSizeMb())')
    expect(modal).toContain('handleChangeMaxChunk = (mb: number): void => setMaxChunkMb(savePartSizeMb(undefined, mb))')
  })

  it('sends the chosen size with the upload, so it is not a decoration', () => {
    expect(modal).toContain('onConfirm(Array.from(selectedPaths), partBytesFor(mb))')
    expect(app).toContain('partSizeBytes')
    expect(index).toContain('payload.partSizeBytes')
    expect(index).toContain('maxChunkBytes: chosenPartBytes')
  })

  it('uses the same value for the drawer’s own partition, and for the estimate beside the control', () => {
    expect(modal).toContain('maxChunkBytes: partBytesFor(maxChunkMb),')
    expect(modal).toContain('estimatePartCount(selectedStats.bytes, maxChunkMb)')
  })

  it('shows how many parts the size will produce, and says it is an estimate', () => {
    expect(modal).toContain('Approximate: the bundle')
  })

  it('keeps the default a real choice rather than a number nobody was offered', () => {
    expect(shared).toContain('DEFAULT_UPLOAD_PART_SIZE_MB: UploadPartSizeMb = 10')
    expect(modal).not.toContain('useState<number>(8)')
  })
})
