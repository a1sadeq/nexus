import { describe, expect, it } from 'vitest'
import { partitionPreparedFiles } from './uploadPartition'

function payload(chunk: string): string {
  const afterPartHeader = chunk.indexOf('\n\n') + 2
  const afterFileHeader = chunk.indexOf('\n\n', afterPartHeader) + 2
  return chunk.slice(afterFileHeader, -2)
}

describe('text part sizing', () => {
  it('packs several files together with exact UTF-8 byte sizes and actual newlines', () => {
    const chunks = partitionPreparedFiles(
      'folder',
      [
        { relativePath: 'a.ts', content: 'hello\n', size: 6 },
        { relativePath: 'b.ts', content: 'مرحبا', size: 10 }
      ],
      1000
    )
    expect(chunks).toHaveLength(1)
    expect(chunks[0].fileCount).toBe(2)
    expect(chunks[0].byteSize).toBe(Buffer.byteLength(chunks[0].content, 'utf8'))
    expect(chunks[0].content).toContain('hello\n')
    expect(chunks[0].content).toContain('مرحبا')
    expect(chunks[0].content).not.toContain('\\nCodebase Bundle')
  })
  it('splits long lines safely across bounded parts without losing Unicode or whitespace', () => {
    const content = '😀مرحبا  x\n'.repeat(130) + '   final\n'
    const chunks = partitionPreparedFiles(
      'folder',
      [{ relativePath: 'long.txt', content, size: Buffer.byteLength(content) }],
      450
    )
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.map((chunk) => payload(chunk.content)).join('')).toBe(content)
    expect(
      chunks.every(
        (chunk) => chunk.byteSize <= 450 && chunk.byteSize === Buffer.byteLength(chunk.content)
      )
    ).toBe(true)
    expect(chunks.every((chunk) => !chunk.content.includes('\ufffd'))).toBe(true)
  })
  it('handles long unbroken lines without producing oversize parts', () => {
    const content = 'a'.repeat(5000)
    const chunks = partitionPreparedFiles(
      'x',
      [{ relativePath: 'x', content, size: content.length }],
      400
    )
    expect(chunks.map((chunk) => payload(chunk.content)).join('')).toBe(content)
    expect(chunks.every((chunk) => chunk.byteSize <= 400)).toBe(true)
  })
  it('fails clearly if size is too small even for headers or content', () => {
    expect(() =>
      partitionPreparedFiles('folder', [{ relativePath: 'a', content: '', size: 0 }], 5)
    ).toThrow()
    expect(() => partitionPreparedFiles('folder', [], 0)).toThrow()
    expect(() => partitionPreparedFiles('folder', [], Infinity)).toThrow()
  })
  it('escapes control characters in file labels', () => {
    const chunks = partitionPreparedFiles(
      'folder',
      [{ relativePath: 'file\nspoof', content: 'ok', size: 2 }],
      1000
    )
    expect(chunks[0].content).toContain('file\\u000aspoof')
  })
})
