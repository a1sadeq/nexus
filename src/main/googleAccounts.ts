import { existsSync, fsyncSync, openSync, closeSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

/**
 * Google accounts, each with its own cookie store.
 *
 * Containers need more than one signed-in Google account, and a cookie jar cannot hold two accounts
 * for the same domain at once. So an account is an identity plus an Electron *partition*, and the
 * partition is what actually separates them:
 *
 *   default  → `persist:ai-shared`      the store every AI tab uses today
 *   <id>     → `persist:ai-account-<id>`  its own cookies, own storage, own everything
 *
 * The default keeps its existing partition name on purpose: everything that already works — the
 * shared session, the sign-in card, the recovery path — keeps working unchanged. Adding an account
 * later is a routing question (which tabs load which partition), not a rewrite, which is the point
 * of doing this now rather than when containers arrive.
 */

export const DEFAULT_ACCOUNT_ID = 'default'
export const DEFAULT_PARTITION = 'persist:ai-shared'

export interface GoogleAccount {
  id: string
  /** What the user calls it. Never used as a key. */
  label: string
  /** The Electron partition holding this account's cookies. */
  partition: string
  createdAt: number
}

/** Ids are used in partition names, so they are restricted to what Electron accepts there. */
export function sanitiseAccountId(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) return null
  const id = trimmed.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!id || id.length > 40) return null
  return id
}

export function partitionForAccount(accountId: string): string {
  if (accountId === DEFAULT_ACCOUNT_ID) return DEFAULT_PARTITION
  const id = sanitiseAccountId(accountId) ?? DEFAULT_ACCOUNT_ID
  if (id === DEFAULT_ACCOUNT_ID) return DEFAULT_PARTITION
  return `persist:ai-account-${id}`
}

export function defaultAccount(): GoogleAccount {
  return {
    id: DEFAULT_ACCOUNT_ID,
    label: 'Default',
    partition: DEFAULT_PARTITION,
    createdAt: 0
  }
}

interface AccountsFile {
  version: 1
  accounts: Array<Pick<GoogleAccount, 'id' | 'label' | 'createdAt'>>
}

/**
 * The account list, kept in the user's data directory. The default account is not stored: it always
 * exists, and a file that has lost it must not silently drop the session every tab depends on.
 */
export class GoogleAccountStore {
  constructor(
    private readonly filePath: string,
    private readonly now: () => number = () => Date.now()
  ) {}

  private readFile(): AccountsFile {
    if (!existsSync(this.filePath)) return { version: 1, accounts: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<AccountsFile>
      const accounts = Array.isArray(parsed?.accounts) ? parsed.accounts : []
      const seen = new Set<string>([DEFAULT_ACCOUNT_ID])
      const kept: Array<Pick<GoogleAccount, 'id' | 'label' | 'createdAt'>> = []
      for (const entry of accounts) {
        if (!entry || typeof entry.id !== 'string') continue
        // An id has to be usable in a partition name. Normalise rather than discard: a hand-edited
        // file should not silently cost someone an account, and a duplicate must not share a store.
        const id = sanitiseAccountId(entry.id)
        if (!id || seen.has(id)) continue
        seen.add(id)
        kept.push({ id, label: typeof entry.label === 'string' ? entry.label : id, createdAt: entry.createdAt ?? 0 })
      }
      return { version: 1, accounts: kept }
    } catch {
      // A corrupt file costs the extra accounts, never the default one, and never a crash on start.
      return { version: 1, accounts: [] }
    }
  }

  /**
   * Written to a temp file, flushed, then renamed over the target — the same guarantee atomicWrite
   * gives, without importing it: that module registers an `app.on('before-quit')` handler on import,
   * which would drag Electron into a module that is otherwise plain filesystem code.
   */
  private writeFile(data: AccountsFile): void {
    const tmp = `${this.filePath}.tmp-${process.pid}`
    const fd = openSync(tmp, 'w', 0o600)
    try {
      writeFileSync(fd, JSON.stringify(data, null, 2), 'utf-8')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, this.filePath)
  }

  list(): GoogleAccount[] {
    const stored = this.readFile().accounts.map((a) => ({
      id: a.id,
      label: a.label || a.id,
      partition: partitionForAccount(a.id),
      createdAt: a.createdAt ?? 0
    }))
    return [defaultAccount(), ...stored]
  }

  get(accountId: string): GoogleAccount | null {
    return this.list().find((a) => a.id === accountId) ?? null
  }

  /** Adds an account. The label is for the user; the id is derived from it and kept unique. */
  add(label: string): { account?: GoogleAccount; error?: string } {
    const trimmed = (label ?? '').trim()
    if (!trimmed) return { error: 'Give the account a name first.' }

    const base = sanitiseAccountId(trimmed) ?? 'account'
    const taken = new Set(this.list().map((a) => a.id))
    let id = base
    let suffix = 2
    while (taken.has(id)) {
      id = `${base}-${suffix}`
      suffix += 1
    }

    const account: GoogleAccount = {
      id,
      label: trimmed,
      partition: partitionForAccount(id),
      createdAt: this.now()
    }
    const file = this.readFile()
    this.writeFile({
      version: 1,
      accounts: [...file.accounts, { id: account.id, label: account.label, createdAt: account.createdAt }]
    })
    return { account }
  }

  /** Removes an account. The default account cannot be removed: every AI tab is signed into it. */
  remove(accountId: string): { removed: boolean; error?: string } {
    if (accountId === DEFAULT_ACCOUNT_ID) {
      return { removed: false, error: 'The default account is the one every tab uses; it cannot be removed.' }
    }
    const file = this.readFile()
    const next = file.accounts.filter((a) => a.id !== accountId)
    if (next.length === file.accounts.length) return { removed: false, error: 'No such account.' }
    this.writeFile({ version: 1, accounts: next })
    return { removed: true }
  }
}
