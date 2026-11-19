import * as fs from 'fs'
import * as zlib from 'zlib'

/**
 * Minimal, hardened ZIP reader (plan 02).
 *
 * Office files are ZIP archives, and a ZIP archive is attacker-controlled input. Plan 02
 * explicitly demands protection against "ZIP expansion bombs" and parser exploits, so this
 * reader:
 *  - never extracts to disk (no path traversal surface at all — entries are read by name);
 *  - caps entry count, per-entry size, total uncompressed bytes and compression ratio;
 *  - caps JSON/XML bytes actually inflated, and double-checks the real output length;
 *  - refuses encrypted entries and unsupported compression methods instead of guessing;
 *  - reads only what is asked for, so a 200 MB workbook costs what its XML costs.
 *
 * There is no dependency here on purpose: pulling a general-purpose ZIP library into the
 * main process would add exactly the parser surface this rule is about.
 */

export interface ZipEntry {
  name: string
  compressedSize: number
  uncompressedSize: number
  compressionMethod: number
  crc32: number
  localHeaderOffset: number
  isDirectory: boolean
}

export class ZipError extends Error {
  readonly code:
    | 'not-a-zip'
    | 'truncated'
    | 'too-many-entries'
    | 'entry-too-large'
    | 'archive-too-large'
    | 'ratio-bomb'
    | 'unsupported-compression'
    | 'encrypted'
    | 'extract-failed'

  constructor(code: ZipError['code'], message: string) {
    super(message)
    this.name = 'ZipError'
    this.code = code
  }
}

export interface ZipLimits {
  maxEntries: number
  maxEntryBytes: number
  maxTotalBytes: number
  /** Reject entries whose uncompressed:compressed ratio exceeds this. */
  maxRatio: number
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 2000,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxRatio: 200
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const EOCD_MIN_SIZE = 22
const MAX_COMMENT = 0xffff

interface EocdInfo {
  entryCount: number
  centralDirectoryOffset: number
  centralDirectorySize: number
}

function findEocd(buffer: Buffer): EocdInfo {
  const start = Math.max(0, buffer.length - (EOCD_MIN_SIZE + MAX_COMMENT))
  for (let offset = buffer.length - EOCD_MIN_SIZE; offset >= start; offset--) {
    if (buffer.readUInt32LE(offset) !== EOCD_SIGNATURE) continue
    const entryCount = buffer.readUInt16LE(offset + 10)
    const centralDirectorySize = buffer.readUInt32LE(offset + 12)
    const centralDirectoryOffset = buffer.readUInt32LE(offset + 16)
    if (centralDirectoryOffset === 0xffffffff || entryCount === 0xffff) {
      throw new ZipError('unsupported-compression', 'ZIP64 archives are not supported.')
    }
    return { entryCount, centralDirectoryOffset, centralDirectorySize }
  }
  throw new ZipError('not-a-zip', 'No end-of-central-directory record found.')
}

/** Read and validate the central directory. Pure: takes the whole file as a buffer. */
export function readCentralDirectory(
  buffer: Buffer,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS
): ZipEntry[] {
  const eocd = findEocd(buffer)
  if (eocd.entryCount > limits.maxEntries) {
    throw new ZipError(
      'too-many-entries',
      `Archive declares ${eocd.entryCount} entries (limit ${limits.maxEntries}).`
    )
  }

  const entries: ZipEntry[] = []
  let offset = eocd.centralDirectoryOffset
  let totalUncompressed = 0

  for (let index = 0; index < eocd.entryCount; index++) {
    if (offset + 46 > buffer.length) {
      throw new ZipError('truncated', 'Central directory is truncated.')
    }
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new ZipError('not-a-zip', `Bad central directory signature at ${offset}.`)
    }
    const flags = buffer.readUInt16LE(offset + 8)
    const compressionMethod = buffer.readUInt16LE(offset + 10)
    const crc32 = buffer.readUInt32LE(offset + 16)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localHeaderOffset = buffer.readUInt32LE(offset + 42)
    const nameStart = offset + 46
    if (nameStart + nameLength > buffer.length) {
      throw new ZipError('truncated', 'Central directory entry name is truncated.')
    }
    const name = buffer.toString('utf8', nameStart, nameStart + nameLength)

    if (flags & 0x1) {
      throw new ZipError('encrypted', `Entry "${name}" is encrypted.`)
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new ZipError(
        'unsupported-compression',
        `Entry "${name}" uses compression method ${compressionMethod}; only stored and deflate are supported.`
      )
    }
    if (uncompressedSize > limits.maxEntryBytes) {
      throw new ZipError('entry-too-large', `Entry "${name}" declares ${uncompressedSize} bytes.`)
    }
    totalUncompressed += uncompressedSize
    if (totalUncompressed > limits.maxTotalBytes) {
      throw new ZipError(
        'archive-too-large',
        `Archive expands beyond ${limits.maxTotalBytes} bytes (limit reached at "${name}").`
      )
    }
    if (
      compressedSize > 0 &&
      uncompressedSize / compressedSize > limits.maxRatio &&
      uncompressedSize > 1024 * 1024
    ) {
      throw new ZipError(
        'ratio-bomb',
        `Entry "${name}" expands ${Math.round(uncompressedSize / compressedSize)}x — refusing to inflate it.`
      )
    }

    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      compressionMethod,
      crc32,
      localHeaderOffset,
      isDirectory: name.endsWith('/')
    })
    offset = nameStart + nameLength + extraLength + commentLength
  }

  return entries
}

