import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { partitionCodebaseFiles } from './uploadManager'

describe('file-backed upload partitioning', () => {
  it('keeps original bytes untouched and preserves UTF-8 text without default compression', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexus-parts-test-'))
    try {
      const file = join(dir, 'source.ts')
      const content = 'مرحبا😀  \n\n\n'.repeat(160) + 'end  \n'
      writeFileSync(file, content, 'utf8')
      const partition = partitionCodebaseFiles(dir, [file], 500)
      expect(partition.chunks.length).toBeGreaterThan(1)
      const reconstructed = partition.chunks
        .map((chunk) => {
          const first = chunk.content.indexOf('\n\n') + 2
          const second = chunk.content.indexOf('\n\n', first) + 2
          return chunk.content.slice(second, -2)
        })
        .join('')
      expect(reconstructed).toBe(content)
      expect(readFileSync(file, 'utf8')).toBe(content)
      expect(partition.chunks.every((chunk) => chunk.byteSize <= 500)).toBe(true)
      expect(partition.savedBytes).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
