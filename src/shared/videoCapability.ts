import type { UploadFileKind } from './uploadFileKind'

/**
 * Provider capability model (plan 01).
 *
 * The plan is explicit that four different facts exist and must never be conflated:
 *   1. the file input's `accept` attribute lists a type   -> a hint, not proof
 *   2. an attachment chip appears in the composer          -> the app accepted it
 *   3. the upload finished                                 -> the file reached the server
 *   4. the model actually understood the content           -> a semantic fact
 *
 * Nexus therefore stores *observations* with the fact they establish, and derives a
 * verdict from them. With no observation, the answer is `unknown` — never a guess.
 */

export type CapabilityStatus = 'supported' | 'unsupported' | 'unknown'

export type CapabilityFact =
  | 'input-accepts-type'
  | 'attachment-confirmed'
  | 'upload-completed'
  | 'model-understood'
  /** The provider itself refused the file (error toast, validation message, silent drop). */
  | 'provider-error'

export type CapabilitySource = 'live-dom' | 'provider-error' | 'user-reported'

export interface CapabilityObservation {
  /** Provider id as Nexus names it ("chatgpt", "claude", "gemini", "arena", …). */
  provider: string
  /** Model/build when known. Empty when the user did not record it. */
  model?: string
  /** Nexus/app build the observation was taken on (stale selectors are a real failure mode). */
  build?: string
  kind: UploadFileKind
  status: 'supported' | 'unsupported'
  /** What this observation actually proves. Never inflate this. */
  fact: CapabilityFact
  /** ISO timestamp. */
  observedAt: string
  source: CapabilitySource
  notes?: string
}

export interface CapabilityStore {
  version: 1
  observations: CapabilityObservation[]
}

export interface CapabilityQuery {
  provider: string
  model?: string
  kind: UploadFileKind
  /** Injectable clock so freshness is testable. */
  now?: Date
  /** Evidence older than this is not trusted for a native route. */
  maxAgeDays?: number
}

export interface CapabilityVerdict {
  status: CapabilityStatus
  /** True only when there is fresh, adequate evidence that the native file works. */
  nativeAllowed: boolean
  /** True when the user must be asked before anything is attempted. */
  needsUserDecision: boolean
  /** Human-readable, safe to show in the UI verbatim. */
  reason: string
  /** The decisive observation, when there is one. */
  observation?: CapabilityObservation
  /** A matching but expired observation, surfaced as "re-test needed". */
  staleObservation?: CapabilityObservation
  /** Every fact we actually have evidence for. Helps the UI avoid over-claiming. */
  factsObserved: CapabilityFact[]
}

export const DEFAULT_MAX_AGE_DAYS = 30

/** Facts strong enough to allow attempting a native upload without asking first. */
const NATIVE_ROUTE_FACTS: CapabilityFact[] = ['attachment-confirmed', 'upload-completed']

export function emptyCapabilityStore(): CapabilityStore {
  return { version: 1, observations: [] }
}

const isDate = (value: string): boolean => !Number.isNaN(Date.parse(value))

/**
 * Validate a candidate observation before it is stored.
 * Returns an error string rather than throwing so a settings import cannot crash the app.
 */
export function validateObservation(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'observation must be an object'
  const o = value as Record<string, unknown>
  if (typeof o.provider !== 'string' || !o.provider.trim()) return 'provider is required'
  if (typeof o.kind !== 'string' || !o.kind.trim()) return 'kind is required'
  if (o.status !== 'supported' && o.status !== 'unsupported')
    return "status must be 'supported' or 'unsupported'"
  const facts: CapabilityFact[] = [
    'input-accepts-type',
    'attachment-confirmed',
    'upload-completed',
    'model-understood',
    'provider-error'
  ]
  if (typeof o.fact !== 'string' || !facts.includes(o.fact as CapabilityFact))
    return `fact must be one of ${facts.join(', ')}`
  const sources: CapabilitySource[] = ['live-dom', 'provider-error', 'user-reported']
  if (typeof o.source !== 'string' || !sources.includes(o.source as CapabilitySource))
    return `source must be one of ${sources.join(', ')}`
  if (typeof o.observedAt !== 'string' || !isDate(o.observedAt))
    return 'observedAt must be an ISO date string'
  return null
}

/** Insert or replace an observation for the same provider/model/kind/fact. */
export function upsertObservation(
  store: CapabilityStore,
  observation: CapabilityObservation
): CapabilityStore {
  const error = validateObservation(observation)
  if (error) throw new Error(`invalid capability observation: ${error}`)
  const sameKey = (o: CapabilityObservation): boolean =>
    o.provider === observation.provider &&
    (o.model ?? '') === (observation.model ?? '') &&
    o.kind === observation.kind &&
    o.fact === observation.fact
  const kept = store.observations.filter((o) => !sameKey(o))
  kept.push({ ...observation })
  return { version: 1, observations: kept }
}

function ageInDays(observedAt: string, now: Date): number {
  return (now.getTime() - Date.parse(observedAt)) / 86_400_000
}

