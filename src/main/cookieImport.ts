// Browser cookie reading for the OAuth webview bridge. After the system-browser
// OAuth flow completes, the user's real browser holds a fresh Google session;
// these functions locate it and extract the session cookies so they can be
// copied into the AI webview partition (webviews cannot consume OAuth tokens).
import { DatabaseSync } from 'node:sqlite'
import { pbkdf2Sync, createDecipheriv, randomUUID } from 'node:crypto'
import { copyFileSync, unlinkSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir, platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const execFileAsync = execFileP

function withTempSqliteDb<T>(dbPath: string, fn: (db: DatabaseSync) => T): T {
  if (!existsSync(dbPath)) {
    throw new Error(`Database file not found: ${dbPath}`)
  }

  const tmpId = randomUUID()
  const tmpDbPath = join(tmpdir(), `nexus-cookies-${tmpId}.sqlite`)
  const tmpWalPath = `${tmpDbPath}-wal`
  const tmpShmPath = `${tmpDbPath}-shm`

  const origWalPath = `${dbPath}-wal`
  const origShmPath = `${dbPath}-shm`

  try {
    copyFileSync(dbPath, tmpDbPath)
    if (existsSync(origWalPath)) {
      try {
        copyFileSync(origWalPath, tmpWalPath)
      } catch {
        // ignore optional wal copy error
      }
    }
    if (existsSync(origShmPath)) {
      try {
        copyFileSync(origShmPath, tmpShmPath)
      } catch {
        // ignore optional shm copy error
      }
    }

    const db = new DatabaseSync(tmpDbPath, { readOnly: true })
    try {
      return fn(db)
    } finally {
      db.close()
    }
  } finally {
    try {
      if (existsSync(tmpDbPath)) unlinkSync(tmpDbPath)
    } catch {
      // ignore
    }
    try {
      if (existsSync(tmpWalPath)) unlinkSync(tmpWalPath)
    } catch {
      // ignore
    }
    try {
      if (existsSync(tmpShmPath)) unlinkSync(tmpShmPath)
    } catch {
      // ignore
    }
  }
}

export interface BrowserCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  expirationDate?: number
  lastAccessed?: number
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict' | string
}

export type BrowserKind =
  | 'firefox'
  | 'floorp'
  | 'chrome'
  | 'chromium'
  | 'brave'
  | 'edge'
  | 'opera'
  | 'vivaldi'

export interface BrowserProfile {
  id: string
  browser: BrowserKind
  name: string
  cookieDb: string
  localState?: string
  hasGoogleAuth?: boolean
  lastAccessed?: number
  isLatest?: boolean
}

export const GOOGLE_HOST_PATTERN =
  /(^|\.)(google\.(com|eg|co\.\w+|com\.\w+)|googleusercontent\.com|gstatic\.com|googleapis\.com)$/i
export const AI_HOST_PATTERN =
  /(^|\.)(google\.(com|eg|co\.\w+|com\.\w+)|googleusercontent\.com|gstatic\.com|googleapis\.com|openai\.com|chatgpt\.com|oaistatic\.com|oaiusercontent\.com|anthropic\.com|claude\.ai|perplexity\.ai|deepseek\.com|x\.ai|grok\.com|mistral\.ai)$/i

const SQL_CHROME_AI_WHERE = `
  host_key LIKE '%google%' OR
  host_key LIKE '%openai.com%' OR
  host_key LIKE '%chatgpt.com%' OR
  host_key LIKE '%anthropic.com%' OR
  host_key LIKE '%claude.ai%' OR
  host_key LIKE '%perplexity.ai%' OR
  host_key LIKE '%deepseek.com%' OR
  host_key LIKE '%x.ai%' OR
  host_key LIKE '%grok.com%' OR
  host_key LIKE '%mistral.ai%'
`

const SQL_FIREFOX_AI_WHERE = `
  host LIKE '%google%' OR
  host LIKE '%openai.com%' OR
  host LIKE '%chatgpt.com%' OR
  host LIKE '%anthropic.com%' OR
  host LIKE '%claude.ai%' OR
  host LIKE '%perplexity.ai%' OR
  host LIKE '%deepseek.com%' OR
  host LIKE '%x.ai%' OR
  host LIKE '%grok.com%' OR
  host LIKE '%mistral.ai%'
`

