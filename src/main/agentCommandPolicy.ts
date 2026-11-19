/**
 * Command policy for the agent bridge (plan 01, step 6).
 *
 * The rule the plan keeps repeating: an allowlist of *command names* is not a policy. A
 * script called `test` can do anything, and `sh -c` makes every word after it irrelevant. So
 * a decision here is made from the exact executable + argv + cwd, and three classes are
 * never silently allowed:
 *
 *  - **interpreters** (`sh -c`, `bash -c`, `python -c`, `node -e`, …) — the argument is a
 *    program, so only the user can approve it;
 *  - **destructive / irreversible** (`rm -rf`, `git reset --hard`, `git push`, `mkfs`, `dd`) —
 *    always ask, even inside an approved command;
 *  - **network and installs** — governed by the egress policy; here the default is **off**,
 *    which denies rather than asks, because a policy that is off should not be negotiable by
 *    the agent at runtime.
 *
 * `allow` is only ever returned for an exact (executable, argv, cwd) tuple the user approved,
 * inside the project root, with no shell metacharacters anywhere.
 */

export interface CommandRequest {
  executable: string
  args: string[]
  cwd: string
  /** Free text shown to the user; never used for the decision. */
  purpose?: string
}

export interface ApprovedCommand {
  executable: string
  /** Exact argv. An empty array means "this binary with no arguments only". */
  args: string[]
  /** `project` approvals die with the session; `global` ones persist. */
  scope: 'project' | 'global'
  cwd?: string
  approvedAt: number
}

export type EgressPolicy = 'off' | 'allowlist' | 'ask'

export interface CommandPolicyContext {
  projectRoot: string
  /** Absolute directories the command may run in; defaults to the project root. */
  allowedCwds?: string[]
  approved: ApprovedCommand[]
  egress: EgressPolicy
  /** Hosts allowed when egress is 'allowlist'. Advisory only — see the note in the verdict. */
  egressAllowlist?: string[]
  /** Paths that must never appear in argv (credentials, keys, agent state). */
  protectedPaths?: string[]
}

export type CommandVerdictCode =
  | 'not-approved'
  | 'requires-user-approval'
  | 'always-asks'
  | 'destructive'
  | 'interpreter'
  | 'network-denied'
  | 'outside-project'
  | 'shell-metacharacters'
  | 'absolute-path-argument'
  | 'protected-path'
  | 'invalid-request'

export type CommandVerdict =
  | { decision: 'allow'; reason: string }
  | { decision: 'ask'; code: CommandVerdictCode; reason: string }
  | { decision: 'deny'; code: CommandVerdictCode; reason: string }

const SHELL_METACHARACTERS = [';', '|', '&', '`', '$', '>', '<', '\n', '\r', '*', '?', '~']

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'cmd', 'cmd.exe', 'powershell', 'pwsh'])
const INTERPRETERS = new Set(['python', 'python3', 'node', 'perl', 'ruby', 'php', 'deno', 'bun', 'tclsh'])

const NETWORK_BINARIES = new Set([
  'curl',
  'wget',
  'nc',
  'ncat',
  'netcat',
  'ssh',
  'scp',
  'sftp',
  'rsync',
  'ftp',
  'telnet',
  'aria2c'
])

const PACKAGE_INSTALLERS = new Set(['npm', 'pnpm', 'yarn', 'pip', 'pip3', 'apt', 'apt-get', 'brew', 'cargo', 'gem', 'go'])

const DESTRUCTIVE_BINARIES = new Set(['rm', 'rmdir', 'mkfs', 'dd', 'shred', 'chmod', 'chown', 'shutdown', 'reboot'])

const baseName = (path: string): string => path.split('/').pop() ?? path

const isUnder = (candidate: string, root: string): boolean => {
  const clean = root.replace(/\/+$/, '')
  return candidate === clean || candidate.startsWith(`${clean}/`)
}

function hasMetacharacters(value: string): boolean {
  return SHELL_METACHARACTERS.some((character) => value.includes(character))
}

/** Git verbs that rewrite or publish history rather than inspect it. */
function isDangerousGit(args: string[]): boolean {
  const verb = args[0]
  if (!verb) return false
  if (verb === 'push' || verb === 'clean') return true
  if (verb === 'reset' && (args.includes('--hard') || args.includes('--merge'))) return true
  if (verb === 'checkout' && args.includes('--')) return false
  if (verb === 'branch' && (args.includes('-D') || args.includes('--delete'))) return true
  if (verb === 'rebase' || verb === 'filter-branch') return true
  return false
}

