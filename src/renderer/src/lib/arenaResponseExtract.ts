import { extractArenaCodeBlock } from './arenaCodeBlock'

// Pure DOM-to-structured-data candidate. The caller must bind the correct
// conversation, message, completion and origin; this module cannot do so.
export type ResponseNode =
  | { type: 'text'; value: string }
  | { type: 'element'; tag: SupportedTag; children: ResponseNode[] }
  | { type: 'code-block'; language: string; text: string }
  | { type: 'link'; href: string; children: ResponseNode[] }

type SupportedTag =
  | 'p'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'ul'
  | 'ol'
  | 'li'
  | 'strong'
  | 'em'
  | 'code'
  | 'pre'
  | 'br'
  | 'blockquote'
  | 'table'
  | 'thead'
  | 'tbody'
  | 'tr'
  | 'th'
  | 'td'
  | 'table-wrapper'

export type ExtractionResult =
  | { ok: true; nodes: ResponseNode[] }
  | {
      ok: false
      reason: 'invalid-root' | 'unsupported-content' | 'limit-exceeded' | 'empty-content'
    }

const allowed = new Set<string>([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'code',
  'pre',
  'br',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'a',
  'div'
])
const MAX_NODES = 10000
const MAX_CHARS = 200000
const MAX_DEPTH = 64

/**
 * Accept only one already-selected prose DIV. Never use as evidence of a full
 * response, provider identity, request correlation, safety, or approval. It
 * preserves text and basic structure, not original markdown or formatting.
 * Unsupported nodes and attributes fail closed. Caller must treat output as
 * untrusted provider content and must not render it as HTML or execute it.
 */
export function extractArenaResponse(root: Element): ExtractionResult {
  if (
    !root ||
    root.nodeType !== 1 ||
    root.tagName.toLowerCase() !== 'div' ||
    !root.classList.contains('prose')
  ) {
    return { ok: false, reason: 'invalid-root' }
  }
  let nodesSeen = 0
  let charsSeen = 0
  let nonWhitespace = false
  let failure: 'unsupported-content' | 'limit-exceeded' | null = null

  function visit(node: Node, depth: number, tableInWrapper = false): ResponseNode | null {
    nodesSeen++
    if (nodesSeen > MAX_NODES || depth > MAX_DEPTH) {
      failure = 'limit-exceeded'
      return null
    }
    if (node.nodeType === 3) {
      const value = node.nodeValue ?? ''
      charsSeen += value.length
      if (charsSeen > MAX_CHARS) {
        failure = 'limit-exceeded'
        return null
      }
      if (value.trim()) nonWhitespace = true
      return { type: 'text', value }
    }
    if (node.nodeType !== 1) {
      failure = 'unsupported-content'
      return null
    }
    const element = node as Element
    const tag = element.tagName.toLowerCase()
    if (!allowed.has(tag) || element.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
      failure = 'unsupported-content'
      return null
    }
    // Only the observed table wrapper may be transparent. Verify all of its
    // children so that extra non-whitespace content is not silently dropped.
    if (tag === 'div') {
      const children = Array.from(element.childNodes)
      if (
        Array.from(element.attributes).some((a) => a.name !== 'class') ||
        element.children.length !== 1 ||
        element.firstElementChild?.tagName.toLowerCase() !== 'table' ||
        children.some((n) => n.nodeType !== 1 && !(n.nodeType === 3 && !n.nodeValue?.trim()))
      ) {
        failure = 'unsupported-content'
        return null
      }
      for (const attr of Array.from(element.attributes))
        charsSeen += attr.name.length + attr.value.length
      if (charsSeen > MAX_CHARS) {
        failure = 'limit-exceeded'
        return null
      }
      // Visit all children to account for limits; retain whitespace as nodes.
      const wrapperChildren: ResponseNode[] = []
      for (const child of children) {
        const parsed = visit(child, depth + 1, child.nodeType === 1)
        if (failure) return null
        if (parsed) wrapperChildren.push(parsed)
      }
      return { type: 'element', tag: 'table-wrapper', children: wrapperChildren }
    }
    if (tag === 'table' && !tableInWrapper) {
      failure = 'unsupported-content'
      return null
    }
    const attributeNames =
      tag === 'a'
        ? ['target', 'rel', 'href', 'class']
        : ['table', 'th', 'td', 'code'].includes(tag)
          ? ['node', 'class']
          : []
    if (Array.from(element.attributes).some((attr) => !attributeNames.includes(attr.name))) {
      failure = 'unsupported-content'
      return null
    }
    for (const attr of Array.from(element.attributes))
      charsSeen += attr.name.length + attr.value.length
    if (charsSeen > MAX_CHARS) {
      failure = 'limit-exceeded'
      return null
    }
    let href: string | null = null
    if (tag === 'a') {
      if (
        element.attributes.length !== 4 ||
        !attributeNames.every((name) => element.hasAttribute(name))
      ) {
        failure = 'unsupported-content'
        return null
      }
      href = element.getAttribute('href')
      if (
        !href ||
        href !== href.trim() ||
        Array.from(href).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
      ) {
        failure = 'unsupported-content'
        return null
      }
      try {
        const url = new URL(href)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
          failure = 'unsupported-content'
          return null
        }
      } catch {
        failure = 'unsupported-content'
        return null
      }
    }
    // Distinguish the observed marked code wrapper from a simple pre > code.
    // Unknown shapes remain unsupported; never infer response completeness.
    if (tag === 'pre' && element.firstElementChild?.hasAttribute('data-code-block')) {
      const block = extractArenaCodeBlock(element)
      if (block.ok === false) {
        failure = block.reason
        return null
      }
      // The outer pre was already counted by visit. Account for the complete
      // wrapper, including its attributes, under the shared response limits.
      nodesSeen += block.nodeCount - 1
      charsSeen += block.charCount
      if (nodesSeen > MAX_NODES || charsSeen > MAX_CHARS || depth + block.maxDepth > MAX_DEPTH) {
        failure = 'limit-exceeded'
        return null
      }
      if (block.text.trim()) nonWhitespace = true
      return { type: 'code-block', language: block.language, text: block.text }
    }
    if (
      tag === 'pre' &&
      (element.children.length !== 1 ||
        element.firstElementChild?.tagName.toLowerCase() !== 'code' ||
        [...element.childNodes].some(
          (n) => n.nodeType !== 1 && !(n.nodeType === 3 && !n.nodeValue?.trim())
        ))
    ) {
      failure = 'unsupported-content'
      return null
    }
    const children: ResponseNode[] = []
    for (const child of Array.from(element.childNodes)) {
      const result = visit(child, depth + 1)
      if (failure) return null
      if (result) children.push(result)
    }
    if (tag === 'a' && href !== null) return { type: 'link', href, children }
    return { type: 'element', tag: tag as SupportedTag, children }
  }

  const nodes: ResponseNode[] = []
  for (const child of Array.from(root.childNodes)) {
    const result = visit(child, 0)
    if (failure) return { ok: false, reason: failure }
    if (result) nodes.push(result)
  }
  if (!nonWhitespace) return { ok: false, reason: 'empty-content' }
  return { ok: true, nodes }
}