export interface ZipEntryReader {
  entries: ZipEntry[]
  names(): string[]
  has(name: string): boolean
  /** Inflate one entry. Returns null when the entry does not exist. */
  read(name: string, options?: { maxBytes?: number }): Buffer | null
  readText(name: string, options?: { maxBytes?: number }): string | null
}

export const DEFAULT_XML_LIMIT_BYTES = 32 * 1024 * 1024

export function openZip(buffer: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipEntryReader {
  const entries = readCentralDirectory(buffer, limits)
  const byName = new Map(entries.map((entry) => [entry.name, entry]))
  const cache = new Map<string, Buffer>()

  const read = (name: string, options: { maxBytes?: number } = {}): Buffer | null => {
    const cached = cache.get(name)
    if (cached) return cached
    const entry = byName.get(name)
    if (!entry) return null
    if (entry.isDirectory) return null

    const maxBytes = options.maxBytes ?? DEFAULT_XML_LIMIT_BYTES
    const headerOffset = entry.localHeaderOffset
    if (headerOffset + 30 > buffer.length) {
      throw new ZipError('truncated', `Local header for "${name}" is out of range.`)
    }
    if (buffer.readUInt32LE(headerOffset) !== LOCAL_SIGNATURE) {
      throw new ZipError('not-a-zip', `Bad local header for "${name}".`)
    }
    const nameLength = buffer.readUInt16LE(headerOffset + 26)
    const extraLength = buffer.readUInt16LE(headerOffset + 28)
    const dataStart = headerOffset + 30 + nameLength + extraLength
    const dataEnd = dataStart + entry.compressedSize
    if (dataEnd > buffer.length) {
      throw new ZipError('truncated', `Data for "${name}" runs past the end of the file.`)
    }
    const raw = buffer.subarray(dataStart, dataEnd)

    let out: Buffer
    if (entry.compressionMethod === 0) {
      out = Buffer.from(raw)
    } else {
      try {
        // maxOutputLength is the real guard: a lying header cannot make us allocate more.
        out = zlib.inflateRawSync(raw, { maxOutputLength: Math.min(maxBytes, limits.maxEntryBytes) })
      } catch (error) {
        const message = (error as Error)?.message ?? String(error)
        if (/maxOutputLength|buffer/i.test(message)) {
          throw new ZipError('entry-too-large', `Entry "${name}" exceeded the inflate cap.`)
        }
        throw new ZipError('extract-failed', `Could not inflate "${name}": ${message}`)
      }
    }

    if (out.length > maxBytes) {
      throw new ZipError('entry-too-large', `Entry "${name}" inflated to ${out.length} bytes.`)
    }
    // The declared size must not be a lie in the other direction either.
    if (entry.uncompressedSize > 0 && out.length > entry.uncompressedSize + 1024) {
      throw new ZipError(
        'extract-failed',
        `Entry "${name}" inflated to more bytes than it declared.`
      )
    }

    cache.set(name, out)
    return out
  }

  return {
    entries,
    names: () => entries.map((entry) => entry.name),
    has: (name: string) => byName.has(name),
    read,
    readText: (name: string, options: { maxBytes?: number } = {}): string | null => {
      const data = read(name, options)
      return data ? data.toString('utf8') : null
    }
  }
}

/** Convenience for tests and one-shot reads. */
export function readZipFile(filePath: string, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipEntryReader {
  return openZip(fs.readFileSync(filePath), limits)
}
