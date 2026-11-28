import {
  DEFAULT_UPLOAD_PART_SIZE_MB,
  UPLOAD_PART_SIZE_MB,
  normalisePartSizeMb,
  partSizeBytes,
  type UploadPartSizeMb
} from '../../../shared/folderUpload'

/**
 * The part size the upload popup offers, and remembers.
 *
 * The size was already selectable — but only inside the Chunks & Parts drawer, which is a different panel
 * with a different purpose ("show me what will be attached"), so choosing how your folder gets cut up
 * meant leaving the upload you were in the middle of. It is now on the upload popup itself, with the
 * sizes the user asked for, and the choice survives the app being closed.
 *
 * Kept out of the component so it can be tested without a DOM, and so there is exactly one place that
 * decides what a remembered value means.
 */

export const PART_SIZE_STORAGE_KEY = 'nexus.upload.partSizeMb'

/** The offered sizes, re-exported so the UI never keeps its own copy that could drift. */
export { UPLOAD_PART_SIZE_MB, DEFAULT_UPLOAD_PART_SIZE_MB }
export type { UploadPartSizeMb }

/** The slice of `localStorage` this module needs — narrow so a test can pass a plain object. */
export interface PartSizeStore {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

/**
 * The browser's storage, if it can be touched at all.
 *
 * Reading `localStorage` itself throws in a document with storage disabled, so even the lookup is guarded
 * — a storage problem must cost the user a preference, never the upload.
 */
function defaultStore(): PartSizeStore | null {
  try {
    const scope = globalThis as unknown as { localStorage?: PartSizeStore }
    if (!scope.localStorage) return null
    // Touch it: Node 22 defines a `localStorage` global that throws on use unless the process was started
    // with `--localstorage-file`.
    scope.localStorage.getItem(PART_SIZE_STORAGE_KEY)
    return scope.localStorage
  } catch {
    return null
  }
}

/**
 * The part size to start with: what was last chosen, or the default.
 *
 * Anything that is not an offered size snaps to the nearest one, so a value written by an older build
 * (the drawer used to offer 8 MB) still opens the popup on something valid instead of on nothing selected.
 */
export function loadPartSizeMb(store?: PartSizeStore | null): UploadPartSizeMb {
  const target = store === undefined ? defaultStore() : store
  if (!target) return DEFAULT_UPLOAD_PART_SIZE_MB
  try {
    const raw = target.getItem(PART_SIZE_STORAGE_KEY)
    return normalisePartSizeMb(raw)
  } catch {
    return DEFAULT_UPLOAD_PART_SIZE_MB
  }
}

/**
 * Remember a choice, and answer with what was actually stored.
 *
 * The return value is the normalised size, so the caller can set state from it and the control and the
 * partitioner can never disagree about what was chosen.
 */
export function savePartSizeMb(
  store: PartSizeStore | null | undefined,
  mb: unknown
): UploadPartSizeMb {
  const normalised = normalisePartSizeMb(mb)
  const target = store === undefined ? defaultStore() : store
  if (!target) return normalised
  try {
    target.setItem(PART_SIZE_STORAGE_KEY, String(normalised))
  } catch {
    /* a full or disabled store costs the preference, not the upload */
  }
  return normalised
}

/** Bytes for the partitioner, from the MB the control shows. */
export function partBytesFor(mb: unknown): number {
  return partSizeBytes(mb)
}

/**
 * How many parts the current selection would arrive as.
 *
 * Shown next to the control so the size is a decision rather than a number: 40 MB of source at 5 MB is
 * eight parts, at 25 MB it is two. It is an estimate — the real count comes from the partitioner, which
 * also has to keep whole files and headers in mind — and it is labelled as one.
 */
export function estimatePartCount(totalBytes: number, mb: unknown): number {
  const size = partSizeBytes(mb)
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return 0
  return Math.max(1, Math.ceil(totalBytes / size))
}
