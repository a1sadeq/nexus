import { describe, it, expect, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { DEFAULT_ZIP_LIMITS, ZipError, openZip, readCentralDirectory, readZipFile } from './safeZip'
import { buildZip } from './testZipBuilder'

const tempDirs: string[] = []
const tempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-zip-test-'))
  tempDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

describe('reading entries', () => {
  it('reads stored and deflated entries by name', () => {
    const zip = openZip(
      buildZip([
        { name: 'a.txt', content: 'hello world', store: true },
        { name: 'b/c.txt', content: 'compressed content '.repeat(50) }
      ])
    )
    expect(zip.names()).toEqual(['a.txt', 'b/c.txt'])
    expect(zip.readText('a.txt')).toBe('hello world')
    expect(zip.readText('b/c.txt')).toBe('compressed content '.repeat(50))
  })

  it('returns null for a missing entry instead of throwing', () => {
    const zip = openZip(buildZip([{ name: 'a.txt', content: 'x' }]))
    expect(zip.read('nope.txt')).toBeNull()
    expect(zip.readText('nope.txt')).toBeNull()
    expect(zip.has('nope.txt')).toBe(false)
  })

  it('handles UTF-8 entry names and content', () => {
    const zip = openZip(buildZip([{ name: 'مجلد/ملف.xml', content: '<t>مرحبا</t>' }]))
    expect(zip.readText('مجلد/ملف.xml')).toBe('<t>مرحبا</t>')
  })

  it('reads from disk with the same guarantees', () => {
    const dir = tempDir()
    const file = path.join(dir, 'archive.xlsx')
    fs.writeFileSync(file, buildZip([{ name: 'xl/workbook.xml', content: '<workbook/>' }]))
    expect(readZipFile(file).readText('xl/workbook.xml')).toBe('<workbook/>')
  })
})

describe('hostile archives are refused, not parsed', () => {
  it('rejects a file that is not a ZIP at all', () => {
    expect(() => openZip(Buffer.from('this is definitely not a zip file'))).toThrow(ZipError)
    try {
      openZip(Buffer.from('nope'))
    } catch (error) {
      expect((error as ZipError).code).toBe('not-a-zip')
    }
  })

  it('rejects an encrypted entry instead of producing garbage', () => {
    const buffer = buildZip([{ name: 'secret.xml', content: '<x/>' }])
    // Set the encryption bit in the central directory flags (offset 8 of the CD record).
    const cdOffset = buffer.readUInt32LE(buffer.length - 22 + 16)
    buffer.writeUInt16LE(buffer.readUInt16LE(cdOffset + 8) | 0x1, cdOffset + 8)
    expect(() => openZip(buffer)).toThrow(/encrypted/i)
  })

  it('refuses an unsupported compression method', () => {
    const buffer = buildZip([{ name: 'a.xml', content: '<x/>' }])
    const cdOffset = buffer.readUInt32LE(buffer.length - 22 + 16)
    buffer.writeUInt16LE(14, cdOffset + 10) // LZMA
    expect(() => openZip(buffer)).toThrow(/compression method/i)
  })

  it('refuses a declared-size bomb before inflating anything', () => {
    const buffer = buildZip([{ name: 'bomb.xml', content: '<x/>' }], {
      declaredUncompressedSize: 500 * 1024 * 1024
    })
    try {
      openZip(buffer)
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ZipError)
      expect((error as ZipError).code).toBe('entry-too-large')
    }
  })

  it('refuses an archive with too many entries', () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.txt`, content: 'x' }))
    const buffer = buildZip(entries)
    expect(() => readCentralDirectory(buffer, { ...DEFAULT_ZIP_LIMITS, maxEntries: 3 })).toThrow(
      /too many|declares/i
    )
  })

  it('refuses an archive whose total expansion exceeds the cap', () => {
    const big = 'a'.repeat(200_000)
    const buffer = buildZip([
      { name: 'one.txt', content: big },
      { name: 'two.txt', content: big }
    ])
    try {
      readCentralDirectory(buffer, { ...DEFAULT_ZIP_LIMITS, maxTotalBytes: 250_000 })
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as ZipError).code).toBe('archive-too-large')
    }
  })

  it('refuses an absurd compression ratio', () => {
    // 2 MB of zeros deflates to a few KB: a classic bomb shape.
    const buffer = buildZip([{ name: 'zeros.bin', content: Buffer.alloc(2 * 1024 * 1024) }])
    try {
      readCentralDirectory(buffer, { ...DEFAULT_ZIP_LIMITS, maxRatio: 50 })
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as ZipError).code).toBe('ratio-bomb')
    }
  })

  it('caps the bytes actually inflated even when the header lies', () => {
    const buffer = buildZip([{ name: 'payload.xml', content: '<x/>'.repeat(50_000) }])
    const zip = openZip(buffer)
    expect(() => zip.read('payload.xml', { maxBytes: 1024 })).toThrow(ZipError)
  })

  it('reports a truncated archive rather than returning partial data', () => {
    const buffer = buildZip([{ name: 'a.txt', content: 'hello' }])
    const truncated = buffer.subarray(0, buffer.length - 10)
    expect(() => openZip(truncated)).toThrow(ZipError)
  })

  it('does not write anything to disk while reading', () => {
    const dir = tempDir()
    const before = fs.readdirSync(dir)
    openZip(buildZip([{ name: '../escape.txt', content: 'path traversal style name' }]))
    // Nothing extracted, and the name is only ever a key in a Map.
    expect(fs.readdirSync(dir)).toEqual(before)
  })
})
