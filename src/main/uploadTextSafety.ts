import * as path from 'path'
import { TextDecoder } from 'util'

// Known binary containers are never converted to text, even if an empty or
// unusual example happens to contain valid UTF-8. This list is a safety guard,
// not a complete file-type detector or a provider capability list.
const NON_TEXT_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.tif', '.tiff',
  '.pdf', '.mp4', '.mov', '.mkv', '.avi', '.webm', '.mp3', '.wav', '.ogg',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp',
  '.zip', '.gz', '.tar', '.7z', '.rar', '.exe', '.dll', '.so', '.dylib',
  '.sqlite', '.sqlite3', '.db', '.ttf', '.woff', '.woff2'
])

/** Reject binary and non-UTF-8 input instead of silently replacing bytes. */
export function decodeBundleText(filePath: string, bytes: Uint8Array): string {
  if (NON_TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase()) || bytes.includes(0)) {
    throw new Error('Selected file is binary or requires a dedicated upload route; it cannot be included in a text bundle.')
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    throw new Error('Selected file is not valid UTF-8; it cannot be included in a text bundle without a reviewed conversion.')
  }
}
