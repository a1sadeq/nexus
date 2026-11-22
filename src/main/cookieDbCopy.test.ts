import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// copyFileSync is the only call we need to bend: everything else has to behave for real, because
// the test is about which files exist afterwards. A shared flag decides whether the next copies
// fail the way Windows does (EBUSY) or the way a dead path does (ENOENT).
const harness = vi.hoisted(() => ({
  failuresLeft: 0,
  code: "EBUSY" as string,
  message: "EBUSY: resource busy or locked, copyfile",
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    copyFileSync: ((from: string, to: string) => {
      if (harness.failuresLeft > 0) {
        harness.failuresLeft -= 1;
        const err = new Error(harness.message) as NodeJS.ErrnoException;
        err.code = harness.code;
        throw err;
      }
      return actual.copyFileSync(from, to);
    }) as typeof actual.copyFileSync,
  };
});

import {
  BrowserDbLockedError,
  isLockError,
  copyWithRetry,
  describeCookieReadFailure,
  prepareTempCookieDb,
} from "./cookieDbCopy";

const DB_CONTENT =
  "SQLite format 3\0not a real database, but the bytes are copied verbatim";
const WAL_CONTENT = "write-ahead log";
const SHM_CONTENT = "shared memory index";

describe("cookieDbCopy", () => {
  let workDir: string;
  let profileDir: string;

  beforeEach(() => {
    harness.failuresLeft = 0;
    harness.code = "EBUSY";
    harness.message = "EBUSY: resource busy or locked, copyfile";

    workDir = mkdtempSync(join(tmpdir(), "nexus-cookiedbcopy-"));
    profileDir = join(workDir, "profile");
    mkdirSync(profileDir);
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function writeProfile(withWal: boolean, withShm: boolean): string {
    const dbPath = join(profileDir, "Cookies");
    writeFileSync(dbPath, DB_CONTENT);
    if (withWal) writeFileSync(`${dbPath}-wal`, WAL_CONTENT);
    if (withShm) writeFileSync(`${dbPath}-shm`, SHM_CONTENT);
    return dbPath;
  }

  describe("prepareTempCookieDb", () => {
    it("copies the database and leaves the original untouched", () => {
      const dbPath = writeProfile(false, false);

      const temp = prepareTempCookieDb(dbPath, {
        tmpDir: workDir,
        id: "plain",
      });

      expect(readFileSync(temp.dbPath, "utf8")).toBe(DB_CONTENT);
      expect(temp.dbPath).toBe(join(workDir, "nexus-cookies-plain.sqlite"));
      expect(temp.walPath).toBeUndefined();
      expect(readFileSync(dbPath, "utf8")).toBe(DB_CONTENT);
      temp.cleanup();
    });

    it("does not copy the -shm file even when the profile has one", () => {
      // The regression this guards: a copied -shm tells SQLite another connection is attached, so
      // it answers SQLITE_BUSY "database is locked" for a database nobody has open — which is what
      // sent a Windows user closing browsers that were already closed.
      const dbPath = writeProfile(true, true);

      const temp = prepareTempCookieDb(dbPath, {
        tmpDir: workDir,
        id: "noshm",
      });

      expect(existsSync(`${temp.dbPath}-shm`)).toBe(false);
      expect(existsSync(`${temp.dbPath}-wal`)).toBe(true);
      expect(existsSync(`${dbPath}-shm`)).toBe(true); // the original keeps its own
      temp.cleanup();
    });

    it("copies the write-ahead log when the profile has one and reports its path", () => {
      const dbPath = writeProfile(true, false);

      const temp = prepareTempCookieDb(dbPath, { tmpDir: workDir, id: "wal" });

      expect(temp.walPath).toBe(`${temp.dbPath}-wal`);
      expect(readFileSync(temp.walPath as string, "utf8")).toBe(WAL_CONTENT);
      temp.cleanup();
    });

    it("reports a lock with BrowserDbLockedError, naming the database", () => {
      const dbPath = writeProfile(false, false);
      harness.failuresLeft = 99;

      let caught: unknown;
      try {
        prepareTempCookieDb(dbPath, { tmpDir: workDir, id: "locked" });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(BrowserDbLockedError);
      const locked = caught as BrowserDbLockedError;
      expect(locked.code).toBe("NEXUS_BROWSER_DB_LOCKED");
      expect(locked.dbPath).toBe(dbPath);
      expect(locked.message).toContain(dbPath);
      // Nothing half-copied is left behind for the next attempt to trip over.
      expect(existsSync(join(workDir, "nexus-cookies-locked.sqlite"))).toBe(
        false,
      );
    });

    it("rethrows anything that is not a lock, untouched", () => {
      const dbPath = writeProfile(false, false);
      harness.failuresLeft = 99;
      harness.code = "ENOENT";
      harness.message = "ENOENT: no such file or directory, copyfile";

      let caught: unknown;
      try {
        prepareTempCookieDb(dbPath, { tmpDir: workDir, id: "enoent" });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(BrowserDbLockedError);
      expect((caught as NodeJS.ErrnoException).code).toBe("ENOENT");
    });

    it("fails plainly when the profile has no database", () => {
      expect(() =>
        prepareTempCookieDb(join(profileDir, "Nope"), { tmpDir: workDir }),
      ).toThrow(/Database file not found/);
    });

    it("cleans up twice without complaint", () => {
      const dbPath = writeProfile(true, false);
      const temp = prepareTempCookieDb(dbPath, {
        tmpDir: workDir,
        id: "twice",
      });

      expect(existsSync(temp.dbPath)).toBe(true);
      temp.cleanup();
      expect(existsSync(temp.dbPath)).toBe(false);
      expect(existsSync(temp.walPath as string)).toBe(false);
      expect(() => temp.cleanup()).not.toThrow();
    });
  });

  describe("copyWithRetry", () => {
    it("rides out a transient lock without sleeping", () => {
      const from = writeProfile(false, false);
      const to = join(workDir, "retried.sqlite");
      harness.failuresLeft = 2;

      copyWithRetry(from, to);

      expect(harness.failuresLeft).toBe(0);
      expect(readFileSync(to, "utf8")).toBe(DB_CONTENT);
    });

    it("gives up after three attempts and surfaces the last lock error", () => {
      const from = writeProfile(false, false);
      const to = join(workDir, "never.sqlite");
      harness.failuresLeft = 99;

      let caught: unknown;
      try {
        copyWithRetry(from, to);
      } catch (err) {
        caught = err;
      }

      expect(harness.failuresLeft).toBe(96);
      expect((caught as NodeJS.ErrnoException).code).toBe("EBUSY");
      expect(existsSync(to)).toBe(false);
    });

    it("does not retry a non-lock error", () => {
      const from = writeProfile(false, false);
      const to = join(workDir, "fatal.sqlite");
      harness.failuresLeft = 99;
      harness.code = "EACCES"; // treated as a lock, deliberately

      expect(() => copyWithRetry(from, to)).toThrow();
      expect(harness.failuresLeft).toBe(96);

      harness.failuresLeft = 99;
      harness.code = "EISDIR";
      harness.message = "EISDIR: illegal operation on a directory";
      expect(() => copyWithRetry(from, to)).toThrow(/directory/);
      expect(harness.failuresLeft).toBe(98); // stopped at the first attempt
    });
  });

  describe("isLockError", () => {
    it("recognises the OS lock codes", () => {
      for (const code of ["EBUSY", "EPERM", "EACCES", "SQLITE_BUSY"]) {
        expect(isLockError(Object.assign(new Error("x"), { code }))).toBe(true);
      }
    });

    it("recognises what SQLite and Windows say in prose", () => {
      expect(isLockError(new Error("database is locked"))).toBe(true);
      expect(
        isLockError(
          new Error(
            "The process cannot access the file because it is being used by another process.",
          ),
        ),
      ).toBe(true);
      expect(isLockError(new Error("Resource busy or locked"))).toBe(true);
    });

    it("leaves ordinary failures alone", () => {
      expect(isLockError(new Error("no such table: cookies"))).toBe(false);
      expect(
        isLockError(new Error("EISDIR: illegal operation on a directory")),
      ).toBe(false);
      expect(isLockError(null)).toBe(false);
    });
  });
});

describe("describeCookieReadFailure", () => {
  const locked = (): BrowserDbLockedError =>
    new BrowserDbLockedError("/x/Default/Cookies", new Error("EBUSY"));

  it("never says a browser is running — a lock says what is holding the file", () => {
    const text = describeCookieReadFailure(
      "Chrome — Default",
      locked(),
      "linux",
    );

    expect(text).not.toMatch(/browser is currently running/i);
    expect(text).toContain("Chrome — Default");
    expect(text).toContain("held open by another process");
    expect(text).toContain("Close the browser completely");
  });

  it("adds the Windows process hint on Windows only", () => {
    const onWindows = describeCookieReadFailure(
      "Edge — Profile 1",
      locked(),
      "win32",
    );
    const onMac = describeCookieReadFailure(
      "Edge — Profile 1",
      locked(),
      "darwin",
    );

    expect(onWindows).toContain("chrome.exe");
    expect(onWindows).toContain("msedge.exe");
    expect(onWindows).toContain("Startup boost");
    expect(onMac).not.toContain("msedge.exe");
    expect(onMac).not.toContain("Startup boost");
  });

  it("reports an ordinary failure as itself, with its code", () => {
    const err = Object.assign(new Error("no such table: cookies"), {
      code: "SQLITE_ERROR",
    });
    const text = describeCookieReadFailure("Firefox — default", err, "win32");

    expect(text).toBe(
      'Failed to read cookies from "Firefox — default": no such table: cookies (SQLITE_ERROR)',
    );
    expect(text).not.toContain("msedge.exe");
  });

  it("does not repeat the code when the message already carries it", () => {
    const err = Object.assign(
      new Error("ENOENT: no such file or directory, open"),
      { code: "ENOENT" },
    );
    expect(describeCookieReadFailure("P", err)).toBe(
      'Failed to read cookies from "P": ENOENT: no such file or directory, open',
    );
  });
});
