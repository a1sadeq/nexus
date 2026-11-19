import { describe, it, expect, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  classifyUploadKind,
  classifyUploadKindWithSniff,
  deliveryHint,
  isTextKind,
  kindLabel,
  requiresOriginalAttachment
} from '../shared/uploadFileKind'

vi.mock('electron', () => ({ dialog: {} }))

const {
  scanFolder,
  scanFolderAsync,
  partitionCodebaseFiles,
  bundleAndInjectSelectedFiles,
  splitSelectionByDelivery,
  generateBundleTextAsync
} = await import('./uploadManager')

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])
const PDF_BYTES = Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')

function makeWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-binary-test-'))
  fs.writeFileSync(path.join(dir, 'index.ts'), 'export const a = 1\n')
  fs.writeFileSync(path.join(dir, 'screenshot.png'), PNG_BYTES)
  fs.writeFileSync(path.join(dir, 'spec.pdf'), PDF_BYTES)
  fs.writeFileSync(path.join(dir, 'clip.mp4'), Buffer.from([0, 1, 2, 3, 4]))
  return dir
}

interface FakeViewOptions {
  probeCounts?: number[]
}

interface FakeView {
  view: Parameters<typeof bundleAndInjectSelectedFiles>[0]
  toasts: string[]
  injections: string[][]
}

function makeFakeView(options: FakeViewOptions = {}): FakeView {
  const counts = [...(options.probeCounts ?? [])]
  const toasts: string[] = []
  const injections: string[][] = []
  const attached = { value: false }
  const webContents = {
    isDestroyed: () => false,
    executeJavaScript: async (script: string) => {
      if (script.includes('__nexusTabToast')) {
        const match = /t\.textContent = (".*?");/.exec(script)
        if (match) toasts.push(JSON.parse(match[1]))
        return undefined
      }
      if (script.includes('targetInputIndex')) {
        return { w: 1200, h: 800, dropX: 600, dropY: 650, targetInputIndex: 0 }
      }
      if (script.includes('attachment-chip')) {
        const next = counts.length > 1 ? counts.shift()! : (counts[0] ?? 0)
        return { ok: true, count: next }
      }
      return undefined
    },
    debugger: {
      isAttached: () => attached.value,
      attach: () => {
        attached.value = true
      },
      detach: () => {
        attached.value = false
      },
      sendCommand: async (command: string, params: Record<string, unknown>) => {
        if (command === 'DOM.getDocument') return { root: { nodeId: 1 } }
        if (command === 'DOM.querySelectorAll') return { nodeIds: [1] }
        if (command === 'DOM.setFileInputFiles') {
          injections.push(params.files as string[])
          return {}
        }
        if (command === 'Input.dispatchDragEvent') {
          if (params.type === 'drop') injections.push((params.data as { files: string[] }).files)
          return {}
        }
        return {}
      }
    }
  }
  return { view: { webContents } as never, toasts, injections }
}

describe('upload file kinds', () => {
  it('routes each extension to the right delivery path', () => {
    expect(classifyUploadKind('.ts')).toBe('text')
    expect(classifyUploadKind('md')).toBe('text')
    expect(classifyUploadKind('.png')).toBe('image')
    expect(classifyUploadKind('.jpeg')).toBe('image')
    expect(classifyUploadKind('.pdf')).toBe('document')
    expect(classifyUploadKind('.docx')).toBe('document')
    expect(classifyUploadKind('.xlsx')).toBe('document')
    expect(classifyUploadKind('.mp4')).toBe('video')
    expect(classifyUploadKind('.mp3')).toBe('audio')
    expect(classifyUploadKind('.zip')).toBe('archive')
    expect(classifyUploadKind('.so')).toBe('binary')
    expect(classifyUploadKind('')).toBe('text')
  })

  it('keeps SVG source in the text bundle', () => {
    expect(classifyUploadKind('.svg')).toBe('text')
  })

  it('treats a null byte in an unknown extension as binary', () => {
    expect(classifyUploadKindWithSniff('.weird', true)).toBe('binary')
    expect(classifyUploadKindWithSniff('.weird', false)).toBe('text')
    // Known binaries stay binary regardless of sniffing
    expect(classifyUploadKindWithSniff('.png', false)).toBe('image')
  })

  it('exposes labels and delivery hints for the review modal', () => {
    expect(kindLabel('image')).toBe('Image')
    expect(deliveryHint('archive')).toContain('cannot open')
    expect(isTextKind('text')).toBe(true)
    expect(requiresOriginalAttachment('text')).toBe(false)
    expect(requiresOriginalAttachment('video')).toBe(true)
  })
})

