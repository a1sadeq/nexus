import * as zlib from 'zlib'

/**
 * Test-only ZIP writer.
 *
 * The workbook tests need real archives (real central directories, real deflate streams) so
 * the reader is exercised the way Office files actually are. Writing the container by hand
 * keeps the production code dependency-free.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

export function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export interface ZipInputEntry {
  name: string
  content: string | Buffer
  /** Store instead of deflate (useful for deterministic sizes). */
  store?: boolean
}

/**
 * Build a ZIP archive. `options.declaredUncompressedSize` lets a test lie about a size to
 * prove the reader defends itself; the same for `declaredCompressedSize`.
 */
export function buildZip(
  entries: ZipInputEntry[],
  options: { declaredUncompressedSize?: number } = {}
): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, 'utf8')
    const method = entry.store ? 0 : 8
    const compressed = entry.store ? data : zlib.deflateRawSync(data, { level: 6 })
    const checksum = crc32(data)
    const nameBuffer = Buffer.from(entry.name, 'utf8')
    const declaredSize = options.declaredUncompressedSize ?? data.length

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(declaredSize, 22)
    local.writeUInt16LE(nameBuffer.length, 26)
    local.writeUInt16LE(0, 28)

    localParts.push(local, nameBuffer, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(declaredSize, 24)
    central.writeUInt16LE(nameBuffer.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBuffer)

    offset += local.length + nameBuffer.length + compressed.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralDirectory.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralDirectory, eocd])
}