const SESSION_COOKIES = ['SID', '__Secure-1PSID', '__Secure-3PSID'] as const

function firefoxProfileInfo(dbPath: string): { hasGoogleAuth: boolean; lastAccessed?: number } {
  try {
    return withTempSqliteDb(dbPath, (db) => {
      const authRow = db
        .prepare(
          `SELECT COUNT(*) AS n FROM moz_cookies
           WHERE host LIKE '%google%' AND name IN (${SESSION_COOKIES.map(() => '?').join(',')})`
        )
        .get(...SESSION_COOKIES) as { n: number }

      let maxAccess: number | undefined = undefined
      try {
        const accessRow = db
          .prepare(
            `SELECT MAX(CAST(lastAccessed AS REAL)) AS maxAccess FROM moz_cookies WHERE ${SQL_FIREFOX_AI_WHERE}`
          )
          .get() as { maxAccess?: number }
        maxAccess = normalizeExpirationDate(accessRow?.maxAccess)
      } catch {
        // ignore fallback
      }

      return {
        hasGoogleAuth: (authRow?.n ?? 0) > 0,
        lastAccessed: maxAccess
      }
    })
  } catch {
    return { hasGoogleAuth: false }
  }
}

function chromeProfileInfo(dbPath: string): { hasGoogleAuth: boolean; lastAccessed?: number } {
  try {
    return withTempSqliteDb(dbPath, (db) => {
      const authRow = db
        .prepare(
          `SELECT COUNT(*) AS n FROM cookies
           WHERE host_key LIKE '%google%' AND name IN (${SESSION_COOKIES.map(() => '?').join(',')})`
        )
        .get(...SESSION_COOKIES) as { n: number }

      let maxAccess: number | undefined = undefined
      try {
        const accessRow = db
          .prepare(
            `SELECT MAX(last_access_utc) AS maxAccess FROM cookies WHERE ${SQL_CHROME_AI_WHERE}`
          )
          .get() as { maxAccess?: number }
        maxAccess = normalizeExpirationDate(accessRow?.maxAccess)
      } catch {
        // ignore fallback
      }

      return {
        hasGoogleAuth: (authRow?.n ?? 0) > 0,
        lastAccessed: maxAccess
      }
    })
  } catch {
    return { hasGoogleAuth: false }
  }
}

interface BrowserSearchTarget {
  kind: BrowserKind
  label: string
  dirs: string[]
}