export function assessCommand(request: CommandRequest, context: CommandPolicyContext): CommandVerdict {
  if (!request || typeof request.executable !== 'string' || request.executable.length === 0) {
    return { decision: 'deny', code: 'invalid-request', reason: 'No executable was given.' }
  }
  if (!Array.isArray(request.args) || !request.args.every((arg) => typeof arg === 'string')) {
    return { decision: 'deny', code: 'invalid-request', reason: 'Arguments must be a list of strings.' }
  }
  if (typeof request.cwd !== 'string' || !request.cwd.startsWith('/')) {
    return { decision: 'deny', code: 'invalid-request', reason: 'A command needs an absolute working directory.' }
  }

  const roots = context.allowedCwds?.length ? context.allowedCwds : [context.projectRoot]
  if (!roots.some((root) => isUnder(request.cwd, root))) {
    return {
      decision: 'deny',
      code: 'outside-project',
      reason: `The command would run in ${request.cwd}, outside the bound project.`
    }
  }

  for (const argument of request.args) {
    if (hasMetacharacters(argument)) {
      return {
        decision: 'deny',
        code: 'shell-metacharacters',
        reason: `The argument "${argument}" contains a shell metacharacter. Nexus runs commands without a shell, so this cannot be expressed safely.`
      }
    }
  }
  if (hasMetacharacters(request.executable)) {
    return {
      decision: 'deny',
      code: 'shell-metacharacters',
      reason: 'The executable name contains a shell metacharacter.'
    }
  }

  const name = baseName(request.executable)
  const protectedPaths = context.protectedPaths ?? []
  for (const argument of request.args) {
    if (argument.startsWith('/') && !(roots.some((root) => isUnder(argument, root)) || isUnder(argument, '/tmp'))) {
      return {
        decision: 'deny',
        code: 'absolute-path-argument',
        reason: `The argument "${argument}" is an absolute path outside the project and outside the temp area.`
      }
    }
    for (const protectedPath of protectedPaths) {
      if (argument.includes(protectedPath)) {
        return {
          decision: 'deny',
          code: 'protected-path',
          reason: `The argument references a protected path (${protectedPath}).`
        }
      }
    }
  }

  // Interpreters: the argument is a program, so no allowlist can describe it.
  if (SHELLS.has(name) || INTERPRETERS.has(name)) {
    const inline = request.args.some((arg) => arg === '-c' || arg === '-e' || arg === '--eval' || arg === '-Command')
    if (SHELLS.has(name) || inline) {
      return {
        decision: 'ask',
        code: 'interpreter',
        reason: `${name} can run arbitrary code, so only you can approve this exact command. A script labelled "test" can do anything.`
      }
    }
  }

  if (DESTRUCTIVE_BINARIES.has(name)) {
    return {
      decision: 'ask',
      code: 'destructive',
      reason: `${name} is destructive or irreversible. Nexus cannot undo it.`
    }
  }
  if (name === 'git' && isDangerousGit(request.args)) {
    return {
      decision: 'ask',
      code: 'destructive',
      reason: 'This git command rewrites or publishes history.'
    }
  }

  const wantsNetwork =
    NETWORK_BINARIES.has(name) ||
    (PACKAGE_INSTALLERS.has(name) && request.args.some((arg) => ['install', 'add', 'i', 'get', 'update', 'upgrade'].includes(arg)))

  if (wantsNetwork) {
    if (context.egress === 'off') {
      return {
        decision: 'deny',
        code: 'network-denied',
        reason:
          'Network access is switched off for isolated runs, so this command cannot run. Nexus cannot verify which host an arbitrary binary contacts, so it does not pretend to filter by host.'
      }
    }
    return {
      decision: 'ask',
      code: 'requires-user-approval',
      reason:
        'This command reaches the network. Even with an allowlist Nexus cannot see the hosts an arbitrary binary contacts, so it asks instead of assuming.'
    }
  }

  const approvedExact = context.approved.find(
    (entry) =>
      baseName(entry.executable) === name &&
      entry.args.length === request.args.length &&
      entry.args.every((arg, index) => arg === request.args[index]) &&
      (!entry.cwd || entry.cwd === request.cwd)
  )

  if (approvedExact) {
    return {
      decision: 'allow',
      reason: `Exactly the approved command (${name} ${request.args.join(' ')}).`.trim()
    }
  }

  // A bare "npm test" style approval exists but the arguments differ: do not stretch it.
  const sameBinary = context.approved.find((entry) => baseName(entry.executable) === name)
  if (sameBinary) {
    return {
      decision: 'ask',
      code: 'not-approved',
      reason: `"${name}" is approved, but not with these arguments. Nexus does not widen an approval.`
    }
  }

  return {
    decision: 'ask',
    code: 'requires-user-approval',
    reason: `"${name} ${request.args.join(' ')}" has not been approved for this session.`
  }
}

/** The class the UI must always show, even when the tuple was approved earlier. */
export function alwaysAsks(request: CommandRequest): boolean {
  const verdict = assessCommand(request, {
    projectRoot: '/',
    approved: [],
    egress: 'off',
    allowedCwds: ['/']
  })
  return verdict.decision === 'ask' && (verdict.code === 'interpreter' || verdict.code === 'destructive')
}

/** Human-readable line for the approval dialog. Never truncated silently. */
export function describeCommand(request: CommandRequest): string {
  return `${request.executable} ${request.args.join(' ')}   (cwd: ${request.cwd})`.trim()
}
