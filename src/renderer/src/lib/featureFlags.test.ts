// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join } from 'path'
import { BROWSER_IMPORT_UI } from './featureFlags'

const rendererRoot = resolve(__dirname, '..')
const settingsSource = readFileSync(resolve(rendererRoot, 'components/SettingsOverlay.tsx'), 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules') continue
      walk(full, out)
    } else if (/\.(tsx|ts|css)$/.test(entry) && !/\.test\.(tsx|ts)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

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

  it('no other renderer file shows an import surface', () => {
    const offenders: string[] = []
    for (const file of walk(rendererRoot)) {
      // The flag's own doc comment explains what it hides; it renders nothing.
      if (file.endsWith('SettingsOverlay.tsx') || file.endsWith('lib/featureFlags.ts')) continue
      const text = readFileSync(file, 'utf8')
      if (/Universal Browser Session Sync|Import sessions from|import sessions from your browser/i.test(text)) {
        offenders.push(file.replace(rendererRoot, ''))
      }
    }
    expect(offenders).toEqual([])
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
