import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ dialog: {} }))
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { generateBundleText, generateBundleTextAsync, partitionCodebaseFiles, createMasqueradedTextFile, uploadChunksSequentially } from './uploadManager'

describe('existing text entry points', () => {
  it('reject binary selections rather than emitting partially corrupted bundles', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-safety-test-'))
    try {
      const source = path.join(dir, 'a.ts'), png = path.join(dir, 'picture.png'), doc = path.join(dir, 'word.docx')
      fs.writeFileSync(source, 'const greeting = "مرحبا"\n')
      fs.writeFileSync(png, Buffer.from([137, 80, 78, 71]))
      fs.writeFileSync(doc, 'not real but still a docx')
      expect(generateBundleText(dir, [source]).text).toContain('مرحبا')
      await expect(generateBundleTextAsync(dir, [source, png])).rejects.toThrow(/cannot be included/)
      expect(() => generateBundleText(dir, [source, png])).toThrow(/cannot be included/)
      // Plan 03: binary selections are routed to original attachments instead of being
      // decoded, so partition keeps them out of the text chunks rather than throwing.
      const mixed = partitionCodebaseFiles(dir, [source, doc])
      expect(mixed.chunks.flatMap((c) => c.files.map((f) => f.relativePath))).toEqual(['a.ts'])
      expect(mixed.originalAttachments?.map((o) => o.relativePath)).toEqual(['word.docx'])
      expect(() => createMasqueradedTextFile(doc)).toThrow(/cannot be included/)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
  it('rejects multi-part dispatch before accessing the view or sending progress', async () => {
    const send = vi.fn()
    const window = { isDestroyed: () => false, webContents: { send } }
    const chunk = { index: 1, totalChunks: 2, byteSize: 1, fileCount: 1, files: [], content: 'x' }
    await expect(uploadChunksSequentially({} as never, window as never, [chunk, { ...chunk, index: 2 }], 'folder'))
      .rejects.toThrow(/Multiple batches require manual/)
    expect(send).not.toHaveBeenCalled()
  })
})
