/**
 * Pure helpers for intelligent duplicate-file variant detection during folder uploads.
 * Only groups files that share the same directory after normalizing path separators.
 */

export type VariantKind = 'ai-companion' | 'backup' | 'copy'

export interface FileInfo {
  relativePath: string
  /** Path separator normalized to `/` for comparison only — original preserved separately */
  normalizedRelativePath: string
  fileName: string
  baseName: string
  extension: string
}

/** Suffix patterns recognized as explicit backup variants */
const BACKUP_SUFFIX_PATTERNS: RegExp[] = [
  /\.bak\d*$/i,
  /\.backup$/i,
  /\.old$/i,
  /\.orig$/i,
  /\.tmp$/i
]

/** AI companion nicknames — case-insensitive match between name and extension */
const AI_COMPANION_NICKNAMES = ['gemini', 'claude', 'chatgpt']

/** Explicit copy-word forms before the extension dot */
const COPY_KINDS = ['_copy', '-copy', ' copy']

/** Explicit parenthetical-copy pattern like `main (1).tsx`, `main (2).tsx` */
const PAREN_COPY_RE = /\s*\(\d+\)\./

/** Variant rank for tie-breaking preferred selection (lower = more preferred) */
const VARIANT_RANK: Record<VariantKind, number> = {
  'ai-companion': 1,
  copy: 2,
  backup: 3
}

/**
 * Parse a relative path into its component parts (normalized).
 * Returns null if the path looks malformed.
 */
function parseFileInfo(relativePath: string): FileInfo | null {
  const normalized = relativePath.replace(/\\/g, '/')
  const parts = normalized.split('/')
  const fileName = parts[parts.length - 1]
  if (!fileName || fileName.includes('/')) return null

  const lastDotIdx = fileName.lastIndexOf('.')
  if (lastDotIdx <= 0) {
    return { relativePath, normalizedRelativePath: normalized, fileName, baseName: fileName, extension: '' }
  }
  const baseName = fileName.slice(0, lastDotIdx)
  const extension = fileName.slice(lastDotIdx)
  return { relativePath, normalizedRelativePath: normalized, fileName, baseName, extension }
}

/**
 * Classify what kind of variant a filename represents relative to its base.
 * Returns null if it looks like a standalone/primary file.
 */
function classifyVariant(file: FileInfo): VariantKind | null {
  const { baseName, fileName } = file

  // Check backup suffixes (.bak, .bak2, .backup, .old, .orig, .tmp)
  for (const re of BACKUP_SUFFIX_PATTERNS) {
    if (re.test(fileName)) return 'backup'
  }

  // Check AI companion nicknames inserted before the extension
  const lowerBase = baseName.toLowerCase()
  for (const nick of AI_COMPANION_NICKNAMES) {
    const pattern = new RegExp(`(?:^|[-_.])${nick}(?:$|[.-])`, 'i')
    if (pattern.test(lowerBase)) return 'ai-companion'
  }

  // Check copy kinds: _copy, -copy, " copy" — match at end of baseName only
  for (const kind of COPY_KINDS) {
    if (lowerBase.endsWith(kind)) return 'copy'
  }

  // Parenthetical copy: main (1).tsx → base "main", kind "copy"
  if (PAREN_COPY_RE.test(fileName)) return 'copy'

  return null
}

/**
 * Extract the canonical base name from a filename.
 * For primary files this is the full fileName; for variants it strips the marker
 * and preserves the original extension so all members of a group share the same key.
 */
