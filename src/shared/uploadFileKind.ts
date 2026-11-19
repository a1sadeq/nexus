/**
 * Upload file-kind classification (Nexus upload plan 03).
 *
 * Folder uploads previously dropped every binary extension before the review modal, so images,
 * PDFs, Office documents and video were silently invisible. Files are now listed and classified,
 * and delivery is decided by kind: text is bundled into parts, everything else is attached as the
 * original file rather than being decoded into a text bundle.
 *
 * Extension mapping is a routing hint, not a security or capability guarantee.
 */

export type UploadFileKind = 'text' | 'image' | 'document' | 'video' | 'audio' | 'archive' | 'binary'

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.tif',
  '.tiff',
  '.avif',
  '.heic'
])

const DOCUMENT_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.odt',
  '.rtf',
  '.xls',
  '.xlsx',
  '.ods',
  '.ppt',
  '.pptx',
  '.odp',
  '.epub'
])

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.mpg', '.mpeg'])

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.flac', '.aac', '.opus'])

const ARCHIVE_EXTENSIONS = new Set(['.zip', '.gz', '.tgz', '.tar', '.7z', '.rar', '.bz2', '.xz'])

const BINARY_EXTENSIONS = new Set([
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.node',
  '.class',
  '.jar',
  '.wasm',
  '.bin',
  '.dat',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.eot',
  '.psd',
  '.blend',
  '.fbx',
  '.glb',
  '.gltf'
])

/** Extensions that are textual even though they may look like markup or assets. */
const FORCED_TEXT_EXTENSIONS = new Set(['.svg', '.svgz'])

function normalized(extension: string): string {
  if (!extension) return ''
  const ext = extension.startsWith('.') ? extension : `.${extension}`
  return ext.toLowerCase()
}

/** Maps an extension to a delivery kind. Unknown extensions default to text. */
export function classifyUploadKind(extension: string): UploadFileKind {
  const ext = normalized(extension)
  if (FORCED_TEXT_EXTENSIONS.has(ext)) return 'text'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio'
  if (ARCHIVE_EXTENSIONS.has(ext)) return 'archive'
  if (BINARY_EXTENSIONS.has(ext)) return 'binary'
  return 'text'
}

/** Same as classifyUploadKind, but a null byte in an unknown-type file marks it binary. */
export function classifyUploadKindWithSniff(extension: string, hasNullByte: boolean): UploadFileKind {
  const kind = classifyUploadKind(extension)
  if (kind === 'text' && hasNullByte) return 'binary'
  return kind
}

export function isTextKind(kind: UploadFileKind): boolean {
  return kind === 'text'
}

/** True when the file must be attached as the original bytes instead of bundled as text. */
export function requiresOriginalAttachment(kind: UploadFileKind): boolean {
  return !isTextKind(kind)
}

/** Human label used in the review modal and progress messages. */
export function kindLabel(kind: UploadFileKind): string {
  switch (kind) {
    case 'image':
      return 'Image'
    case 'document':
      return 'Document'
    case 'video':
      return 'Video'
    case 'audio':
      return 'Audio'
    case 'archive':
      return 'Archive'
    case 'binary':
      return 'Binary'
    default:
      return 'Text'
  }
}

/**
 * What the user should expect for this kind. Never claims provider acceptance — only how Nexus
 * will hand the file over.
 */
export function deliveryHint(kind: UploadFileKind): string {
  switch (kind) {
    case 'image':
      return 'Attached as the original image'
    case 'document':
      return 'Attached as the original document'
    case 'video':
      return 'Attached as the original video (provider support varies)'
    case 'audio':
      return 'Attached as the original audio (provider support varies)'
    case 'archive':
      return 'Attached as the original archive; the AI cannot open it'
    case 'binary':
      return 'Attached as-is; most providers cannot read this type'
    default:
      return 'Bundled as text'
  }
}

/** Kinds that should be excluded from a text bundle but can still be attached. */
export function isAttachableOriginal(kind: UploadFileKind): boolean {
  return requiresOriginalAttachment(kind)
}