describe('scanning a folder with binary files (plan 03)', () => {
  it('lists images, documents and video instead of dropping them', async () => {
    const dir = makeWorkspace()
    try {
      const result = await scanFolderAsync(dir)
      const byName = new Map(result.files.map((f) => [path.basename(f.path), f]))
      expect(byName.size).toBe(4)
      expect(byName.get('index.ts')?.kind).toBe('text')
      expect(byName.get('screenshot.png')?.kind).toBe('image')
      expect(byName.get('spec.pdf')?.kind).toBe('document')
      expect(byName.get('clip.mp4')?.kind).toBe('video')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('sync scan matches the async scan', async () => {
    const dir = makeWorkspace()
    try {
      const sync = scanFolder(dir)
      const asyncResult = await scanFolderAsync(dir)
      expect(sync.files.map((f) => f.relativePath).sort()).toEqual(
        asyncResult.files.map((f) => f.relativePath).sort()
      )
      expect(sync.files.find((f) => f.relativePath === 'screenshot.png')?.kind).toBe('image')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps binaries out of the text bundle but in the partition result', () => {
    const dir = makeWorkspace()
    try {
      const selected = fs.readdirSync(dir).map((name) => path.join(dir, name))
      const partition = partitionCodebaseFiles(dir, selected, 8 * 1024 * 1024, false)

      const bundledPaths = partition.chunks.flatMap((chunk) => chunk.files.map((f) => f.relativePath))
      expect(bundledPaths).toEqual(['index.ts'])
      // Binary bytes never enter the text bundle.
      expect(partition.chunks[0].content).not.toContain('PDF-1.7')

      const originals = partition.originalAttachments ?? []
      expect(originals.map((item) => item.relativePath).sort()).toEqual([
        'clip.mp4',
        'screenshot.png',
        'spec.pdf'
      ])
      expect(originals.find((item) => item.relativePath === 'screenshot.png')?.kind).toBe('image')
      expect(partition.totalFiles).toBe(4)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('splits a selection for the preview/save IPC handlers', () => {
    const dir = makeWorkspace()
    try {
      const selected = fs.readdirSync(dir).map((name) => path.join(dir, name))
      const { textPaths, originals } = splitSelectionByDelivery(dir, selected)
      expect(textPaths.map((p) => path.basename(p))).toEqual(['index.ts'])
      expect(originals).toHaveLength(3)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('still refuses to decode a binary as text', async () => {
    const dir = makeWorkspace()
    try {
      const png = path.join(dir, 'screenshot.png')
      await expect(generateBundleTextAsync(dir, [png])).rejects.toThrow(/cannot be included/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('attaching text parts together with original files', () => {
  it('puts the bundle part and the image in ONE injection', async () => {
    const dir = makeWorkspace()
    try {
      const selected = fs.readdirSync(dir).map((name) => path.join(dir, name))
      const { view, toasts, injections } = makeFakeView({ probeCounts: [0, 4] })

      const result = await bundleAndInjectSelectedFiles(view, dir, selected)

      expect(injections).toHaveLength(1)
      const attachedNames = injections[0].map((p) => path.basename(p))
      expect(attachedNames).toContain('screenshot.png')
      expect(attachedNames).toContain('spec.pdf')
      expect(attachedNames).toContain('clip.mp4')
      expect(attachedNames.some((name) => name.endsWith('_codebase.txt'))).toBe(true)
      // Originals are attached from their real paths, never copied.
      expect(injections[0].filter((p) => p.startsWith(dir))).toHaveLength(3)

      expect(result?.success).toBe(true)
      expect(result?.totalParts).toBe(4)
      expect(toasts.at(-1)).toBe('All 4 files attached. Review and press Send.')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('works when only binaries are selected', async () => {
    const dir = makeWorkspace()
    try {
      const png = path.join(dir, 'screenshot.png')
      const { view, toasts, injections } = makeFakeView({ probeCounts: [0, 1] })
      const result = await bundleAndInjectSelectedFiles(view, dir, [png])
      expect(injections[0]).toEqual([png])
      expect(result?.success).toBe(true)
      expect(toasts.at(-1)).toBe('File 1 attached. Review and press Send.')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports partial attachment honestly for mixed selections', async () => {
    const dir = makeWorkspace()
    try {
      const selected = fs.readdirSync(dir).map((name) => path.join(dir, name))
      const { view, toasts } = makeFakeView({ probeCounts: [0, 1] })
      const result = await bundleAndInjectSelectedFiles(view, dir, selected)
      expect(result?.needsUserCheck).toBe(true)
      expect(toasts.at(-1)).toBe('Only 1 of 4 files are attached. Add the rest before pressing Send.')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('directories that are not scanned are reported (plan 03)', () => {
  it('sync scan lists .git and node_modules with a reason instead of dropping them', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-skipped-dirs-'))
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export const a = 1\n')
    fs.mkdirSync(path.join(dir, '.git', 'objects'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.git', 'config'), '[core]\n')
    fs.mkdirSync(path.join(dir, 'node_modules', 'left-pad'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1\n')

    const result = scanFolder(dir)
    const skipped = result.skippedDirs ?? []
    const paths = skipped.map((d) => d.relativePath)
    expect(paths).toContain('.git')
    expect(paths).toContain('node_modules')
    expect(skipped.every((d) => d.reason.length > 0)).toBe(true)
    // Their contents must NOT be scanned, and they must not be counted as files.
    expect(result.files.map((f) => f.relativePath)).toEqual(['index.ts'])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('async scan reports skipped directories the same way', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-skipped-dirs-async-'))
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export const a = 1\n')
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'dist'), { recursive: true })
    const result = await scanFolderAsync(dir)
    const paths = (result.skippedDirs ?? []).map((d) => d.relativePath).sort()
    expect(paths).toEqual(['.git', 'dist'])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('a scan with nothing skipped reports no skippedDirs field', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-no-skip-'))
    fs.writeFileSync(path.join(dir, 'index.ts'), 'export const a = 1\n')
    expect(scanFolder(dir).skippedDirs).toBeUndefined()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