function getSystemBrowserTargets(): {
  firefoxTargets: BrowserSearchTarget[]
  chromeTargets: BrowserSearchTarget[]
} {
  const currentPlatform = platform()
  const home = homedir()

  if (currentPlatform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local')
    const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming')

    return {
      firefoxTargets: [
        { kind: 'firefox', label: 'Firefox', dirs: [join(appData, 'Mozilla', 'Firefox')] },
        { kind: 'floorp', label: 'Floorp', dirs: [join(appData, 'Floorp')] }
      ],
      chromeTargets: [
        { kind: 'chrome', label: 'Chrome', dirs: [join(localAppData, 'Google', 'Chrome', 'User Data')] },
        { kind: 'edge', label: 'Edge', dirs: [join(localAppData, 'Microsoft', 'Edge', 'User Data')] },
        { kind: 'brave', label: 'Brave', dirs: [join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data')] },
        { kind: 'chromium', label: 'Chromium', dirs: [join(localAppData, 'Chromium', 'User Data')] },
        { kind: 'vivaldi', label: 'Vivaldi', dirs: [join(localAppData, 'Vivaldi', 'User Data')] },
        { kind: 'opera', label: 'Opera', dirs: [join(appData, 'Opera Software', 'Opera Stable'), join(appData, 'Opera Software', 'Opera GX Stable')] }
      ]
    }
  }

  if (currentPlatform === 'darwin') {
    const appSupport = join(home, 'Library', 'Application Support')
    return {
      firefoxTargets: [
        { kind: 'firefox', label: 'Firefox', dirs: [join(appSupport, 'Firefox')] },
        { kind: 'floorp', label: 'Floorp', dirs: [join(appSupport, 'Floorp')] }
      ],
      chromeTargets: [
        { kind: 'chrome', label: 'Chrome', dirs: [join(appSupport, 'Google', 'Chrome')] },
        { kind: 'edge', label: 'Edge', dirs: [join(appSupport, 'Microsoft Edge')] },
        { kind: 'brave', label: 'Brave', dirs: [join(appSupport, 'BraveSoftware', 'Brave-Browser')] },
        { kind: 'chromium', label: 'Chromium', dirs: [join(appSupport, 'Chromium')] },
        { kind: 'vivaldi', label: 'Vivaldi', dirs: [join(appSupport, 'Vivaldi')] },
        { kind: 'opera', label: 'Opera', dirs: [join(appSupport, 'com.operasoftware.Opera')] }
      ]
    }
  }

  // Linux (Default)
  return {
    firefoxTargets: [
      { kind: 'firefox', label: 'Firefox', dirs: [join(home, '.mozilla', 'firefox')] },
      { kind: 'floorp', label: 'Floorp', dirs: [join(home, '.floorp')] }
    ],
    chromeTargets: [
      { kind: 'chrome', label: 'Chrome', dirs: [join(home, '.config', 'google-chrome')] },
      { kind: 'chromium', label: 'Chromium', dirs: [join(home, '.config', 'chromium')] },
      { kind: 'brave', label: 'Brave', dirs: [join(home, '.config', 'BraveSoftware', 'Brave-Browser')] },
      { kind: 'edge', label: 'Edge', dirs: [join(home, '.config', 'microsoft-edge')] },
      { kind: 'vivaldi', label: 'Vivaldi', dirs: [join(home, '.config', 'vivaldi')] },
      { kind: 'opera', label: 'Opera', dirs: [join(home, '.config', 'opera')] }
    ]
  }
}

export function detectProfiles(): BrowserProfile[] {
  const profiles: BrowserProfile[] = []
  const { firefoxTargets, chromeTargets } = getSystemBrowserTargets()

  // 1. Scan Firefox-family browsers
  for (const { kind, label, dirs } of firefoxTargets) {
    for (const ffDir of dirs) {
      if (!existsSync(ffDir)) continue

      const iniPath = join(ffDir, 'profiles.ini')
      const ini = existsSync(iniPath) ? readFileSync(iniPath, 'utf8') : ''
      const names = new Map<string, string>()
      let curPath: string | null = null
      let curName: string | null = null
      for (const line of ini.split('\n')) {
        const pm = line.match(/^Path=(.+)$/)
        const nm = line.match(/^Name=(.+)$/)
        if (pm) curPath = pm[1].trim().replace(/\r$/, '')
        else if (nm) curName = nm[1].trim().replace(/\r$/, '')
        else if (line.startsWith('[') && curPath && curName) {
          names.set(curPath, curName)
          curPath = null
          curName = null
        }
      }
      if (curPath && curName) names.set(curPath, curName)

      // Look in both root profile dirs and 'Profiles' subfolder
      const searchDirs = [ffDir]
      const profilesSubdir = join(ffDir, 'Profiles')
      if (existsSync(profilesSubdir)) searchDirs.push(profilesSubdir)

      for (const sDir of searchDirs) {
        try {
          for (const dir of readdirSync(sDir, { withFileTypes: true })) {
            if (!dir.isDirectory()) continue
            const db = join(sDir, dir.name, 'cookies.sqlite')
            if (existsSync(db)) {
              const name = names.get(dir.name) ?? names.get(`Profiles/${dir.name}`) ?? dir.name
              const info = firefoxProfileInfo(db)
              profiles.push({
                id: `${kind}-${dir.name}`,
                browser: kind,
                name: `${label} — ${name}`,
                cookieDb: db,
                hasGoogleAuth: info.hasGoogleAuth,
                lastAccessed: info.lastAccessed
              })
            }
          }
        } catch {
          // ignore directory read errors
        }
      }
    }
  }

  // 2. Scan Chromium-family browsers
  for (const { kind, label, dirs } of chromeTargets) {
    for (const dir of dirs) {
      if (!existsSync(dir)) continue
      const localState = join(dir, 'Local State')

      // Check if dir itself is a profile directory (e.g. Opera)
      const directDbs = [join(dir, 'Network', 'Cookies'), join(dir, 'Cookies')]
      const directDb = directDbs.find((p) => existsSync(p))
      if (directDb) {
        const info = chromeProfileInfo(directDb)
        profiles.push({
          id: `${kind}-default`,
          browser: kind,
          name: `${label} — Default`,
          cookieDb: directDb,
          localState: existsSync(localState) ? localState : undefined,
          hasGoogleAuth: info.hasGoogleAuth,
          lastAccessed: info.lastAccessed
        })
      }

      // Check all subdirectories (Default, Profile 1, Profile 2, etc.)
      try {
        for (const profileDir of readdirSync(dir, { withFileTypes: true })) {
          if (!profileDir.isDirectory()) continue
          const candidateDbs = [
            join(dir, profileDir.name, 'Network', 'Cookies'),
            join(dir, profileDir.name, 'Cookies')
          ]
          const db = candidateDbs.find((p) => existsSync(p))
          if (db) {
            // Avoid duplicate if already added
            if (profiles.some((p) => p.cookieDb === db)) continue
            const info = chromeProfileInfo(db)
            profiles.push({
              id: `${kind}-${profileDir.name}`,
              browser: kind,
              name: `${label} — ${profileDir.name}`,
              cookieDb: db,
              localState: existsSync(localState) ? localState : undefined,
              hasGoogleAuth: info.hasGoogleAuth,
              lastAccessed: info.lastAccessed
            })
          }
        }
      } catch {
        // ignore directory read error
      }
    }
  }

  // Sort by lastAccessed descending
  profiles.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))
  if (profiles.length > 0) {
    profiles[0].isLatest = true
  }

  return profiles
}

