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
 *
 * Build 51 moved the *title* and the *description* to match what the app already shows in its own
 * in-app toast, because the user asked for exactly that: the popup is titled with the tab it came
 * from, not with the app, and it says what the in-app card says underneath that title. The two
 * surfaces now read one pair of helpers — `statusLabel()` and `statusDescription()` — so they cannot
 * drift into two different descriptions of the same event.
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


/** The badge the in-app card wears, and the word the OS popup leads with. One spelling. */
export function statusLabel(status: 'done' | 'waiting-input'): string {
  return status === 'waiting-input' ? 'Needs Input' : 'Response Ready'
}

/**
 * The one line the in-app notification prints under its title.
 *
 * When the provider gave us the last thing it said, that is the description; otherwise the card has
 * always fallen back to a status sentence, and the fallback lives here so the OS popup and the card
 * cannot say two different things about one event.
 */
export function statusDescription(status: 'done' | 'waiting-input', snippet?: string): string {
  const text = cleanLine(snippet, 140)
  if (text) return text
  return status === 'waiting-input' ? 'Waiting for your choice or confirmation' : 'Generation completed.'
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
  // Title: the tab the notification came from. That is the one fact a popup needs and the one the old
  // title ("Nexus — response ready · Gemini") threw away; two completions from two tabs used to look
  // identical until you read the body. A nameless tab still gets something sayable.
  const tabTitle = cleanLine(input.tabTitle, 80)
  const title = tabTitle.length > 0 ? tabTitle : cleanLine(`${appName} · ${statusLabel(input.status)}`, 80)

  // Body: the description the in-app card prints, then the facts the card wears as a badge and a
  // subtitle. Snippet text stays behind `full`, exactly as before.
  const description =
    detail === 'full'
      ? statusDescription(input.status, input.snippet)
      : statusDescription(input.status, undefined)
  const facts = [statusLabel(input.status), model, formatDuration(input.durationMs)]
    .filter((part) => part.length > 0)
    .join(' · ')
  const extra =
    typeof input.alsoFinished === 'number' && input.alsoFinished > 0
      ? `+${input.alsoFinished} more tab${input.alsoFinished === 1 ? '' : 's'} finished`
      : ''

  const lines: string[] = [description]
  if (facts) lines.push(facts)
  if (extra) lines.push(extra)

  // Never an empty body: an OS renders title-only as a blank card.
  const joined = lines.filter((line) => line.length > 0).join('\n')
  const body = joined.length > 0 ? (joined.length > 300 ? `${joined.slice(0, 299).trimEnd()}…` : joined) : 'Open Nexus'

  return { title, body, urgency }
}
