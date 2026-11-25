/**
 * When Nexus asks about a new version, and when a downloaded one installs itself.
 *
 * The old policy was one check 30 seconds after launch and one every six hours. Two things were wrong
 * with it. Six hours is a long time to sit on a fix — a friend who is told "build 41 fixes the sign-in"
 * can still be running build 39 at dinner. And when a check failed (no network on the train, GitHub
 * briefly unhappy) the next attempt was six hours away, so one lost packet cost the whole day.
 *
 * What it is now: a quick first check, a steady quarter-hour cadence while the app runs, an immediate
 * retry-on-wake/nudge, and backoff only when something is actually failing. All of it is a pure
 * decision — no Electron, no timers — so the numbers can be tested instead of trusted.
 */

export interface UpdateCadence {
  /** First check after launch. Short, because most people open the app for minutes, not hours. */
  firstCheckDelayMs: number
  /** Steady cadence while idle. Fifteen minutes: frequent enough to meet a release the same day. */
  checkIntervalMs: number
  /** After a failed check: the first retry. Doubles per failure up to `retryMaxMs`. */
  retryBaseMs: number
  retryMaxMs: number
  /** A nudge (wake from sleep, window focus back) never checks more often than this. */
  nudgeThrottleMs: number
  /** How long a downloaded update waits before installing itself. */
  autoInstallDelayMs: number
  /** How far "Later" pushes the automatic install. */
  deferMs: number
  /** Proportion of the interval added or removed at random, so a hundred machines do not sync up. */
  jitterRatio: number
}

export const UPDATE_CADENCE: UpdateCadence = {
  firstCheckDelayMs: 8_000,
  checkIntervalMs: 15 * 60_000,
  retryBaseMs: 5 * 60_000,
  retryMaxMs: 60 * 60_000,
  nudgeThrottleMs: 60_000,
  autoInstallDelayMs: 5 * 60_000,
  deferMs: 60 * 60_000,
  jitterRatio: 0.08
}

/**
 * A delay with ±jitter, never negative. `random` is injected so a test can pin it to 0.5 (no jitter) or
 * to the extremes.
 */
export function jittered(ms: number, random: () => number, cadence: UpdateCadence = UPDATE_CADENCE): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0
  const spread = ms * cadence.jitterRatio
  const roll = Number(random())
  const safeRoll = Number.isFinite(roll) ? Math.min(Math.max(roll, 0), 1) : 0.5
  return Math.max(1_000, Math.round(ms - spread + spread * 2 * safeRoll))
}

/**
 * How long to wait before the next check after `failures` consecutive failed checks: five minutes, ten,
 * twenty, forty, then an hour. Jittered, so a room full of machines that all lost the same network do not
 * all come back at once.
 */
export function retryDelayMs(
  failures: number,
  random: () => number,
  cadence: UpdateCadence = UPDATE_CADENCE
): number {
  const step = Math.max(1, Math.min(6, Math.floor(failures) || 1)) - 1
  const base = Math.min(cadence.retryMaxMs, cadence.retryBaseMs * 2 ** step)
  return jittered(base, random, cadence)
}

/** The steady delay between successful checks. */
export function intervalDelayMs(
  random: () => number,
  cadence: UpdateCadence = UPDATE_CADENCE
): number {
  return jittered(cadence.checkIntervalMs, random, cadence)
}