export async function detectDefaultBrowser(): Promise<BrowserKind | null> {
  const currentPlatform = platform()
  if (currentPlatform === 'linux') {
    try {
      const { stdout } = await execFileAsync('xdg-settings', ['get', 'default-web-browser'], {
        timeout: 1500
      })
      const desktop = stdout.trim().toLowerCase()
      if (desktop.includes('floorp')) return 'floorp'
      if (desktop.includes('firefox')) return 'firefox'
      if (desktop.includes('google-chrome') || desktop.includes('chrome')) return 'chrome'
      if (desktop.includes('chromium')) return 'chromium'
      if (desktop.includes('brave')) return 'brave'
      if (desktop.includes('edge') || desktop.includes('microsoft-edge')) return 'edge'
      if (desktop.includes('vivaldi')) return 'vivaldi'
      if (desktop.includes('opera')) return 'opera'
      return null
    } catch {
      return null
    }
  }
  return null
}

export function pickBestProfile(
  defaultKind: BrowserKind | null,
  profiles: BrowserProfile[]
): BrowserProfile | null {
  if (profiles.length === 0) return null
  const withAuth = profiles.filter((p) => p.hasGoogleAuth)
  if (defaultKind) {
    const defaultWithAuth = withAuth.find((p) => p.browser === defaultKind)
    if (defaultWithAuth) return defaultWithAuth
  }
  if (withAuth.length > 0) return withAuth[0]
  return profiles[0]
}

// Windows DPAPI Master Key Cache
const windowsKeyCache = new Map<string, Buffer>()

async function getWindowsMasterKey(localState: string): Promise<Buffer | null> {
  if (windowsKeyCache.has(localState)) {
    return windowsKeyCache.get(localState)!
  }
  try {
    const ls = JSON.parse(readFileSync(localState, 'utf8'))
    const encKeyB64 = ls?.os_crypt?.encrypted_key
    if (!encKeyB64) return null

    const script = `
      $enc = [Convert]::FromBase64String('${encKeyB64}')
      $dpapiBytes = $enc[5..($enc.Length - 1)]
      Add-Type -AssemblyName System.Security
      $dec = [System.Security.Cryptography.ProtectedData]::Unprotect($dpapiBytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
      [Convert]::ToBase64String($dec)
    `
    const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: 3000
    })
    const outB64 = stdout.trim()
    if (!outB64) return null
    const masterKey = Buffer.from(outB64, 'base64')
    windowsKeyCache.set(localState, masterKey)
    return masterKey
  } catch (err) {
    console.error('Failed to unprotect key via Windows DPAPI:', err)
    return null
  }
}

