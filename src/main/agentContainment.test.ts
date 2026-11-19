import { describe, it, expect } from 'vitest'
import {
  describeContainment,
  detectCapabilities,
  evaluateContainment,
  recordContainmentProof
} from './agentContainment'

// `binaries` holds both PATH names ('bwrap') and full paths, because the probe asks for the
// name and the evidence quotes the path.
const linux = (files: Record<string, string>, binaries: string[] = []): Parameters<typeof detectCapabilities>[0] => ({
  platform: 'linux' as const,
  exists: (candidate: string) => files[candidate] !== undefined || binaries.includes(candidate),
  readFile: (candidate: string) => files[candidate] ?? '',
  which: (binary: string) => (binaries.includes(binary) ? `/usr/bin/${binary}` : null),
  now: () => 1_700_000_000_000
})

describe('capability detection', () => {
  it('reports what it found, with the evidence', () => {
    const capabilities = detectCapabilities(
      linux({ '/sys/kernel/security/lsm': 'capability,landlock,yama' }, ['bwrap', '/usr/bin/bwrap'])
    )
    expect(capabilities.bubblewrap).toBe(true)
    expect(capabilities.landlock).toBe(true)
    expect(capabilities.evidence.join(' ')).toContain('landlock')
    expect(capabilities.evidence.join(' ')).toContain('/usr/bin/bwrap')
  })

  it('does not claim landlock when the LSM list omits it', () => {
    const capabilities = detectCapabilities(linux({ '/sys/kernel/security/lsm': 'capability,yama' }))
    expect(capabilities.landlock).toBe(false)
  })

  it('says so when the kernel security filesystem is unreadable', () => {
    const capabilities = detectCapabilities(linux({}))
    expect(capabilities.evidence.join(' ')).toContain('unreadable')
  })

  it('treats a missing userns sysctl as "not gated" and 0 as disabled', () => {
    expect(detectCapabilities(linux({})).userNamespaces).toBe(true)
    expect(
      detectCapabilities(linux({ '/proc/sys/kernel/unprivileged_userns_clone': '0' })).userNamespaces
    ).toBe(false)
  })

  it('claims nothing on Windows or macOS', () => {
    const win = detectCapabilities({ platform: 'win32' })
    expect(win.bubblewrap).toBe(false)
    expect(win.landlock).toBe(false)
    expect(win.evidence.join(' ')).toContain('not probed')
    const mac = detectCapabilities({ platform: 'darwin' })
    expect(mac.evidence.join(' ')).toContain('no supported containment')
  })
})

describe('effective containment', () => {
  it('is blocked by default policy, whatever the machine supports', () => {
    const state = evaluateContainment(
      linux({ '/sys/kernel/security/lsm': 'landlock' }, ['bwrap', '/usr/bin/bwrap'])
    )
    expect(state.state).toBe('blocked')
    if (state.state === 'blocked') {
      expect(state.reason).toContain('switched off by policy')
      // Capabilities are still reported so the user can see what their machine could do.
      expect(state.capabilities.bubblewrap).toBe(true)
    }
  })

  it('does not promote "a sandbox exists" to "containment is proven"', () => {
    const state = evaluateContainment({
      ...linux({ '/sys/kernel/security/lsm': 'landlock' }, ['bwrap', '/usr/bin/bwrap']),
      mode: 'require-proof'
    })
    expect(state.state).toBe('unavailable')
    if (state.state === 'unavailable') {
      expect(state.reason).toContain('Presence is not proof')
      expect(state.reason).toContain('bubblewrap')
    }
  })

  it('reports no mechanism on a bare machine', () => {
    const state = evaluateContainment({ ...linux({}), mode: 'require-proof' })
    expect(state.state).toBe('unavailable')
    if (state.state === 'unavailable') expect(state.reason).toContain('No sandbox mechanism')
  })
})

describe('proof recording', () => {
  const capabilities = detectCapabilities(linux({}))

  it('promotes to enforced only when every hostile fixture was blocked', () => {
    const state = recordContainmentProof({
      mechanism: 'bubblewrap',
      capabilities,
      cases: [
        { name: 'write outside bind mount', blocked: true },
        { name: 'escape via child process', blocked: true }
      ]
    })
    expect(state.state).toBe('enforced')
    if (state.state === 'enforced') {
      expect(state.proof).toContain('2 hostile fixture(s)')
      expect(state.mechanism).toBe('bubblewrap')
    }
  })

  it('stays unavailable when one fixture escaped', () => {
    const state = recordContainmentProof({
      mechanism: 'bubblewrap',
      capabilities,
      cases: [
        { name: 'write outside bind mount', blocked: true },
        { name: 'shell redirect', blocked: false }
      ]
    })
    expect(state.state).toBe('unavailable')
    if (state.state === 'unavailable') {
      expect(state.reason).toContain('shell redirect')
      expect(state.reason).toContain('stay blocked')
    }
  })

  it('refuses to certify an unnamed mechanism or an empty run', () => {
    expect(
      recordContainmentProof({ mechanism: 'none', capabilities, cases: [{ name: 'x', blocked: true }] }).state
    ).toBe('unavailable')
    expect(recordContainmentProof({ mechanism: 'bubblewrap', capabilities, cases: [] }).state).toBe('unavailable')
  })
})

describe('wording', () => {
  it('never says "OK" without a reason', () => {
    const blocked = evaluateContainment()
    expect(describeContainment(blocked)).toContain('Edits blocked')
    const proven = recordContainmentProof({
      mechanism: 'landlock',
      capabilities: detectCapabilities(),
      cases: [{ name: 'write outside project', blocked: true }]
    })
    expect(describeContainment(proven)).toContain('Contained by landlock')
    expect(describeContainment(blocked)).not.toMatch(/^OK/)
  })
})
