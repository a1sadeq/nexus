export type HighlightedCodeResult =
  | { ok: true; text: string }
  | {
      ok: false
      reason: 'unsupported-content' | 'limit-exceeded' | 'empty-content'
    }

/**
 * Experimental parser for ONE already-selected syntax-highlighted code node.
 * This does not find or validate its enclosing response, language label,
 * provider, conversation, completion, stylesheets, or sibling content. Never
 * use an ok result as approval or proof of completeness. Text is untrusted and
 * must not be executed or rendered as HTML. Wrapper validation is separate.
 */
export function extractArenaHighlightedCode(code: Element): HighlightedCodeResult {
  if (!code || code.nodeType !== 1 || code.tagName.toLowerCase() !== 'code') {
    return { ok: false, reason: 'unsupported-content' }
  }
  // Observed class names are compatibility checks, not authentication or proof
  // that CSS cannot hide/alter content. Reject extra attributes/classes.
  const hasExactClasses = (el: Element, expected: readonly string[]): boolean =>
    el.attributes.length === 1 &&
    el.hasAttribute('class') &&
    el.classList.length === expected.length &&
    expected.every((name) => el.classList.contains(name))
  if (!hasExactClasses(code, ['whitespace-pre-wrap', 'break-words'])) {
    return { ok: false, reason: 'unsupported-content' }
  }
  let count = 0
  let text = ''
  let lines = 0
  let expectingLine = true
  const MAX_NODES = 10000
  const MAX_CHARS = 200000
  const add = (value: string): boolean => {
    text += value
    return text.length <= MAX_CHARS
  }
  for (const child of Array.from(code.childNodes)) {
    if (++count > MAX_NODES) return { ok: false, reason: 'limit-exceeded' }
    if (child.nodeType === 3) {
      const value = child.nodeValue ?? ''
      if (expectingLine || value !== '\n') return { ok: false, reason: 'unsupported-content' }
      expectingLine = true
      if (!add(value)) return { ok: false, reason: 'limit-exceeded' }
      continue
    }
    if (child.nodeType !== 1) return { ok: false, reason: 'unsupported-content' }
    if (!expectingLine) return { ok: false, reason: 'unsupported-content' }
    expectingLine = false
    const line = child as Element
    if (line.tagName.toLowerCase() !== 'span' || !hasExactClasses(line, ['line'])) {
      return { ok: false, reason: 'unsupported-content' }
    }
    lines++
    for (const token of Array.from(line.childNodes)) {
      if (++count > MAX_NODES) return { ok: false, reason: 'limit-exceeded' }
      if (token.nodeType === 3) {
        if (!add(token.nodeValue ?? '')) return { ok: false, reason: 'limit-exceeded' }
        continue
      }
      if (token.nodeType !== 1) return { ok: false, reason: 'unsupported-content' }
      const span = token as HTMLElement
      if (
        span.tagName.toLowerCase() !== 'span' ||
        span.attributes.length > 1 ||
        (span.attributes.length === 1 && !span.hasAttribute('style'))
      ) {
        return { ok: false, reason: 'unsupported-content' }
      }
      if (
        span.hasAttribute('style') &&
        !/^\s*color\s*:\s*#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})\s*;?\s*$/i.test(
          span.getAttribute('style') ?? ''
        )
      ) {
        return { ok: false, reason: 'unsupported-content' }
      }
      for (const part of Array.from(span.childNodes)) {
        if (++count > MAX_NODES) return { ok: false, reason: 'limit-exceeded' }
        if (part.nodeType !== 3) return { ok: false, reason: 'unsupported-content' }
        if (!add(part.nodeValue ?? '')) return { ok: false, reason: 'limit-exceeded' }
      }
    }
  }
  if (!lines || !text) return { ok: false, reason: 'empty-content' }
  if (expectingLine) return { ok: false, reason: 'unsupported-content' }
  return { ok: true, text }
}