function canonicalBase(file: FileInfo, kind: VariantKind | null): string {
  if (!kind) return file.fileName.toLowerCase()
  if (kind === 'backup') {
    // Backup suffix sits after the original extension: main.tsx.bak → main.tsx
    return file.fileName.replace(/(\.bak\d*|\.backup|\.old|\.orig|\.tmp)$/i, '').toLowerCase()
  }
  if (kind === 'ai-companion') {
    let base = file.baseName.toLowerCase()
    for (const nick of AI_COMPANION_NICKNAMES) {
      base = base.replace(new RegExp(`[-_.]${nick}(?:$|[.-])`, 'gi'), '')
    }
    return base + file.extension
  }
  if (kind === 'copy') {
    let base = file.baseName.toLowerCase()
    base = base.replace(/\s*\(\d+\)$/, '')
    for (const c of COPY_KINDS) {
      const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s/g, '\\s')
      base = base.replace(new RegExp(`${escaped}$`, 'i'), '')
    }
    return base + file.extension
  }
  return file.fileName.toLowerCase()
}

/**
 * Given a list of scanned files, annotate each with variant metadata and group likely duplicates.
 * Returns the annotated array (entries mutated in place).
 *
 * Rules:
 * - Same directory only (enforced via directory path key)
 * - Case-insensitive matching
 * - Preferred selection: exact canonical > shorter baseName > lexicographic fileName
 * - Standalone file with no sibling variants is left unmarked
 * - Already-sensitive files keep their removalReason untouched
 */
export function annotateFileVariants(files: Array<{
  path: string
  relativePath: string
  size: number
  extension: string
  isSuggestedRemoval: boolean
  removalReason?: string
  variantOf?: string
  variantKind?: VariantKind
  isPreferredVariant?: boolean
}>): typeof files {
  type Entry = { info: FileInfo; kind: VariantKind | null; canonical: string; dirKey: string; idx: number }
  const dirGroups = new Map<string, Entry[]>()

  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const info = parseFileInfo(f.relativePath)
    if (!info) continue
    const kind = classifyVariant(info)
    const canonical = canonicalBase(info, kind)
    // Directory key = everything except the final filename component
    const dirKey = info.normalizedRelativePath.split('/').slice(0, -1).join('/') || '/'
    let bucket = dirGroups.get(dirKey)
    if (!bucket) {
      bucket = []
      dirGroups.set(dirKey, bucket)
    }
    bucket.push({ info, kind, canonical, dirKey, idx: i })
  }

  for (const entries of dirGroups.values()) {
    const byCanonical = new Map<string, Entry[]>()
    for (const e of entries) {
      let bucket = byCanonical.get(e.canonical)
      if (!bucket) {
        bucket = []
        byCanonical.set(e.canonical, bucket)
      }
      bucket.push(e)
    }

    for (const group of byCanonical.values()) {
      if (group.length <= 1) continue
      // Sort: primary first, then by rank, then shorter baseName, then lex fileName
      group.sort((a, b) => {
        if (a.kind === null && b.kind !== null) return -1
        if (a.kind !== null && b.kind === null) return 1
        if (a.kind && b.kind && a.kind !== b.kind) {
          return (VARIANT_RANK[a.kind] ?? 9) - (VARIANT_RANK[b.kind] ?? 9)
        }
        if (a.info.baseName.length !== b.info.baseName.length) {
          return a.info.baseName.length - b.info.baseName.length
        }
        return a.info.fileName.localeCompare(b.info.fileName)
      })
      const preferred = group[0]
      const preferredFileName = preferred.info.fileName
      files[preferred.idx].isPreferredVariant = true
      for (let j = 1; j < group.length; j++) {
        const v = group[j]
        const target = files[v.idx]
        target.isSuggestedRemoval = true
        target.variantOf = preferred.info.relativePath
        target.variantKind = v.kind ?? undefined
        target.isPreferredVariant = false
        if (!target.removalReason) {
          const label = v.kind === 'backup' ? 'Backup' : v.kind === 'copy' ? 'Copy' : 'AI companion'
          target.removalReason = `Possible ${label} variant of ${preferredFileName}`
        }
      }
    }
  }

  return files
}

/** Count how many files are suggested for removal specifically due to variant detection */
export function countSuggestedVariantRemovals(files: { variantKind?: VariantKind; isSuggestedRemoval: boolean }[]): number {
  return files.filter(f => f.isSuggestedRemoval && f.variantKind != null).length
}
