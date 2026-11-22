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
