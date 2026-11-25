import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CONTAINER_PALETTE,
  ContainerStore,
  DEFAULT_CONTAINER_ID,
  containerForShortcutDigit,
  containerIdFromName,
  containerPartition,
  containerShortcutIndex,
  defaultContainer,
  normaliseContainerColor,
  paletteColorAt
} from './containers'
import { DEFAULT_PARTITION } from './googleAccounts'

describe('normaliseContainerColor', () => {
  it('accepts hex and canonicalises it', () => {
    expect(normaliseContainerColor('#F43F5E')).toBe('#f43f5e')
    expect(normaliseContainerColor('f43f5e')).toBe('#f43f5e')
    expect(normaliseContainerColor('#abc')).toBe('#aabbcc')
    // Alpha is dropped: opacity is the aura's own business.
    expect(normaliseContainerColor('#f43f5e80')).toBe('#f43f5e')
  })

  it('refuses anything that could escape a CSS string', () => {
    expect(normaliseContainerColor('red; } body { display:none')).toBeUndefined()
    expect(normaliseContainerColor('rgb(1,2,3)')).toBeUndefined()
    expect(normaliseContainerColor('var(--accent)')).toBeUndefined()
    expect(normaliseContainerColor('')).toBeUndefined()
    expect(normaliseContainerColor(null)).toBeUndefined()
    expect(normaliseContainerColor(123)).toBeUndefined()
  })
})

describe('containerPartition', () => {
  it('keeps the default container on the partition older tabs already use', () => {
    expect(containerPartition(defaultContainer())).toBe(DEFAULT_PARTITION)
    expect(containerPartition(null)).toBe(DEFAULT_PARTITION)
  })

  it('gives a container the store of the account it points at', () => {
    expect(containerPartition({ accountId: 'work' })).toBe('persist:ai-account-work')
    // Two containers may share one account; they then share one sign-in, which is the point.
    expect(containerPartition({ accountId: 'work' })).toBe(containerPartition({ accountId: 'work' }))
  })
})

describe('containerIdFromName', () => {
  it('derives a partition-safe id', () => {
    expect(containerIdFromName('Work')).toBe('work')
    expect(containerIdFromName('Client X / Q4')).toBe('client-x-q4')
  })

  it('refuses names that would collide with the implicit container or produce no id', () => {
    expect(containerIdFromName('Default')).toBeNull()
    expect(containerIdFromName('  ')).toBeNull()
    expect(containerIdFromName('///')).toBeNull()
  })
})

describe('containerForShortcutDigit', () => {
  const list = [
    { ...defaultContainer() },
    { id: 'work', name: 'Work', accountId: 'work', createdAt: 1 },
    { id: 'lab', name: 'Lab', accountId: 'work', createdAt: 2 }
  ]

  it('maps Ctrl+Alt+N to the Nth container, default first', () => {
    expect(containerForShortcutDigit(list, '1')?.id).toBe(DEFAULT_CONTAINER_ID)
    expect(containerForShortcutDigit(list, '2')?.id).toBe('work')
    expect(containerForShortcutDigit(list, '3')?.id).toBe('lab')
  })

  it('treats 0 as the first container', () => {
    expect(containerForShortcutDigit(list, '0')?.id).toBe(DEFAULT_CONTAINER_ID)
  })

  it('returns null for a digit that has no container, so the caller can say so', () => {
    expect(containerForShortcutDigit(list, '4')).toBeNull()
    expect(containerForShortcutDigit(list, '9')).toBeNull()
    expect(containerForShortcutDigit(list, '')).toBeNull()
    expect(containerForShortcutDigit(list, 'x')).toBeNull()
    // One container in total: every digit but 1 and 0 is empty, which is the common case at first.
    const only = [{ ...defaultContainer() }]
    expect(containerForShortcutDigit(only, '2')).toBeNull()
  })
})

