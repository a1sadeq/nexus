import * as fs from 'fs'
import * as path from 'path'

/**
 * Containment probe for the agent bridge (plan 01, steps 4–5).
 *
 * The plan is blunt about this: a worktree, a model instruction, an edit-tool permission or
 * a command allowlist is **not** a sandbox. So this module does not describe an intention to
 * contain; it reports one of exactly three states:
 *
 *   enforced    — a real mechanism was found AND a hostile fixture proved it blocks a write
 *                 outside the allowed area;
 *   unavailable — nothing proved it;
 *   blocked     — the user's chosen policy is "no autonomous edits", which is the default.
 *
 * The current policy is `block-only`: capabilities are still *reported* (so the UI can tell
 * the user what their machine could do), but the effective verdict is `blocked` and the edit
 * gate refuses every write. That is a deliberate choice, not a missing feature.
 */

export type ContainmentMechanism = 'bubblewrap' | 'landlock' | 'windows-job' | 'none'

export interface ContainmentCapabilities {
  /** bubblewrap binary found on PATH. */
  bubblewrap: boolean
  /** Landlock listed in the kernel's active LSMs. */
  landlock: boolean
  /** Unprivileged user namespaces appear enabled. */
  userNamespaces: boolean
  checkedAt: number
  /** Paths and files inspected, so the user can see what the answer is based on. */
  evidence: string[]
}

export type ContainmentMode = 'block-only' | 'require-proof'

export type ContainmentState =
  | {
      state: 'enforced'
      mechanism: ContainmentMechanism
      /** What was actually observed, quoted. */
      proof: string
    }
  | { state: 'unavailable'; reason: string; capabilities: ContainmentCapabilities }
  | { state: 'blocked'; reason: string; capabilities: ContainmentCapabilities }

export interface ProbeOptions {
  /** User policy. `block-only` is the default and the only configured value today. */
  mode?: ContainmentMode
  /** Injected for tests. */
  exists?: (candidate: string) => boolean
  readFile?: (candidate: string) => string
  platform?: NodeJS.Platform
  now?: () => number
  /** Commands to look for on PATH (injected in tests, never executed here). */
  which?: (binary: string) => string | null
}

const LSM_PATH = '/sys/kernel/security/lsm'
const USERNS_PATH = '/proc/sys/kernel/unprivileged_userns_clone'

function defaultExists(candidate: string): boolean {
  try {
    return fs.existsSync(candidate)
  } catch {
    return false
  }
}

function defaultRead(candidate: string): string {
  try {
    return fs.readFileSync(candidate, 'utf8')
  } catch {
    return ''
  }
}

function defaultWhich(binary: string): string | null {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    const full = path.join(dir, binary)
    if (defaultExists(full)) return full
  }
  return null
}

export function detectCapabilities(options: ProbeOptions = {}): ContainmentCapabilities {
  const read = options.readFile ?? defaultRead
  const which = options.which ?? defaultWhich
  const platform = options.platform ?? process.platform
  const now = options.now ?? Date.now
  const evidence: string[] = []

  let bubblewrap = false
  let landlock = false
  let userNamespaces = false

  if (platform === 'linux') {
    const bwrap = which('bwrap')
    bubblewrap = bwrap !== null
    evidence.push(bubblewrap ? `found ${bwrap}` : 'no bwrap on PATH')

    const lsm = read(LSM_PATH)
    if (lsm) {
      landlock = lsm.split(',').map((entry) => entry.trim()).includes('landlock')
      evidence.push(`${LSM_PATH}: ${lsm.trim()}`)
    } else {
      evidence.push(`${LSM_PATH}: unreadable (kernel security filesystem not mounted?)`)
    }

    const userns = read(USERNS_PATH).trim()
    // A missing file means the distribution never gated it; only "0" is a definitive no.
    userNamespaces = userns === '' ? true : userns !== '0'
    evidence.push(userns === '' ? `${USERNS_PATH}: absent` : `${USERNS_PATH}: ${userns}`)
  } else if (platform === 'win32') {
    evidence.push('Windows: job objects/appcontainer are not probed by this build')
  } else {
    evidence.push(`${platform}: no supported containment mechanism`)
  }

  return { bubblewrap, landlock, userNamespaces, checkedAt: now(), evidence }
}

/**
 * Decide what containment is in force. `require-proof` never returns `enforced` unless a
 * hostile fixture run was supplied and passed — and this build cannot run one, so it returns
 * `unavailable` with the capabilities attached.
 */
export function evaluateContainment(options: ProbeOptions = {}): ContainmentState {
  const mode = options.mode ?? 'block-only'
  const capabilities = detectCapabilities(options)

  if (mode === 'block-only') {
    return {
      state: 'blocked',
      reason:
        'Autonomous edits are switched off by policy. The agent may propose patches, but Nexus will not write to your project. Change this only after a containment mechanism has been proven on this machine.',
      capabilities
    }
  }

  const mechanism: ContainmentMechanism = capabilities.bubblewrap
    ? 'bubblewrap'
    : capabilities.landlock
      ? 'landlock'
      : 'none'

  if (mechanism === 'none') {
    return {
      state: 'unavailable',
      reason:
        'No sandbox mechanism was found on this machine, so Nexus cannot prove that an agent cannot write outside the sandbox. Automated edits stay blocked.',
      capabilities
    }
  }

  // A mechanism existing is not proof that it works. Without a passed hostile fixture the
  // honest answer remains "unavailable".
  return {
    state: 'unavailable',
    reason: `${mechanism} is present, but no hostile fixture has been run to prove it blocks writes outside the sandbox. Presence is not proof.`,
    capabilities
  }
}

/**
 * Record the result of a hostile-fixture run. Only a full pass promotes to `enforced`; every
 * other outcome (partial run, error, skipped case) stays `unavailable`.
 */
export function recordContainmentProof(input: {
  mechanism: ContainmentMechanism
  cases: { name: string; blocked: boolean }[]
  capabilities: ContainmentCapabilities
}): ContainmentState {
  if (!Array.isArray(input.cases) || input.cases.length === 0) {
    return {
      state: 'unavailable',
      reason: 'No hostile fixtures were run, so containment is unproven.',
      capabilities: input.capabilities
    }
  }
  const escaped = input.cases.filter((testCase) => !testCase.blocked)
  if (escaped.length > 0) {
    return {
      state: 'unavailable',
      reason: `Containment failed its own fixtures (${escaped
        .map((testCase) => testCase.name)
        .join(', ')}). Automated edits stay blocked.`,
      capabilities: input.capabilities
    }
  }
  if (input.mechanism === 'none') {
    return {
      state: 'unavailable',
      reason: 'Fixtures passed but no mechanism was named, which cannot be verified.',
      capabilities: input.capabilities
    }
  }
  return {
    state: 'enforced',
    mechanism: input.mechanism,
    proof: `${input.cases.length} hostile fixture(s) blocked by ${input.mechanism}: ${input.cases
      .map((testCase) => testCase.name)
      .join(', ')}.`
  }
}

/** One-line status for the UI. Always states the reason, never just "OK". */
export function describeContainment(state: ContainmentState): string {
  switch (state.state) {
    case 'enforced':
      return `Contained by ${state.mechanism}: ${state.proof}`
    case 'blocked':
      return `Edits blocked: ${state.reason}`
    case 'unavailable':
      return `No proven containment: ${state.reason}`
  }
}
