/**
 * Office format detection (plan 02).
 *
 * Extension alone is not evidence: an `.xlsx` that is really a CFB container is either a
 * legacy binary or an encrypted OOXML file, and an `.xlsx` that is really text is not a
 * workbook at all. Plan 02 requires that we never disguise binary Office content as text
 * and never hand it to a text bundler, so detection is by magic bytes first.
 */

export type OfficeKind = 'word' | 'spreadsheet' | 'presentation'

/** How the file is actually stored, not what it is called. */
export type OfficeContainer = 'ooxml' | 'ole' | 'pdf' | 'unknown'

export interface OfficeFileInfo {
  kind: OfficeKind | null
  container: OfficeContainer
  /** True only when Nexus has a local extractor for this container/kind combination. */
  locallyReadable: boolean
  /** Human-readable reason, safe to show in the UI. */
  reason: string
}

const EXTENSION_KIND: Record<string, OfficeKind> = {
  '.doc': 'word',
  '.docx': 'word',
  '.docm': 'word',
  '.dot': 'word',
  '.dotx': 'word',
  '.ppt': 'presentation',
  '.pptx': 'presentation',
  '.pptm': 'presentation',
  '.pps': 'presentation',
  '.ppsx': 'presentation',
  '.pot': 'presentation',
  '.potx': 'presentation',
  '.xls': 'spreadsheet',
  '.xlsx': 'spreadsheet',
  '.xlsm': 'spreadsheet',
  '.xlsb': 'spreadsheet',
  '.xlt': 'spreadsheet',
  '.xltx': 'spreadsheet'
}

export function officeKindFromExtension(ext: string): OfficeKind | null {
  return EXTENSION_KIND[ext.toLowerCase()] ?? null
}

export function isOfficeExtension(ext: string): boolean {
  return officeKindFromExtension(ext) !== null
}

const OOXML_MAGIC = [0x50, 0x4b, 0x03, 0x04] // "PK\x03\x04"
const OOXML_EMPTY_MAGIC = [0x50, 0x4b, 0x05, 0x06] // empty archive
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46] // "%PDF"

const startsWith = (buffer: Uint8Array, magic: number[]): boolean =>
  buffer.length >= magic.length && magic.every((byte, index) => buffer[index] === byte)

/**
 * Inspect the first bytes of a file.
 *
 * `head` should be at least 8 bytes; more is fine and unused.
 */
export function detectOfficeFile(fileName: string, head: Uint8Array): OfficeFileInfo {
  const dot = fileName.lastIndexOf('.')
  const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : ''
  const kind = officeKindFromExtension(ext)

  if (startsWith(head, PDF_MAGIC)) {
    return {
      kind,
      container: 'pdf',
      locallyReadable: false,
      reason: 'This file is already a PDF; no Office conversion is needed.'
    }
  }

  if (startsWith(head, OOXML_MAGIC) || startsWith(head, OOXML_EMPTY_MAGIC)) {
    if (!kind) {
      return {
        kind: null,
        container: 'ooxml',
        locallyReadable: false,
        reason:
          'This is a ZIP-based (OOXML) file but the extension does not say which Office type it is.'
      }
    }
    return {
      kind,
      container: 'ooxml',
      locallyReadable: true,
      reason:
        kind === 'spreadsheet'
          ? 'Excel workbook in OOXML format — readable locally without any external service.'
          : 'OOXML document — readable locally without any external service.'
    }
  }

  if (startsWith(head, CFB_MAGIC)) {
    // CFB is either the legacy binary format, or an OOXML file protected by a password
    // (Office wraps encrypted OOXML in a CFB container).
    return {
      kind,
      container: 'ole',
      locallyReadable: false,
      reason: kind
        ? `This is a legacy binary (${ext}) or a password-protected Office file. Nexus has no local reader for that container, so it will offer the original file instead of guessing.`
        : 'Legacy or password-protected Office container; no local reader.'
    }
  }

  return {
    kind,
    container: 'unknown',
    locallyReadable: false,
    reason: kind
      ? `The ".${ext.slice(1)}" extension says Office, but the file does not look like one (it may be renamed, corrupt, or plain text).`
      : 'Not an Office document.'
  }
}