describe('containerShortcutIndex', () => {
  it('numbers containers from 1, default first', () => {
    const list = [
      { ...defaultContainer() },
      { id: 'work', name: 'Work', accountId: 'work', createdAt: 1 },
      { id: 'lab', name: 'Lab', accountId: 'work', createdAt: 2 }
    ]
    expect(containerShortcutIndex(list, DEFAULT_CONTAINER_ID)).toBe(1)
    expect(containerShortcutIndex(list, 'lab')).toBe(3)
    expect(containerShortcutIndex(list, 'nope')).toBe(0)
  })
})

describe('ContainerStore', () => {
  let dir: string
  let file: string
  let store: ContainerStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nexus-containers-'))
    file = join(dir, 'containers.json')
    let clock = 500
    store = new ContainerStore(file, () => (clock += 1))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('always lists the default container first', () => {
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0]).toMatchObject({ id: DEFAULT_CONTAINER_ID, accountId: 'default' })
  })

  it('creates a container with a colour and accounts binding, and reloads it', () => {
    const { container } = store.save({ name: 'Work', color: '#f43f5e', accountId: 'work' })

    expect(container).toMatchObject({
      id: 'work',
      name: 'Work',
      color: '#f43f5e',
      accountId: 'work'
    })

    const reloaded = new ContainerStore(file)
    expect(reloaded.list().map((c) => c.id)).toEqual(['default', 'work'])
    expect(reloaded.get('work')?.color).toBe('#f43f5e')
  })

  it('keeps ids unique so two containers never share one identity', () => {
    store.save({ name: 'Work' })
    const second = store.save({ name: 'Work' })

    expect(second.container?.id).toBe('work-2')
    expect(store.list()).toHaveLength(3)
  })

  it('renames and recolours in place without moving the id', () => {
    store.save({ name: 'Work', color: '#f43f5e' })
    const { container } = store.save({ id: 'work', name: 'Day Job', color: '#06b6d4' })

    // The id is what tabs and cookie stores are keyed by; a rename must not change it.
    expect(container).toMatchObject({ id: 'work', name: 'Day Job', color: '#06b6d4' })
    expect(store.list().map((c) => c.id)).toEqual(['default', 'work'])
  })

  it('clears a colour when asked to', () => {
    store.save({ name: 'Work', color: '#f43f5e' })
    const { container } = store.save({ id: 'work', name: 'Work', color: null })

    expect(container?.color).toBeUndefined()
    expect('color' in (store.get('work') ?? {})).toBe(false)
  })

  it('lets the default container be coloured and renamed, but never deleted', () => {
    const { container } = store.save({ id: DEFAULT_CONTAINER_ID, name: 'Main', color: '#10b981' })

    expect(container).toMatchObject({ id: 'default', name: 'Main', color: '#10b981' })
    expect(new ContainerStore(file).get(DEFAULT_CONTAINER_ID)?.color).toBe('#10b981')
    expect(store.remove(DEFAULT_CONTAINER_ID)).toMatchObject({ removed: false })
  })

  it('rejects empty and over-long names, and unknown updates', () => {
    expect(store.save({ name: '   ' }).error).toMatch(/name/i)
    expect(store.save({ name: 'x'.repeat(41) }).error).toMatch(/40/)
    expect(store.save({ id: 'ghost', name: 'Ghost' }).error).toMatch(/No such container/)
    expect(store.list()).toHaveLength(1)
  })

  it('deletes a container, and says so when there is nothing to delete', () => {
    store.save({ name: 'Work' })

    expect(store.remove('work')).toMatchObject({ removed: true })
    expect(store.list().map((c) => c.id)).toEqual(['default'])
    expect(store.remove('work')).toMatchObject({ removed: false })
  })

  it('loses extra containers, not the default one, when the file is corrupt', () => {
    writeFileSync(file, '{ not json')
    expect(store.list().map((c) => c.id)).toEqual(['default'])
  })

  it('drops unusable entries from a hand-edited file and repairs the rest', () => {
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        containers: [
          { id: 'work', name: 'Work', accountId: 'work', createdAt: 1 },
          { id: 'bad id!//', name: 'Bad', accountId: 'nope!!', createdAt: 2 },
          { id: DEFAULT_CONTAINER_ID, name: 'Impostor', accountId: 'x', createdAt: 3 },
          { id: 'work', name: 'Duplicate', accountId: 'x', createdAt: 4 }
        ]
      })
    )

    const list = store.list()
    // The duplicate and the impostor default are dropped; junk ids are normalised, not lost.
    expect(list.map((c) => c.id)).toEqual(['default', 'work', 'bad-id'])
    // An account reference is sanitised into a usable id. Whether that account exists is checked
    // where the accounts are known (the IPC layer); the store cannot know them.
    expect(list[2].accountId).toBe('nope')
    expect(list[0].accountId).toBe('default')
  })

  it('gives every signed-in account a container, and only once', () => {
    const accounts = [
      { id: 'default', label: 'Default' },
      { id: '2016', label: '2016' },
      { id: 'amrelsadekae', label: 'amrelsadekae' }
    ]

    const first = store.syncWithAccounts(accounts)
    expect(first.created.map((c) => c.id)).toEqual(['2016', 'amrelsadekae'])
    expect(first.containers.map((c) => c.id)).toEqual(['default', '2016', 'amrelsadekae'])
    // Generated colours come from the same palette the picker offers.
    expect(CONTAINER_PALETTE).toContain(first.created[0].color)

    // Idempotent: a second look creates nothing.
    const second = new ContainerStore(file).syncWithAccounts(accounts)
    expect(second.created).toHaveLength(0)
    expect(second.containers).toHaveLength(3)
  })

  it('does not duplicate an account that a hand-made container already uses', () => {
    store.save({ name: 'Day job', accountId: '2016' })
    const { created } = store.syncWithAccounts([{ id: '2016', label: '2016' }])

    expect(created).toHaveLength(0)
    expect(store.list().filter((c) => c.accountId === '2016')).toHaveLength(1)
  })

  it('keeps a deleted account-container deleted instead of recreating it', () => {
    const accounts = [{ id: '2016', label: '2016' }]
    store.syncWithAccounts(accounts)
    expect(store.remove('2016')).toMatchObject({ removed: true })

    // Without the memory of the deletion this would come back on every open of the switcher.
    expect(store.syncWithAccounts(accounts).created).toHaveLength(0)
    expect(store.list().map((c) => c.id)).toEqual(['default'])
  })

  it('gives distinct containers distinct partitions per account', () => {
    const { containers } = store.syncWithAccounts([
      { id: '2016', label: '2016' },
      { id: 'acc', label: 'acc' }
    ])
    const partitions = containers.map((c) => containerPartition(c))

    expect(partitions).toEqual([
      'persist:ai-shared',
      'persist:ai-account-2016',
      'persist:ai-account-acc'
    ])
    expect(new Set(partitions).size).toBe(3)
  })

  it('rotates palette colours instead of giving every account the same one', () => {
    expect(paletteColorAt(0)).not.toBe(paletteColorAt(1))
    expect(paletteColorAt(CONTAINER_PALETTE.length)).toBe(paletteColorAt(0))
    expect(paletteColorAt(-1)).toBe(paletteColorAt(CONTAINER_PALETTE.length - 1))
  })

  it('writes only the extra containers to the main file', () => {
    store.save({ name: 'Work', color: '#f43f5e' })

    const written = JSON.parse(readFileSync(file, 'utf8'))
    expect(written.containers.map((c: { id: string }) => c.id)).toEqual(['work'])
    expect(written.containers[0].color).toBe('#f43f5e')
  })

  describe('reorder', () => {
    const ids = (list: Array<{ id: string }>): string[] => list.map((c) => c.id)

    function seed(): void {
      store.save({ name: 'Work', accountId: 'work' })
      store.save({ name: 'Lab', accountId: 'lab' })
      store.save({ name: 'Client', accountId: 'client' })
    }

    it('reports the order the user chose, and reloads it from disk', () => {
      seed()
      expect(ids(store.list())).toEqual([DEFAULT_CONTAINER_ID, 'work', 'lab', 'client'])

      store.reorder(['work', 'default', 'client', 'lab'])

      expect(ids(store.list())).toEqual(['work', DEFAULT_CONTAINER_ID, 'client', 'lab'])
      // A second store over the same file: order is persisted, not remembered in memory.
      const reopened = new ContainerStore(file)
      expect(ids(reopened.list())).toEqual(['work', DEFAULT_CONTAINER_ID, 'client', 'lab'])
    })

    it('lets the default container move — it is a profile too', () => {
      seed()
      store.reorder(['lab', 'client', 'work', DEFAULT_CONTAINER_ID])
      expect(ids(store.list())).toEqual(['lab', 'client', 'work', DEFAULT_CONTAINER_ID])
    })

    it('appends anything the caller forgot instead of dropping it', () => {
      seed()
      // A panel open while a container was created elsewhere sends a stale list.
      store.reorder(['client'])
      expect(ids(store.list())).toEqual(['client', DEFAULT_CONTAINER_ID, 'work', 'lab'])
    })

    it('ignores ids that do not exist and duplicates', () => {
      seed()
      store.reorder(['nope', 'lab', 'lab', '', 'client-corrupt-', 'work', DEFAULT_CONTAINER_ID, 'client'])
      expect(ids(store.list())).toEqual(['lab', 'work', DEFAULT_CONTAINER_ID, 'client'])
    })

    it('does not rewrite the file when the order did not change', () => {
      seed()
      const before = readFileSync(file, 'utf8')
      store.reorder([DEFAULT_CONTAINER_ID, 'work', 'lab', 'client'])
      expect(readFileSync(file, 'utf8')).toBe(before)
    })

    it('keeps a new container at the end of an order that already exists', () => {
      seed()
      store.reorder(['client', 'lab', DEFAULT_CONTAINER_ID, 'work'])
      store.save({ name: 'Later', accountId: 'later' })
      expect(ids(store.list())).toEqual(['client', 'lab', DEFAULT_CONTAINER_ID, 'work', 'later'])
    })

    it('drops a deleted container out of the stored order', () => {
      seed()
      store.reorder(['client', 'lab', DEFAULT_CONTAINER_ID, 'work'])
      store.remove('lab')
      const written = JSON.parse(readFileSync(file, 'utf8'))
      expect(written.order).toEqual(['client', DEFAULT_CONTAINER_ID, 'work'])
      expect(ids(store.list())).toEqual(['client', DEFAULT_CONTAINER_ID, 'work'])
    })

    it('survives a corrupt order array without losing a container', () => {
      seed()
      const raw = JSON.parse(readFileSync(file, 'utf8'))
      raw.order = [42, null, 'work']
      writeFileSync(file, JSON.stringify(raw), 'utf8')

      expect(ids(store.list())).toEqual(['work', DEFAULT_CONTAINER_ID, 'lab', 'client'])
    })

    it('numbers the shortcut from the same order the switcher shows', () => {
      seed()
      store.reorder(['client', 'lab', DEFAULT_CONTAINER_ID, 'work'])
      expect(containerShortcutIndex(store.list(), 'client')).toBe(1)
      expect(containerForShortcutDigit(store.list(), '1')?.id).toBe('client')
      // 0 has always meant the first container, wherever it is now.
      expect(containerForShortcutDigit(store.list(), '0')?.id).toBe('client')
      expect(containerForShortcutDigit(store.list(), '4')?.id).toBe('work')
    })
  })
})
