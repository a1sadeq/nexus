import { describe, expect, it, vi } from 'vitest'
import {
  PART_SIZE_STORAGE_KEY,
  estimatePartCount,
  loadPartSizeMb,
  partBytesFor,
  savePartSizeMb,
  type PartSizeStore
} from './uploadPartSize'
import { DEFAULT_UPLOAD_PART_SIZE_MB } from '../../../shared/folderUpload'

/**
 * Build 54 — the part size is remembered, and a bad memory costs nothing.
 *
 * A remembered preference is one of the few places an app can turn a stale value into a failed upload: a
 * number written by an older build, a store that is full, a document with storage disabled. Each of those
 * has to end in a working upload at a real size, not in an exception or a 0 MB part.
 */

function memoryStore(initial?: Record<string, string>): PartSizeStore & { data: Record<string, string> } {
  const data = { ...(initial ?? {}) }
  return {
    data,
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = value
    }
  }
}

describe('remembering the choice', () => {
  it('starts at the default when nothing has been stored', () => {
    expect(loadPartSizeMb(memoryStore())).toBe(DEFAULT_UPLOAD_PART_SIZE_MB)
  })

  it('reads back what was stored', () => {
    expect(loadPartSizeMb(memoryStore({ [PART_SIZE_STORAGE_KEY]: '20' }))).toBe(20)
  })

  it('snaps a value an older build wrote onto an offered size', () => {
    // The drawer used to offer 8 MB, so a real user's store can contain it.
    expect(loadPartSizeMb(memoryStore({ [PART_SIZE_STORAGE_KEY]: '8' }))).toBe(10)
  })

  it('survives a corrupt stored value', () => {
    expect(loadPartSizeMb(memoryStore({ [PART_SIZE_STORAGE_KEY]: 'null' }))).toBe(
      DEFAULT_UPLOAD_PART_SIZE_MB
    )
    expect(loadPartSizeMb(memoryStore({ [PART_SIZE_STORAGE_KEY]: '-3' }))).toBe(
      DEFAULT_UPLOAD_PART_SIZE_MB
    )
  })

  it('writes what it returns, so the control and the stored value cannot disagree', () => {
    const store = memoryStore()
    expect(savePartSizeMb(store, 15)).toBe(15)
    expect(store.data[PART_SIZE_STORAGE_KEY]).toBe('15')
    expect(savePartSizeMb(store, 8)).toBe(10)
    expect(store.data[PART_SIZE_STORAGE_KEY]).toBe('10')
  })

  it('still answers with a usable size when the store throws', () => {
    const hostile: PartSizeStore = {
      getItem: () => {
        throw new Error('storage disabled')
      },
      setItem: () => {
        throw new Error('quota exceeded')
      }
    }
    expect(loadPartSizeMb(hostile)).toBe(DEFAULT_UPLOAD_PART_SIZE_MB)
    expect(savePartSizeMb(hostile, 25)).toBe(25)
  })

  it('works with no store at all', () => {
    expect(loadPartSizeMb(null)).toBe(DEFAULT_UPLOAD_PART_SIZE_MB)
    expect(savePartSizeMb(null, 5)).toBe(5)
  })

  it('never lets a write of a bad value reach the store', () => {
    const store = memoryStore()
    const spy = vi.spyOn(store, 'setItem')
    savePartSizeMb(store, Number.NaN)
    expect(spy).toHaveBeenCalledWith(PART_SIZE_STORAGE_KEY, String(DEFAULT_UPLOAD_PART_SIZE_MB))
  })
})

describe('what the user sees', () => {
  it('turns the chosen size into the byte count the partitioner takes', () => {
    expect(partBytesFor(5)).toBe(5 * 1024 * 1024)
    expect(partBytesFor(25)).toBe(25 * 1024 * 1024)
  })

  it('estimates the part count for the selection, and says one part before anything is picked', () => {
    const fortyMb = 40 * 1024 * 1024
    expect(estimatePartCount(fortyMb, 5)).toBe(8)
    expect(estimatePartCount(fortyMb, 10)).toBe(4)
    expect(estimatePartCount(fortyMb, 25)).toBe(2)
    expect(estimatePartCount(0, 10)).toBe(0)
    expect(estimatePartCount(1, 25)).toBe(1)
  })

  it('never estimates zero parts for a selection that exists', () => {
    expect(estimatePartCount(1, 25)).toBeGreaterThan(0)
  })
})
