/**
 * What a desktop notification actually says.
 *
 * The previous formatter was deliberately silent: every notification read "Nexus / An AI task
 * has completed". That is safe and useless — two tabs finishing at once produce two identical
 * popups, and neither tells you which one wants you.
 *
 * So: the text is built here, in one place, with three explicit detail levels rather than a
 * hardcoded redaction. Nothing here decides *whether* to notify; that is the lifecycle's job.
 *
 * Privacy note, because it is a real change in behaviour: `standard` is the default and it
 * includes the tab title. Titles are user content. `generic` is the old behaviour, unchanged,
 * and one setting flips back to it. Prompt text (the snippet) never appears below `full`.
 */

export type NotificationDetail = 'generic' | 'standard' | 'full'

export const NOTIFICATION_DETAILS: readonly NotificationDetail[] = ['generic', 'standard', 'full']

/** Includes the tab title and the model, not the prompt or the answer. */
export const DEFAULT_NOTIFICATION_DETAIL: NotificationDetail = 'standard'

export interface NotificationContentInput {
  tabTitle?: string
  /** Provider key as the app knows it, e.g. `gemini`. Display name is resolved here. */
  model?: string
  status: 'done' | 'waiting-input'
  /** Last assistant text, shown only at `full`. */
  snippet?: string
  /** How long the turn took, when the app knows. Omitted rather than guessed. */
  durationMs?: number
  /** Other tabs that also finished in the same batch, if the caller coalesced them. */
  alsoFinished?: number
}

export interface NotificationContent {
  title: string
  body: string
  /** Critical for input requests so the popup survives a do-not-disturb-ish daemon. */
  urgency: 'normal' | 'critical'
}

const MODEL_LABELS: Record<string, string> = {
  gemini: 'Gemini',
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  openai: 'ChatGPT',
  grok: 'Grok',
  perplexity: 'Perplexity',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  kimi: 'Kimi',
  copilot: 'Copilot',
  mistral: 'Mistral',
  llama: 'Llama'
}

/** Strips control characters and collapses whitespace: notification bodies are one line. */
export function cleanLine(value: string | undefined, max: number): string {
  if (typeof value !== 'string') return ''
  const collapsed = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

export function modelLabel(model: string | undefined): string {
  if (!model) return ''
  const key = model.toLowerCase().trim()
  if (MODEL_LABELS[key]) return MODEL_LABELS[key]
  const bare = key.replace(/[-_].*$/, '')
  if (MODEL_LABELS[bare]) return MODEL_LABELS[bare]
  if (key.length === 0) return ''
  const words = key.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** "less than a second", "8s", "1m 07s", "1h 04m". Rounded, never invented. */
export function formatDuration(durationMs: number | undefined): string {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return ''
  if (durationMs < 1000) return 'less than a second'
  const totalSeconds = Math.round(durationMs / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
}

export function isNotificationDetail(value: unknown): value is NotificationDetail {
  return typeof value === 'string' && (NOTIFICATION_DETAILS as readonly string[]).includes(value)
}

export function formatNotificationContent(
  input: NotificationContentInput,
  options: { detail?: NotificationDetail; appName?: string } = {}
): NotificationContent {
  const appName = options.appName ?? 'Nexus'
  const detail = options.detail ?? DEFAULT_NOTIFICATION_DETAIL
  const waiting = input.status === 'waiting-input'
  const urgency: 'normal' | 'critical' = waiting ? 'critical' : 'normal'

  if (detail === 'generic') {
    return {
      title: appName,
      body: waiting ? 'An AI session requires your input' : 'An AI task has completed',
      urgency: 'normal'
    }
  }

  const model = modelLabel(input.model)
  const title = cleanLine(
    `${appName} — ${waiting ? 'needs your input' : 'response ready'}${model ? ` · ${model}` : ''}`,
    80
  )

  const tabTitle = cleanLine(input.tabTitle, 70)
  const facts = [model, formatDuration(input.durationMs)].filter((part) => part.length > 0).join(' · ')
  const extra =
    typeof input.alsoFinished === 'number' && input.alsoFinished > 0
      ? `+${input.alsoFinished} more tab${input.alsoFinished === 1 ? '' : 's'} finished`
      : ''

  const lines: string[] = []
  if (tabTitle) lines.push(tabTitle)
  if (facts) lines.push(facts)
  if (extra) lines.push(extra)
  if (detail === 'full') {
    const snippet = cleanLine(input.snippet, 140)
    if (snippet) lines.push(snippet)
  }

  // Each line is already cleaned; join it afterwards so the newlines survive.
  // Never an empty body: an OS renders title-only as a blank card.
  const joined = lines.length > 0 ? lines.join('\n') : waiting ? 'Open Nexus to reply' : 'Open Nexus to see the result'
  const body = joined.length > 300 ? `${joined.slice(0, 299).trimEnd()}…` : joined

  return { title, body, urgency }
}