// Decrypts Windows Chromium AES-256-GCM cookies (v10 / v20)
function decryptWindowsChromeValue(encrypted: Uint8Array, masterKey: Buffer): string | null {
  if (encrypted.length === 0) return ''
  const prefix = Buffer.from(encrypted.subarray(0, 3)).toString()
  if (prefix === 'v10' || prefix === 'v11' || prefix === 'v20') {
    const nonce = encrypted.subarray(3, 15)
    const ciphertext = encrypted.subarray(15, encrypted.length - 16)
    const tag = encrypted.subarray(encrypted.length - 16)
    try {
      const decipher = createDecipheriv('aes-256-gcm', masterKey, nonce)
      decipher.setAuthTag(tag)
      const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      return dec.toString('utf8')
    } catch {
      return null
    }
  }
  return null
}

// Chromium os_crypt on Linux: v10 uses a hardcoded password, v11 a keyring-derived one.
function decryptLinuxChromeValue(encrypted: Uint8Array, password: string): string | null {
  if (encrypted.length === 0) return ''
  const prefix = Buffer.from(encrypted.subarray(0, 3)).toString()
  if (prefix !== 'v10' && prefix !== 'v11') {
    return Buffer.from(encrypted).toString()
  }
  const key = pbkdf2Sync(password, 'saltysalt', 1, 16, 'sha1')
  const ciphertext = Buffer.from(encrypted.subarray(3))
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
    const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const pad = dec[dec.length - 1]
    if (pad >= 1 && pad <= 16 && pad <= dec.length) {
      return dec.subarray(0, dec.length - pad).toString('utf8')
    }
    return dec.toString('utf8')
  } catch {
    return null
  }
}

function chromiumKeyFromLocalState(localState: string): string | null {
  try {
    const ls = JSON.parse(readFileSync(localState, 'utf8'))
    const enc = ls?.os_crypt?.encrypted_key
    if (!enc) return null
    const raw = Buffer.from(enc, 'base64').toString('utf8').replace(/^DPAPI/, '')
    return raw || null
  } catch {
    return null
  }
}

async function chromiumKeyViaSecretTool(): Promise<string | null> {
  if (platform() !== 'linux') return null
  try {
    const { stdout } = await execFileP(
      'secret-tool',
      ['lookup', 'application', 'chrome_libsecret_os_crypt_password_v2'],
      { timeout: 1000 }
    )
    const key = stdout.trim()
    return key || null
  } catch {
    return null
  }
}

export function normalizeExpirationDate(rawExp?: number): number | undefined {
  if (!rawExp || rawExp <= 0) return undefined
  // Chrome Windows epoch in microseconds since 1601 (> 1e16)
  if (rawExp > 1e16) {
    const CHROME_EPOCH_OFFSET_MICROS = 11644473600000000
    const diff = (rawExp - CHROME_EPOCH_OFFSET_MICROS) / 1e6
    return diff > 0 ? Math.floor(diff) : undefined
  }
  // Firefox Unix epoch in microseconds since 1970 (> 1e14 && <= 1e16)
  if (rawExp > 1e14) {
    return Math.floor(rawExp / 1e6)
  }
  // Chrome timestamp in seconds since 1601 (> 1e10 && < 1e12)
  if (rawExp > 1e10 && rawExp < 1e12) {
    const CHROME_EPOCH_OFFSET_SEC = 11644473600
    const diff = rawExp - CHROME_EPOCH_OFFSET_SEC
    return diff > 0 ? Math.floor(diff) : undefined
  }
  // Unix timestamp in milliseconds (> 1e11 && <= 1e14)
  if (rawExp > 1e11) {
    return Math.floor(rawExp / 1000)
  }
  // Standard Unix timestamp in seconds
  return Math.floor(rawExp)
}

