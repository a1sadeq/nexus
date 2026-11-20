/**
 * Provider icon markup, as configured per provider in Settings → AI Providers.
 *
 * Each provider row has a "Custom SVG Icon Markup" field, and until now the tab surfaces
 * ignored it: they rendered the built-in brand path for the provider key, so a user who pasted
 * their own mark saw it everywhere *except* the tabs they actually look at. That is the bug this
 * fixes — the icon you configured is the icon you get.
 *
 * The field is free text pasted from anywhere, so the markup is sanitised before it is injected.
 * That is not paranoia about the user: an SVG copied from a webpage can carry a `<script>` or an
 * `onload=` handler, and rendering it with `dangerouslySetInnerHTML` would execute it inside the
 * app with the preload bridge in scope. A drawing is allowed to be a drawing.
 */

/** Elements that can execute or load something; removed with their contents. */
const FORBIDDEN_ELEMENTS = ['script', 'foreignObject', 'iframe', 'object', 'embed', 'audio', 'video', 'image']

export function isSvgMarkup(markup: string | undefined): boolean {
  return typeof markup === 'string' && /<svg[\s>]/i.test(markup)
}

/**
 * Returns markup that is safe to inject, or undefined when there is nothing usable.
 *
 * Undefined — rather than an empty string — so callers fall back to the built-in brand icon
 * instead of rendering an invisible hole.
 */
export function sanitizeSvgMarkup(markup: string | undefined): string | undefined {
  if (typeof markup !== 'string' || !isSvgMarkup(markup)) return undefined

  let output = markup

  for (const element of FORBIDDEN_ELEMENTS) {
    // Paired form, then self-closing form. Case-insensitive, greedy across newlines.
    output = output.replace(new RegExp(`<${element}\\b[\\s\\S]*?</${element}\\s*>`, 'gi'), '')
    output = output.replace(new RegExp(`<${element}\\b[^>]*/>`, 'gi'), '')
    output = output.replace(new RegExp(`<${element}\\b[^>]*>`, 'gi'), '')
  }

  // Inline event handlers: onload=, onclick=, onbegin=, …
  output = output.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
  output = output.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
  output = output.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')

  // Script-ish URLs in href / xlink:href / style.
  output = output.replace(/(href|src|xlink:href)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '')
  output = output.replace(/(href|src|xlink:href)\s*=\s*(["'])\s*data:text\/html[^"']*\2/gi, '')
  output = output.replace(/url\(\s*["']?\s*javascript:[^)]*\)/gi, '')

  // XML prolog / doctype are not wanted inside an HTML node.
  output = output.replace(/<\?xml[\s\S]*?\?>/gi, '').replace(/<!DOCTYPE[^>]*>/gi, '')

  // Removing whole elements can leave a bare `<svg></svg>`; that is still usable (an empty
  // frame), but a fragment with no svg left is not.
  return isSvgMarkup(output) ? output.trim() : undefined
}

export interface ProviderIconSource {
  /** Rendered markup to inject, when the user has configured one. */
  custom?: string
  /** Whether a built-in brand path exists for the key (callers render it themselves). */
  hasBrand: boolean
}

/**
 * Which source to draw for this provider. Kept separate from rendering so the decision can be
 * tested without a DOM.
 */
export function resolveProviderIconSource(
  key: string,
  customSvg: string | undefined,
  brandIds: readonly string[]
): ProviderIconSource {
  const custom = sanitizeSvgMarkup(customSvg)
  if (custom) return { custom, hasBrand: brandIds.includes(key) }
  return { custom: undefined, hasBrand: brandIds.includes(key) }
}
