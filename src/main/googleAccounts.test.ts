import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_ACCOUNT_ID,
  DEFAULT_PARTITION,
  GoogleAccountStore,
  defaultAccount,
  partitionForAccount,
  sanitiseAccountId
} from './googleAccounts'

// atomicWriteJson imports electron for `app`; the store never calls anything that needs it, but the
// module is loaded on import.
import { vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/nexus-test-data') } }))

describe('partitionForAccount', () => {
  it('keeps the default account on the partition every AI tab already uses', () => {
    expect(partitionForAccount(DEFAULT_ACCOUNT_ID)).toBe(DEFAULT_PARTITION)
    expect(DEFAULT_PARTITION).toBe('persist:ai-shared')
    expect(defaultAccount().partition).toBe(DEFAULT_PARTITION)
  })

  it('gives every other account its own partition', () => {
    const work = partitionForAccount('work')
    const personal = partitionForAccount('personal')

    expect(work).toBe('persist:ai-account-work')
    expect(personal).toBe('persist:ai-account-personal')
    expect(work).not.toBe(personal)
  })

  it('is stable for the same id and collapses junk to something Electron accepts', () => {
    expect(partitionForAccount('Work')).toBe(partitionForAccount('work'))
    expect(partitionForAccount('a b/c')).toBe('persist:ai-account-a-b-c')
    // An id that sanitises to nothing falls back to the shared store rather than inventing one.
    expect(partitionForAccount('///')).toBe(DEFAULT_PARTITION)
  })
})

describe('sanitiseAccountId', () => {
  it('accepts letters, digits, dash and underscore', () => {
    expect(sanitiseAccountId('work')).toBe('work')
    expect(sanitiseAccountId('Work_2-personal')).toBe('work_2-personal')
  })

  it('rejects anything that cannot be a partition name', () => {
    expect(sanitiseAccountId('')).toBeNull()
    expect(sanitiseAccountId('   ')).toBeNull()
    expect(sanitiseAccountId('---')).toBeNull()
    expect(sanitiseAccountId('x'.repeat(41))).toBeNull()
  })
})

describe('GoogleAccountStore', () => {
  let dir: string
  let file: string
  let store: GoogleAccountStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nexus-accounts-'))
    file = join(dir, 'google-accounts.json')
    let clock = 1000
    store = new GoogleAccountStore(file, () => (clock += 1))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('always lists the default account first, even with no file at all', () => {
    const list = store.list()

    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: DEFAULT_ACCOUNT_ID, partition: DEFAULT_PARTITION })
    expect(store.get(DEFAULT_ACCOUNT_ID)).not.toBeNull()
  })

  it('adds an account with its own partition, and survives a reload', () => {
    const { account } = store.add('Work')

    expect(account).toMatchObject({ id: 'work', label: 'Work', partition: 'persist:ai-account-work' })

    const reloaded = new GoogleAccountStore(file)
    expect(reloaded.list().map((a) => a.id)).toEqual(['default', 'work'])
    expect(reloaded.get('work')?.label).toBe('Work')
  })

  it('keeps ids unique so two accounts never share a cookie store', () => {
    store.add('Work')
    const second = store.add('Work')

    expect(second.account?.id).toBe('work-2')
    expect(second.account?.partition).not.toBe(store.get('work')?.partition)
    expect(store.list()).toHaveLength(3)
  })

  it('refuses an empty name rather than creating an unnamed store', () => {
    expect(store.add('   ').error).toMatch(/name/i)
    expect(store.list()).toHaveLength(1)
  })

  it('removes an added account but never the default one', () => {
    store.add('Work')

    expect(store.remove(DEFAULT_ACCOUNT_ID)).toMatchObject({ removed: false })
    expect(store.remove('work')).toMatchObject({ removed: true })
    expect(store.list().map((a) => a.id)).toEqual(['default'])
    expect(store.remove('work')).toMatchObject({ removed: false })
  })

  it('loses the extra accounts, not the default one, when the file is corrupt', () => {
    writeFileSync(file, '{ not json')
    const list = store.list()

    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(DEFAULT_ACCOUNT_ID)
  })

  it('normalises ids from a hand-edited file and ignores a stored default', () => {
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        accounts: [
          { id: 'work', label: 'Work', createdAt: 1 },
          { id: 'bad id!//', label: 'Bad', createdAt: 2 },
          { id: DEFAULT_ACCOUNT_ID, label: 'Impostor', createdAt: 3 }
        ]
      })
    )

    expect(store.list().map((a) => a.id)).toEqual(['default', 'work', 'bad-id'])
  })

  it('writes a file that only holds the added accounts', () => {
    store.add('Work')

    const written = JSON.parse(readFileSync(file, 'utf8'))
    expect(written.accounts.map((a: { id: string }) => a.id)).toEqual(['work'])
  })
})