async function readChromeCookies(
  profile: BrowserProfile,
  scope: 'google' | 'all' = 'all'
): Promise<BrowserCookie[]> {
  const currentPlatform = platform()
  let winMasterKey: Buffer | null = null

  if (currentPlatform === 'win32' && profile.localState) {
    winMasterKey = await getWindowsMasterKey(profile.localState)
  }

  let linuxPassword: string | null = null
  if (currentPlatform === 'linux') {
    if (profile.localState) {
      linuxPassword = chromiumKeyFromLocalState(profile.localState) || null
    }
    if (!linuxPassword) {
      const k = await chromiumKeyViaSecretTool()
      if (k) linuxPassword = k
    }
  }

  const out: BrowserCookie[] = []
  return withTempSqliteDb(profile.cookieDb, (db) => {
    const query =
      scope === 'google'
        ? `SELECT host_key, name, value, encrypted_value, path, is_secure, is_httponly,
                  CAST(expires_utc AS REAL) AS expires_utc, CAST(last_access_utc AS REAL) AS last_access_utc, samesite
           FROM cookies WHERE host_key LIKE '%google%'`
        : `SELECT host_key, name, value, encrypted_value, path, is_secure, is_httponly,
                  CAST(expires_utc AS REAL) AS expires_utc, CAST(last_access_utc AS REAL) AS last_access_utc, samesite
           FROM cookies WHERE ${SQL_CHROME_AI_WHERE}`

    const rows = db.prepare(query).all() as Array<{
      host_key: string
      name: string
      value: string
      encrypted_value: Uint8Array
      path: string
      is_secure: number
      is_httponly: number
      expires_utc: number
      last_access_utc?: number
      samesite?: number
    }>

    const pattern = scope === 'google' ? GOOGLE_HOST_PATTERN : AI_HOST_PATTERN
    for (const row of rows) {
      if (!pattern.test(row.host_key)) continue
      let value = row.value
      if (!value && row.encrypted_value?.length) {
        if (currentPlatform === 'win32' && winMasterKey) {
          value = decryptWindowsChromeValue(row.encrypted_value, winMasterKey) ?? ''
        } else {
          value = decryptLinuxChromeValue(row.encrypted_value, linuxPassword ?? 'peanuts') ?? ''
        }
        if (!value && row.encrypted_value.length > 3) continue
      }

      let sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict' | undefined = undefined
      if (row.samesite === 0) sameSite = 'unspecified'
      else if (row.samesite === 1) sameSite = 'lax'
      else if (row.samesite === 2) sameSite = 'strict'

      out.push({
        name: row.name,
        value,
        domain: row.host_key,
        path: row.path,
        secure: !!row.is_secure,
        httpOnly: !!row.is_httponly,
        expirationDate: normalizeExpirationDate(row.expires_utc),
        lastAccessed: normalizeExpirationDate(row.last_access_utc),
        sameSite
      })
    }
    return out
  })
}

async function readFirefoxCookies(
  profile: BrowserProfile,
  scope: 'google' | 'all' = 'all'
): Promise<BrowserCookie[]> {
  const out: BrowserCookie[] = []
  return withTempSqliteDb(profile.cookieDb, (db) => {
    const query =
      scope === 'google'
        ? `SELECT host, name, value, path, isSecure, isHttpOnly, expiry,
                  CAST(lastAccessed AS REAL) AS lastAccessed, sameSite
           FROM moz_cookies WHERE host LIKE '%google%'`
        : `SELECT host, name, value, path, isSecure, isHttpOnly, expiry,
                  CAST(lastAccessed AS REAL) AS lastAccessed, sameSite
           FROM moz_cookies WHERE ${SQL_FIREFOX_AI_WHERE}`

    const rows = db.prepare(query).all() as Array<{
      host: string
      name: string
      value: string
      path: string
      isSecure: number
      isHttpOnly: number
      expiry: number
      lastAccessed: number
      sameSite?: number
    }>

    const pattern = scope === 'google' ? GOOGLE_HOST_PATTERN : AI_HOST_PATTERN
    for (const row of rows) {
      if (!pattern.test(row.host)) continue

      let sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict' | undefined = undefined
      if (row.sameSite === 0) sameSite = 'unspecified'
      else if (row.sameSite === 1) sameSite = 'lax'
      else if (row.sameSite === 2) sameSite = 'strict'

      out.push({
        name: row.name,
        value: row.value,
        domain: row.host,
        path: row.path,
        secure: !!row.isSecure,
        httpOnly: !!row.isHttpOnly,
        expirationDate: normalizeExpirationDate(row.expiry),
        lastAccessed: normalizeExpirationDate(row.lastAccessed),
        sameSite
      })
    }
    return out
  })
}

