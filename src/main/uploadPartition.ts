import type { BundleChunk, ChunkFileItem } from '../shared/folderUpload'

export interface PreparedUploadFile {
  relativePath: string
  content: string
  size: number
}

/** Pure text partitioning. Limits include all headers; Unicode is never split mid-codepoint. */
export function partitionPreparedFiles(
  folderName: string,
  files: PreparedUploadFile[],
  maxBytes: number
): BundleChunk[] {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid part size')
  const chunks: BundleChunk[] = []
  let body = ''
  let bodyBytes = 0
  let items: ChunkFileItem[] = []
  // Escape control characters (NUL..US and DEL) for safe label rendering.
  // Build regex from char codes to avoid ESLint no-control-regex on literals.
  const ctrlLow = String.fromCharCode(0, 31) // NUL through Unit Separator
  const ctrlHigh = String.fromCharCode(127) // DEL
  const controlChars = new RegExp(
    `[\\r\\n${ctrlLow.replace(/\\/g, '\\\\')}${ctrlHigh.replace(/\\/g, '\\\\')}]`,
    'g'
  )
  const label = (value: string): string =>
    value.replace(controlChars, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
  const title = label(folderName)
  const header = (index: number, count: number): string =>
    `================================================================\nCodebase Bundle Part ${index}: ${title}\nFiles Included: ${count}\n================================================================\n\n`
  const fileHeader = (name: string): string =>
    `================================================================\nFile: ${label(name)}\n================================================================\n\n`
  const bytes = (value: string): number => Buffer.byteLength(value, 'utf8')
  const fits = (nextBodyBytes: number, count: number): boolean =>
    bytes(header(chunks.length + 1, count)) + nextBodyBytes <= maxBytes
  const finish = (): void => {
    if (!items.length) return
    const content = header(chunks.length + 1, items.length) + body
    const size = bytes(content)
    if (size > maxBytes) throw new Error('Part size cannot be satisfied')
    chunks.push({
      index: chunks.length + 1,
      totalChunks: 0,
      byteSize: size,
      fileCount: items.length,
      files: items,
      content
    })
    body = ''
    bodyBytes = 0
    items = []
  }
  for (const file of files) {
    const payload = fileHeader(file.relativePath) + file.content + '\n\n'
    const payloadBytes = bytes(payload)
    if (fits(bodyBytes + payloadBytes, items.length + 1)) {
      body += payload
      bodyBytes += payloadBytes
      items.push({ relativePath: file.relativePath, size: file.size })
      continue
    }
    finish()
    if (fits(payloadBytes, 1)) {
      body = payload
      bodyBytes = payloadBytes
      items = [{ relativePath: file.relativePath, size: file.size }]
      continue
    }
    if (!file.content) throw new Error('Part size is too small for file headers')
    let part = 1
    let text = ''
    let textBytes = 0
    let prefix = fileHeader(`${file.relativePath} (Part ${part})`)
    let capacity = maxBytes - bytes(header(chunks.length + 1, 1)) - bytes(prefix) - 2
    if (capacity < 1) throw new Error('Part size is too small for file headers')
    for (const codepoint of file.content) {
      const size = bytes(codepoint)
      if (size > capacity) {
        if (!text) throw new Error('Part size is too small for text content')
        body = prefix + text + '\n\n'
        items = [{ relativePath: `${file.relativePath} (Part ${part})`, size: textBytes }]
        finish()
        part++
        text = ''
        textBytes = 0
        prefix = fileHeader(`${file.relativePath} (Part ${part})`)
        capacity = maxBytes - bytes(header(chunks.length + 1, 1)) - bytes(prefix) - 2
        if (size > capacity) throw new Error('Part size is too small for text content')
      }
      text += codepoint
      textBytes += size
      capacity -= size
    }
    if (text) {
      body = prefix + text + '\n\n'
      items = [{ relativePath: `${file.relativePath} (Part ${part})`, size: textBytes }]
      finish()
    }
  }
  finish()
  for (const chunk of chunks) chunk.totalChunks = chunks.length
  return chunks
}
