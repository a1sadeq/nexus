// Copying a browser's cookie database somewhere we are allowed to read it.
//
// Kept separate from cookieImport.ts (and free of node:sqlite) so the fiddly part — which files to
// copy, what a lock looks like, and what the caller should be told — can be tested without a real
// Chromium profile or a SQLite build.

import { copyFileSync, existsSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Raised when the cookie database cannot be read because something else is holding it.
 *
 * Distinct from a generic failure on purpose. Callers used to treat *any* EBUSY/EPERM, and
 * SQLite's own "database is locked", as "the browser is currently running" — so a stale
 * shared-memory file left people closing browsers that were already closed.
 */
export class BrowserDbLockedError extends Error {
  readonly code = "NEXUS_BROWSER_DB_LOCKED";
  readonly dbPath: string;
  readonly cause?: unknown;

  constructor(dbPath: string, cause?: unknown) {
    super(`Cookie database is locked: ${dbPath}`);
    this.name = "BrowserDbLockedError";
    this.dbPath = dbPath;
    this.cause = cause;
  }
}

/** True for "another process has this open", whether it came from the OS or from SQLite. */
export function isLockError(err: unknown): boolean {
  const code = (err as Record<string, unknown>)?.code;
  if (
    code === "EBUSY" ||
    code === "EPERM" ||
    code === "EACCES" ||
    code === "SQLITE_BUSY"
  )
    return true;
  const text = String((err as Error)?.message ?? err).toLowerCase();
  return (
    text.includes("busy") ||
    text.includes("locked") ||
    text.includes("being used by another process") ||
    text.includes("access is denied")
  );
}

/**
 * Three immediate attempts rather than a sleep-and-retry: this runs on the Electron main thread,
 * and blocking it for a few hundred milliseconds to wait out an antivirus scan would freeze the
 * window. A lock that survives three attempts is reported instead of waited out.
 */
export function copyWithRetry(from: string, to: string): void {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      copyFileSync(from, to);
      return;
    } catch (err) {
      lastError = err;
      if (!isLockError(err)) throw err;
    }
  }
  throw lastError;
}

export interface TempCookieDb {
  /** The copy to open. */
  dbPath: string;
  /** The copied `-wal`, when the original had one. Removable to retry a read without it. */
  walPath?: string;
  /** Deletes the copies. Safe to call twice. */
  cleanup: () => void;
}

export interface PrepareOptions {
  /** Directory for the copy; defaults to the OS temp directory. */
  tmpDir?: string;
  /** Copy id; defaults to a random UUID. */
  id?: string;
}

/**
 * Copy a cookie database (and its write-ahead log) into the temp directory.
 *
 * The `-shm` file is deliberately **not** copied. It is a shared-memory index that only means
 * anything to the process that created it; a copy of it convinces SQLite that another connection is
 * attached and makes it fail with SQLITE_BUSY — "database is locked" — on a database nobody has
 * open. That is the most likely reason a Windows user sees a lock error with every browser closed.
 */
export function prepareTempCookieDb(
  originalDbPath: string,
  options: PrepareOptions = {},
): TempCookieDb {
  if (!existsSync(originalDbPath)) {
    throw new Error(`Database file not found: ${originalDbPath}`);
  }

  const tmpId = options.id ?? randomUUID();
  const dir = options.tmpDir ?? tmpdir();
  const dbPath = join(dir, `nexus-cookies-${tmpId}.sqlite`);
  const walPath = `${dbPath}-wal`;

  const cleanup = (): void => {
    for (const p of [dbPath, walPath]) {
      try {
        if (existsSync(p)) unlinkSync(p);
      } catch {
        // temp files are disposable; a stuck one must not mask the real error
      }
    }
  };

  try {
    copyWithRetry(originalDbPath, dbPath);
  } catch (err) {
    cleanup();
    if (isLockError(err)) throw new BrowserDbLockedError(originalDbPath, err);
    throw err;
  }

  const originalWalPath = `${originalDbPath}-wal`;
  let copiedWal: string | undefined;
  if (existsSync(originalWalPath)) {
    try {
      copyWithRetry(originalWalPath, walPath);
      copiedWal = walPath;
    } catch {
      // A WAL we cannot copy is not fatal: anything checkpointed is already in the main file, and
      // a slightly stale read beats a hard failure.
      copiedWal = undefined;
    }
  }

  return { dbPath, walPath: copiedWal, cleanup };
}

/**
 * The sentence shown to the user when a cookie read fails.
 *
 * Only a genuine lock is described as "held open by another process" — and on Windows that comes
 * with the processes to look for, because Chrome and Edge both keep helpers resident after their
 * windows close. Everything else is reported as itself, with its error code, so nothing is
 * explained away as "the browser is currently running".
 */