export async function readBrowserCookies(
  profile: BrowserProfile,
  scope: 'google' | 'all' = 'all'
): Promise<BrowserCookie[]> {
  const isFirefoxFamily = profile.browser === 'firefox' || profile.browser === 'floorp'
  const all = isFirefoxFamily
    ? await readFirefoxCookies(profile, scope)
    : await readChromeCookies(profile, scope)

  const candidateCookies = all

  // Deduplicate by (name, domain, path), keeping the most recently accessed
  const best = new Map<string, BrowserCookie>()
  for (const c of candidateCookies) {
    const key = `${c.name}|${c.domain}|${c.path}`
    const prev = best.get(key)
    if (!prev || (c.lastAccessed ?? 0) >= (prev.lastAccessed ?? 0)) {
      best.set(key, c)
    }
  }
  return [...best.values()]
}

export function parseCookieEditorJson(jsonStr: string): BrowserCookie[] {
  let raw: unknown
  try {
    raw = JSON.parse(jsonStr.trim())
  } catch (err) {
    throw new Error(`Invalid JSON format: ${(err as Error).message}`)
  }

  const list = Array.isArray(raw) ? raw : [raw]
  const cookies: BrowserCookie[] = []

  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const name = String(obj.name ?? '').trim()
    const value = String(obj.value ?? '')
    const domain = String(obj.domain ?? '').trim()
    if (!name || !domain) continue

    const path = String(obj.path || '/')
    const secure = Boolean(obj.secure)
    const httpOnly = Boolean(obj.httpOnly ?? obj.httponly)

    const rawExp = obj.expirationDate ?? obj.expiry ?? obj.expires
    let expirationDate: number | undefined = undefined
    if (typeof rawExp === 'number') {
      expirationDate = normalizeExpirationDate(rawExp)
    }

    cookies.push({
      name,
      value,
      domain,
      path,
      secure,
      httpOnly,
      expirationDate,
      sameSite: typeof obj.sameSite === 'string' ? obj.sameSite : undefined
    })
  }

  if (cookies.length === 0) {
    throw new Error(
      'No valid cookies found in JSON payload. Please export an array containing cookie objects with name, value, and domain.'
    )
  }

  return cookies
}

export async function verifyGoogleSession(
  cookies: BrowserCookie[]
): Promise<{ ok: boolean; email?: string }> {
  const hasAuth = cookies.some(
    (c) => c.name === 'SID' || c.name === '__Secure-1PSID' || c.name === '__Secure-3PSID'
  )
  if (!hasAuth) return { ok: false }

  // Extract email hint from ACCOUNT_CHOOSER if available
  const ac = cookies.find((c) => c.name === 'ACCOUNT_CHOOSER')
  let emailHint: string | undefined = undefined
  if (ac?.value) {
    try {
      const decoded = decodeURIComponent(ac.value)
      const m = decoded.match(
        /[\w.+-]+@(?:gmail\.com|googlemail\.com|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/
      )
      if (m) emailHint = m[0]
    } catch {
      // ignore
    }
  }

  // Filter root domain cookies to keep request header clean
  const rootCookies = cookies.filter(
    (c) => c.domain === '.google.com' || c.domain === 'google.com' || c.domain === 'www.google.com'
  )
  const header = (rootCookies.length > 0 ? rootCookies : cookies)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ')

  try {
    const resp = await fetch('https://www.google.com/', {
      headers: {
        Cookie: header,
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(6000)
    })
    const text = await resp.text()
    const emailMatch = text.match(/"([\w.+-]+@(?:gmail\.com|googlemail\.com))"/)
    if (emailMatch) return { ok: true, email: emailMatch[1] }
    const signedIn =
      text.includes('gb_') &&
      !text.includes('ServiceLogin') &&
      !resp.url.includes('accounts.google.com/ServiceLogin')
    if (signedIn) return { ok: true, email: emailHint }
  } catch {
    // ignore network/rate-limit error
  }

  return { ok: true, email: emailHint }
}
