// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync, statSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { BROWSER_IMPORT_UI } from './featureFlags'

const rendererRoot = resolve(__dirname, '..')
const settingsSource = readFileSync(resolve(rendererRoot, 'components/SettingsOverlay.tsx'), 'utf8')

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * Every renderer module the app actually loads, walking relative imports from the entry point.
 *
 * The first version of this test walked the directory instead, and it failed the build for a file the app
 * never imported — a leftover copy of the settings overlay (`SettingsOverlay_gemini.tsx`) kept on disk
 * next to the real one. What matters is what ships and renders, so the test follows the import graph; a
 * dead copy is ignored, and the moment something imports it the test goes red again.
 */
function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>()
  const queue = [entry]

  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    if (!/\.(ts|tsx)$/.test(file)) continue

    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const match of source.matchAll(/from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const base = resolve(dirname(file), match[1] ?? match[2])
      const target = [`${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx'), base].find(
        (candidate) => isFile(candidate) && /\.(ts|tsx)$/.test(candidate)
      )
      if (target && !seen.has(target)) queue.push(target)
    }
  }
  return seen
}

const loadedModules = reachableFrom(resolve(rendererRoot, 'main.tsx'))

describe('build 36 — importing from another browser is gone from the UI', () => {
  it('the flag is off', () => {
    expect(BROWSER_IMPORT_UI).toBe(false)
  })

  it('the whole browser-sync card sits behind the flag, and nothing else does', () => {
    const gate = settingsSource.indexOf('{BROWSER_IMPORT_UI && (')
    expect(gate).toBeGreaterThan(-1)
    const heading = settingsSource.indexOf('Universal Browser Session Sync')
    expect(heading).toBeGreaterThan(gate)

    // Everything that only exists for the import flow: the scan, the folder picker, the detected-profile
    // grid and the per-profile Import buttons — all of it must fall inside the gate.
    const markers = [
      'Scan all detected browser profiles',
      'Select a custom or portable browser profile folder',
      'Detected Browser Profiles (',
      'No browser profiles automatically detected'
    ]
    const gateEnd = settingsSource.indexOf('Configured Provider Matrix & Direct Portals')
    expect(gateEnd).toBeGreaterThan(heading)
    for (const marker of markers) {
      const at = settingsSource.indexOf(marker)
      expect(at, `${marker} missing`).toBeGreaterThan(gate)
      expect(at, `${marker} escaped the gate`).toBeLessThan(gateEnd)
    }
  })

  it('finds the app it is scanning, so a clean result means something', () => {
    expect(loadedModules.size).toBeGreaterThan(60)
    expect([...loadedModules].some((f) => f.endsWith('components/SettingsOverlay.tsx'))).toBe(true)
  })

  it('no renderer module the app loads shows an import surface', () => {
    const offenders: string[] = []
    for (const file of loadedModules) {
      // The flag's own doc comment explains what it hides; it renders nothing.
      if (file.endsWith('components/SettingsOverlay.tsx') || file.endsWith('lib/featureFlags.ts')) continue
      if (!existsSync(file)) continue
      const text = readFileSync(file, 'utf8')
      if (/Universal Browser Session Sync|Import sessions from|import sessions from your browser/i.test(text)) {
        offenders.push(file.replace(rendererRoot, ''))
      }
    }
    expect(offenders).toEqual([])
  })

  it('renders exactly one settings overlay', () => {
    // A second copy on disk is dead weight; a second copy the app loads is a second place for the import
    // card to come back from. There is one.
    const overlays = [...loadedModules].filter((f) => /components\/SettingsOverlay\.tsx$/.test(f))
    expect(overlays.length).toBe(1)
  })

  it('the ordinary sign-in card is still there, and still first', () => {
    const signIn = settingsSource.indexOf('Sign in inside Nexus')
    expect(signIn).toBeGreaterThan(-1)
    expect(signIn).toBeLessThan(settingsSource.indexOf('{BROWSER_IMPORT_UI && ('))
  })

  it('the old guide is no longer rendered, and the F1 entry point is', () => {
    const app = readFileSync(resolve(rendererRoot, 'App.tsx'), 'utf8')
    expect(app).not.toContain('ZenGuideModal')
    expect(app).toContain('<GuideTour')
    expect(settingsSource).toContain('Nexus Guide (F1)')
  })
})