export function describeCookieReadFailure(
  profileName: string,
  err: unknown,
  platform: string = process.platform,
): string {
  if (err instanceof BrowserDbLockedError) {
    const windowsHint =
      platform === "win32"
        ? ' On Windows this also happens when Chrome or Edge is still resident after its windows close — check Task Manager for chrome.exe / msedge.exe, and turn off Edge\'s "Startup boost" and "Continue running background extensions".'
        : "";
    return `Cannot read "${profileName}" because its cookie database is held open by another process. Close the browser completely and try again.${windowsHint}`;
  }

  const code = String((err as Record<string, unknown>)?.code ?? "").trim();
  const detail = (err as Error)?.message ?? String(err);
  const suffix = code && !detail.includes(code) ? ` (${code})` : "";
  return `Failed to read cookies from "${profileName}": ${detail}${suffix}`;
}

/**
 * What a cookie read actually found, kept so an empty result can be explained instead of being
 * reported as "no sessions". A profile that holds a Google session can still produce zero cookies
 * here — because the value could not be decrypted, or because the only sessions in it are Google's,
 * which are imported from a single profile on purpose.
 */
export interface CookieReadStats {
  scope: "google" | "all";
  /** Rows the database's own host filter returned, before the provider pattern ran. */
  rows: number;
  /** Rows whose host matched the provider pattern for this scope. */
  matched: number;
  /** Cookies that came back with a usable value. */
  usable: number;
  /** Cookies dropped because their value could not be recovered. */
  undecryptable: number;
  /** Encryption prefixes seen on the values, e.g. `{ v10: 3, v20: 12 }`. */
  prefixes: Record<string, number>;
  /** Windows only: whether the browser's DPAPI-wrapped key could be unlocked. `null` elsewhere. */
  keyAvailable: boolean | null;
}

/**
 * The sentence shown when a read succeeded but produced nothing usable.
 *
 * The order matters: a decryption failure is not "no sessions", and a Chrome profile whose only
 * sessions are Google's is not empty either. Each case names the one thing the user can do about it.
 */
export function describeEmptyRead(
  profileName: string,
  stats: CookieReadStats | null | undefined,
  platform: string = process.platform,
): string {
  const fallback = `No active AI session cookies found in "${profileName}".`;
  if (!stats) return fallback;

  const found = stats.matched;

  if (found > 0 && stats.usable === 0 && stats.undecryptable > 0) {
    const appBound = (stats.prefixes.v20 ?? 0) > 0;
    if (appBound) {
      return (
        `"${profileName}" has ${found} matching cookie(s), but ${stats.undecryptable} could not be read: ` +
        `they use Chrome's app-bound encryption ("v20"), which only the browser's own service can unlock. ` +
        `Nothing outside that browser can open them — including Nexus. ` +
        `Sign in inside Nexus instead (Sessions → "Sign in inside Nexus"), which stores the session in ` +
        `Nexus' own profile; or export the cookies as JSON and use Import from JSON; or import from a ` +
        `Firefox/Zen profile, which is not encrypted.`
      );
    }
    if (stats.keyAvailable === false) {
      const how =
        platform === "win32"
          ? "Nexus could not unlock the cookie key behind Windows DPAPI (powershell returned nothing), so every encrypted value was unreadable."
          : "Nexus could not obtain the key needed to decrypt this browser's cookie values.";
      return `"${profileName}" has ${found} matching cookie(s), but ${how} Nothing was imported.`;
    }
    return `"${profileName}" has ${found} matching cookie(s), but none of their values could be decrypted. Nothing was imported.`;
  }

  if (found === 0) {
    return `Read ${stats.rows} cookie(s) from "${profileName}", but none belonged to a supported AI provider.`;
  }

  return fallback;
}

/**
 * The sentence shown by "sync all sessions" when the only sessions it could legitimately take were
 * Google's.
 *
 * Google cookies are excluded from a bulk sync on purpose: they belong to one account, and copying
 * them from several profiles is how a sync lands on the wrong one. But a profile that plainly holds
 * a Google session must not be reported as holding nothing.
 */
export function describeGoogleOnlySync(
  profileName: string,
  googleCount: number,
  otherProfilesWithGoogle: boolean,
): string {
  return (
    `Found ${googleCount} Google session cookie(s) in "${profileName}". ` +
    `Google sessions are imported one profile at a time on purpose: use "Import from browser profile" ` +
    `and choose "${profileName}".` +
    (otherProfilesWithGoogle
      ? " (Other profiles also hold Google sessions.)"
      : "")
  );
}
