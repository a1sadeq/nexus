import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { BrowserKind, BrowserProfile } from './cookieImport'

/** A single row ready to be inserted into a Chrome-style `cookies` table. */
export interface FakeChromeRow {
  host_key: string
  name: string
  value: string
  path?: string
  is_secure?: number
  is_httponly?: number
  expires_utc?: number
  last_access_utc?: number
  samesite?: number
}

/** A single row ready to be inserted into a Firefox-style `moz_cookies` table. */
export interface FakeFirefoxRow {
  host: string
  name: string
  value: string
  path?: string
  isSecure?: number
  isHttpOnly?: number
  expiry?: number
  lastAccessed?: number
  sameSite?: number | string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempDir(prefix: string): string {
  const dir = join(tmpdir(), prefix + '-' + Math.random().toString(36).slice(2))
  mkdirSync(dir, { recursive: true })
  return dir
}

function destroyDir(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// Chrome helper
// ---------------------------------------------------------------------------

export function buildFakeChromeCookieDb(rows: FakeChromeRow[]): { dir: string; dbPath: string } {
  const dir = tempDir('nexus-fake-chrome')
  const dbPath = join(dir, 'Cookies')
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE cookies (
      host_key     TEXT NOT NULL,
      name         TEXT NOT NULL,
      value        TEXT NOT NULL,
      encrypted_value BLOB,
      path         TEXT NOT NULL DEFAULT '/',
      is_secure    INTEGER NOT NULL DEFAULT 0,
      is_httponly  INTEGER NOT NULL DEFAULT 0,
      expires_utc  INTEGER NOT NULL DEFAULT 0,
      last_access_utc INTEGER NOT NULL DEFAULT 0,
      samesite     INTEGER NOT NULL DEFAULT 0
    )
  `)
  const stmt = db.prepare(
    'INSERT INTO cookies (host_key, name, value, path, is_secure, is_httponly, expires_utc, last_access_utc, samesite) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  for (const r of rows) {
    stmt.run(
      r.host_key ?? '',
      r.name ?? '',
      r.value ?? '',
      r.path ?? '/',
      r.is_secure ?? 0,
      r.is_httponly ?? 0,
      r.expires_utc ?? 0,
      r.last_access_utc ?? 0,
      r.samesite ?? 0
    )
  }
  db.close()
  return { dir, dbPath }
}

export function fakeChromeProfile(cookieRows: FakeChromeRow[], overrides?: Partial<BrowserProfile>): BrowserProfile {
  const { dbPath } = buildFakeChromeCookieDb(cookieRows)
  return {
    id: 'fake-chrome',
    browser: 'chrome' as BrowserKind,
    name: 'Fake Chrome',
    cookieDb: dbPath,
    hasGoogleAuth: false,
    detectedAiSessions: [],
    ...overrides
  }
}

export function destroyFakeChromeProfile(profile: BrowserProfile): void {
  const baseDir = profile.cookieDb.split('/Cookies')[0]
  destroyDir(baseDir)
}

// ---------------------------------------------------------------------------
// Firefox/Zen helper
// ---------------------------------------------------------------------------

export function buildFakeFirefoxCookieDb(rows: FakeFirefoxRow[]): { dir: string; dbPath: string } {
  const dir = tempDir('nexus-fake-firefox')
  const dbPath = join(dir, 'cookies.sqlite')
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE moz_cookies (
      id            INTEGER PRIMARY KEY,
      originAttributes TEXT NOT NULL DEFAULT '',
      name          TEXT NOT NULL DEFAULT '',
      value         TEXT NOT NULL DEFAULT '',
      host          TEXT NOT NULL DEFAULT '',
      path          TEXT NOT NULL DEFAULT '/',
      expiry        INTEGER NOT NULL DEFAULT 0,
      lastAccessed  INTEGER NOT NULL DEFAULT 0,
      isSecure      INTEGER NOT NULL DEFAULT 0,
      isHttpOnly    INTEGER NOT NULL DEFAULT 0,
      sameSite      INTEGER NOT NULL DEFAULT -1
    )
  `)
  const stmt = db.prepare(
    'INSERT INTO moz_cookies (name, value, host, path, expiry, lastAccessed, isSecure, isHttpOnly, sameSite) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  for (const r of rows) {
    stmt.run(
      r.name ?? '',
      r.value ?? '',
      r.host ?? '',
      r.path ?? '/',
      r.expiry ?? 0,
      r.lastAccessed ?? 0,
      r.isSecure ?? 0,
      r.isHttpOnly ?? 0,
      r.sameSite ?? -1
    )
  }
  db.close()
  return { dir, dbPath }
}

export function fakeFirefoxProfile(cookieRows: FakeFirefoxRow[], overrides?: Partial<BrowserProfile>): BrowserProfile {
  const { dbPath } = buildFakeFirefoxCookieDb(cookieRows)
  return {
    id: 'fake-firefox',
    browser: 'firefox' as BrowserKind,
    name: 'Fake Firefox',
    cookieDb: dbPath,
    hasGoogleAuth: false,
    detectedAiSessions: [],
    ...overrides
  }
}

export function destroyFakeFirefoxProfile(profile: BrowserProfile): void {
  destroyDir(profile.cookieDb.split('/cookies.sqlite')[0])
}

// ---------------------------------------------------------------------------
// Custom-directory fixture builder
// ---------------------------------------------------------------------------

export function buildFakeChromeCustomDir(cookieRows: FakeChromeRow[]): string {
  // readCookiesFromCustomDirectory looks for `Default/Cookies` under the supplied dir
  const dir = tempDir('nexus-fake-custom-chrome')
  mkdirSync(join(dir, 'Default', 'Network'), { recursive: true })
  const db = new DatabaseSync(join(dir, 'Default', 'Network', 'Cookies'))
  db.exec(`
    CREATE TABLE cookies (
      host_key     TEXT NOT NULL,
      name         TEXT NOT NULL,
      value        TEXT NOT NULL,
      encrypted_value BLOB,
      path         TEXT NOT NULL DEFAULT '/',
      is_secure    INTEGER NOT NULL DEFAULT 0,
      is_httponly  INTEGER NOT NULL DEFAULT 0,
      expires_utc  INTEGER NOT NULL DEFAULT 0,
      last_access_utc INTEGER NOT NULL DEFAULT 0,
      samesite     INTEGER NOT NULL DEFAULT 0
    )
  `)
  const stmt = db.prepare(
    'INSERT INTO cookies (host_key, name, value, path, is_secure, is_httponly, expires_utc, last_access_utc, samesite) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  for (const r of cookieRows) {
    stmt.run(
      r.host_key ?? '',
      r.name ?? '',
      r.value ?? '',
      r.path ?? '/',
      r.is_secure ?? 0,
      r.is_httponly ?? 0,
      r.expires_utc ?? 0,
      r.last_access_utc ?? 0,
      r.samesite ?? 0
    )
  }
  db.close()
  return dir
}

export function buildFakeFirefoxCustomDir(cookieRows: FakeFirefoxRow[]): string {
  // readCookiesFromCustomDirectory looks for `cookies.sqlite` directly under the supplied dir
  const dir = tempDir('nexus-fake-custom-firefox')
  const db = new DatabaseSync(join(dir, 'cookies.sqlite'))
  db.exec(`
    CREATE TABLE moz_cookies (
      id            INTEGER PRIMARY KEY,
      originAttributes TEXT NOT NULL DEFAULT '',
      name          TEXT NOT NULL DEFAULT '',
      value         TEXT NOT NULL DEFAULT '',
      host          TEXT NOT NULL DEFAULT '',
      path          TEXT NOT NULL DEFAULT '/',
      expiry        INTEGER NOT NULL DEFAULT 0,
      lastAccessed  INTEGER NOT NULL DEFAULT 0,
      isSecure      INTEGER NOT NULL DEFAULT 0,
      isHttpOnly    INTEGER NOT NULL DEFAULT 0,
      sameSite      INTEGER NOT NULL DEFAULT -1
    )
  `)
  const stmt = db.prepare(
    'INSERT INTO moz_cookies (name, value, host, path, expiry, lastAccessed, isSecure, isHttpOnly, sameSite) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  for (const r of cookieRows) {
    stmt.run(
      r.name ?? '',
      r.value ?? '',
      r.host ?? '',
      r.path ?? '/',
      r.expiry ?? 0,
      r.lastAccessed ?? 0,
      r.isSecure ?? 0,
      r.isHttpOnly ?? 0,
      r.sameSite ?? -1
    )
  }
  db.close()
  return dir
}

// ---------------------------------------------------------------------------
// Cleanup on process exit to avoid leaking temp dirs
// ---------------------------------------------------------------------------

const trackedDirs = new Set<string>()
export function trackDir(dir: string): void {
  trackedDirs.add(dir)
}

process.on('exit', () => {
  for (const dir of trackedDirs) destroyDir(dir)
})