/**
 * Derive the route verdict for one provider + file kind.
 *
 * Ordering matters: an explicit provider error outranks everything (the provider told us
 * no), then fresh evidence of acceptance, then hint-only evidence, then nothing.
 */
export function assessVideoCapability(
  query: CapabilityQuery,
  observations: CapabilityObservation[]
): CapabilityVerdict {
  const now = query.now ?? new Date()
  const maxAge = query.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS

  const matching = observations.filter(
    (o) => o.provider.toLowerCase() === query.provider.toLowerCase() && o.kind === query.kind
  )
  // Model-scoped evidence wins over provider-wide evidence when both exist.
  const modelMatches = matching.filter(
    (o) => query.model && o.model && o.model.toLowerCase() === query.model.toLowerCase()
  )
  const pool = modelMatches.length > 0 ? modelMatches : matching

  const fresh = pool.filter(
    (o) => Number.isFinite(ageInDays(o.observedAt, now)) && ageInDays(o.observedAt, now) <= maxAge
  )
  const stale = pool.filter((o) => !fresh.includes(o))
  const freshestStale = stale.sort(
    (a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt)
  )[0]

  const factsObserved = [...new Set(fresh.map((o) => o.fact))]

  if (!query.model && modelMatches.length === 0 && pool.length === 0) {
    return {
      status: 'unknown',
      nativeAllowed: false,
      needsUserDecision: true,
      factsObserved,
      reason: `No verified evidence yet that ${query.provider} accepts a ${query.kind} in Nexus. The input's accept attribute is only a hint — it does not prove the app or the model will take the file.`
    }
  }

  if (pool.length === 0) {
    return {
      status: 'unknown',
      nativeAllowed: false,
      needsUserDecision: true,
      factsObserved,
      reason: `No verified evidence yet that ${query.provider} accepts a ${query.kind} in Nexus. The input's accept attribute is only a hint — it does not prove the app or the model will take the file.`
    }
  }

  // 1. A recorded rejection is decisive while fresh.
  const rejection = fresh
    .filter((o) => o.status === 'unsupported')
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0]
  if (rejection) {
    return {
      status: 'unsupported',
      nativeAllowed: false,
      needsUserDecision: true,
      factsObserved,
      observation: rejection,
      reason:
        rejection.source === 'provider-error'
          ? `${query.provider} rejected this ${query.kind} on ${rejection.observedAt.slice(0, 10)}. Nexus will not retry it blindly — a prepared local version can be offered instead.`
          : `You recorded that ${query.provider} does not accept this ${query.kind} (${rejection.observedAt.slice(0, 10)}).`
    }
  }

  // 2. Fresh, adequate evidence of acceptance.
  const acceptance = fresh
    .filter((o) => o.status === 'supported' && NATIVE_ROUTE_FACTS.includes(o.fact))
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0]
  if (acceptance) {
    return {
      status: 'supported',
      nativeAllowed: true,
      needsUserDecision: false,
      factsObserved,
      observation: acceptance,
      reason: `Verified on ${acceptance.observedAt.slice(0, 10)}${
        acceptance.build ? ` (build ${acceptance.build})` : ''
      } that ${query.provider} accepted this ${query.kind} (${
        acceptance.fact === 'upload-completed' ? 'upload completed' : 'attachment confirmed'
      }). This is acceptance, not proof the model understood the content.`
    }
  }

  // 3. Hint-only evidence (accept attribute, model "understanding" with no upload fact).
  const hint = fresh.filter((o) => o.status === 'supported')[0]
  if (hint) {
    return {
      status: 'unknown',
      nativeAllowed: false,
      needsUserDecision: true,
      factsObserved,
      observation: hint,
      reason:
        hint.fact === 'input-accepts-type'
          ? `The ${query.provider} page lists this ${query.kind} type, but listing it is not acceptance — no attachment was ever confirmed. Nexus will ask before trying.`
          : `Only a semantic observation exists for ${query.provider}; nothing proves the file was accepted. Nexus will ask before trying.`
    }
  }

  // 4. Everything we have is expired.
  return {
    status: 'unknown',
    nativeAllowed: false,
    needsUserDecision: true,
    factsObserved,
    staleObservation: freshestStale,
    reason: freshestStale
      ? `The only evidence for ${query.provider} is ${Math.floor(
          ageInDays(freshestStale.observedAt, now)
        )} days old (limit ${maxAge}). Provider UIs change — re-test before trusting it.`
      : `No usable evidence for ${query.provider} with a ${query.kind}. Nexus will ask before trying.`
  }
}

/** Short badge text for the UI. Never claims more than the verdict does. */
export function capabilityBadge(verdict: CapabilityVerdict): string {
  if (verdict.status === 'supported') return 'native verified'
  if (verdict.status === 'unsupported') return 'native rejected'
  return verdict.staleObservation ? 'evidence stale — re-test' : 'unverified — ask first'
}
