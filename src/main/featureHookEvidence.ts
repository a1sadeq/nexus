/** Read-only evidence capture. Serialized into the page: no module-scope closures. */
export function collectFeatureHookEvidence(current: Record<string, unknown> = {}) {
  const started = performance.now()
  const MAX_CHARS = 64000
  const warnings: string[] = []
  const keys = [
    'attachmentSelector', 'promptNavSelector', 'composerSelector', 'sendButtonSelector',
    'chatTitleSelector', 'newChatSelector', 'stopGenerationSelector', 'virtualizationSelector',
    'assistantMessageSelector', 'streamingSelector', 'errorSelector', 'completionActionSelector'
  ]
  const expired = () => performance.now() - started > 250
  const redact = (value: string, limit = 180) => value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[DYNAMIC_ID]')
    .replace(/\b(?:Bearer\s+\S+|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/gi, '[SECRET]')
    .slice(0, limit)
  const safeHref = (value: string) => {
    try {
      const url = new URL(value, location.href)
      if (!/^https?:$/.test(url.protocol) || url.origin !== location.origin) return '[REDACTED_URL]'
      return redact(url.pathname.replace(/[A-Za-z0-9_-]{24,}/g, '[DYNAMIC_ID]'), 240)
    } catch { return '[INVALID_URL]' }
  }
  const attrsCache = new WeakMap<Element, Record<string, string>>()
  const attrs = (el: Element) => {
    const cached = attrsCache.get(el)
    if (cached) return cached
    const out: Record<string, string> = {}
    let size = 0
    for (const attr of Array.from(el.attributes)) {
      const n = attr.name.toLowerCase()
      if (Object.keys(out).length >= 24 || size >= 1800) break
      if (n.length > 80 || /^(value|src|srcdoc|style|nonce|on.*)$/i.test(n)) continue
      if (!(/^(id|class|role|type|name|title|placeholder|accept|multiple|disabled|hidden|tabindex|contenteditable|href|dir)$/.test(n) || n.startsWith('aria-') || n.startsWith('data-'))) continue
      // Token boundaries matter: "author" is semantic, not an "auth" credential.
      if (/(?:^|[-_:])(?:token|secret|auth|authorization|cookie|session|csrf|email|password)(?:$|[-_:])/i.test(n)) continue
      let value: string
      if (n === 'href') value = safeHref(attr.value)
      else if (n === 'class') value = redact(attr.value, 360)
      else if (n.startsWith('data-') && !/^(true|false|user|assistant|human|model|active|inactive|open|closed|[0-9]{1,3})$/.test(attr.value) && !/^(data-testid|data-test-id|data-slot|data-sidebar)$/.test(n)) value = '[VALUE_REDACTED]'
      else if (n === 'id' && /radix|[0-9a-f]{8}-|[A-Za-z0-9_-]{28,}/i.test(attr.value)) value = '[DYNAMIC_ID]'
      else if (/^(aria-label|title|placeholder)$/.test(n) && (attr.value.length > 90 || /[\r\n]/.test(attr.value))) value = '[LABEL_REDACTED]'
      else value = redact(attr.value)
      out[n] = value
      size += n.length + value.length
    }
    attrsCache.set(el, out)
    return out
  }
  const geometryCache = new WeakMap<Element, { hasLayout: boolean; inViewport: boolean; top: number; height: number }>()
  const geometry = (el: Element) => {
    const cached = geometryCache.get(el)
    if (cached) return cached
    const r = el.getBoundingClientRect(), s = getComputedStyle(el)
    const hasLayout = r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'
    let left = Math.max(0, r.left), right = Math.min(innerWidth, r.right)
    let top = Math.max(0, r.top), bottom = Math.min(innerHeight, r.bottom)
    // Clipping is geometric, not paint/occlusion or opacity verification.
    for (let p = el.parentElement, depth = 0; p && depth < 30; p = p.parentElement, depth++) {
      const ps = getComputedStyle(p), pr = p.getBoundingClientRect()
      if (ps.display === 'none' || ps.visibility === 'hidden') { right = left; break }
      if (/^(auto|scroll|hidden|clip|overlay)$/.test(ps.overflowX)) { left = Math.max(left, pr.left + p.clientLeft); right = Math.min(right, pr.left + p.clientLeft + p.clientWidth) }
      if (/^(auto|scroll|hidden|clip|overlay)$/.test(ps.overflowY)) { top = Math.max(top, pr.top + p.clientTop); bottom = Math.min(bottom, pr.top + p.clientTop + p.clientHeight) }
    }
    const value = { hasLayout, inViewport: hasLayout && right > left && bottom > top, top: Math.round(r.top), height: Math.round(r.height) }
    geometryCache.set(el, value)
    return value
  }
  const selectorFor = (el: Element): string | null => {
    const allowed = attrs(el)
    for (const name of ['data-testid', 'data-test-id', 'data-user-message-layout', 'data-agent-transcript-message', 'data-message-author-role', 'data-message-author', 'aria-label', 'name', 'role', 'type']) {
      const value = el.getAttribute(name)
      if (!value || value.length > 100 || allowed[name] !== value || /\[(?:.*REDACTED|DYNAMIC_ID|EMAIL|SECRET)\]/.test(value)) continue
      // CSS strings escape control characters as CSS escapes, not JSON escapes.
      const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\x00-\x1f\x7f]/g, c => `\\${c.charCodeAt(0).toString(16)} `)
      return `${el.tagName.toLowerCase()}[${name}="${escaped}"]`
    }
    return null
  }
  const descriptions = new WeakMap<Element, Record<string, unknown>>()
  const describe = (el: Element) => {
    const cached = descriptions.get(el)
    if (cached) return cached
    const ancestors: Array<Record<string, unknown>> = []
    for (let p = el.parentElement, depth = 0; p && depth < 5; p = p.parentElement, depth++) {
      ancestors.push({ tag: p.tagName.toLowerCase(), attributes: attrs(p), overflowY: getComputedStyle(p).overflowY, clientHeight: p.clientHeight, scrollHeight: p.scrollHeight, scrollTop: Math.round(p.scrollTop) })
    }
    const text = /^(BUTTON|A)$/.test(el.tagName) ? (el.textContent || '').trim() : ''
    const actionText = /^(new chat|new conversation|send|stop|stop generating|attach|upload|add files|keep working|yes|no)$/i.test(text) ? text : undefined
    const value = { tag: el.tagName.toLowerCase(), attributes: attrs(el), actionText, children: Array.from(el.children).slice(0, 4).map(child => ({ tag: child.tagName.toLowerCase(), attributes: attrs(child) })), ...geometry(el), suggestedSelector: selectorFor(el), ancestors }
    descriptions.set(el, value)
    return value
  }
  const candidates: Record<string, unknown[]> = Object.fromEntries(keys.map(k => [k, []]))
  const counts: Record<string, number> = {}
  const queries: Record<string, string> = {
    attachmentSelector: 'input[type="file"], button[aria-label*="attach" i], button[aria-label*="upload" i], [data-testid*="upload" i]',
    promptNavSelector: '[data-user-message-layout], [data-message-author-role="user"], [data-message-author="user"], [data-testid="user-message"], user-query, [class*="user-query"], [class*="user-message"]',
    composerSelector: 'textarea:not([name*="captcha" i]):not([id*="captcha" i]), [contenteditable="true"], [role="textbox"]',
    sendButtonSelector: 'button[type="submit"], button[aria-label*="send" i], [data-testid*="send" i]',
    chatTitleSelector: 'header h1, header h2, a[data-active="true"], [aria-current="page"], button[aria-haspopup="menu"] > span[dir="auto"].truncate',
    newChatSelector: 'a[href="/"], a[href="/agent"], button[aria-label*="new" i], a[aria-label*="new" i], [data-testid*="new-chat" i]',
    stopGenerationSelector: 'button[aria-label*="stop" i], [data-testid*="stop" i], button[class*="stop" i]',
    virtualizationSelector: '[data-agent-transcript-message], [data-chat-message-id], [data-message-id], [data-message-author-role], [data-testid="user-message"], [data-testid="assistant-message"]',
    assistantMessageSelector: '[data-message-author-role="assistant"], [data-testid="assistant-message"], model-response, article[class*="message" i], .bot.message, .markdown-body, div[class*="ds-message" i]',
    streamingSelector: '.result-streaming, [data-is-streaming="true"], model-response.is-streaming, .cursor-blink, [class*="cursor-blink" i], [class*="streaming-cursor" i], [class*="ds-thinking" i]',
    errorSelector: '[data-testid*="error" i], .error-banner, div[class*="error" i], .text-red-500',
    completionActionSelector: 'button[aria-label="Copy" i], button[data-testid*="copy" i], button[aria-label*="Regenerate" i], button[aria-label*="Retry" i], [data-testid*="action-bar" i]'
  }
  const validations: Record<string, { count?: number; samples?: unknown[]; error?: string }> = {}
  // Current selectors first; preserve counts even when samples must be discarded.
  for (const key of keys) {
    const selector = current[key]
    if (typeof selector !== 'string' || !selector.trim()) continue
    if (selector.length > 2000) { validations[key] = { error: 'selector-too-long' }; continue }
    if (expired()) { validations[key] = { error: 'budget-exhausted' }; continue }
    try {
      const matches = document.querySelectorAll(selector)
      validations[key] = { count: matches.length, samples: Array.from(matches).slice(0, 3).map(describe) }
    } catch { validations[key] = { error: 'invalid-selector' } }
  }
  for (const key of keys) {
    if (expired()) continue
    const found = document.querySelectorAll(queries[key])
    counts[key] = found.length
    const sampled: unknown[] = []
    for (const el of Array.from(found).slice(0, 12)) { if (expired()) break; sampled.push(describe(el)) }
    candidates[key] = sampled
    if (sampled.length < found.length) warnings.push(`${key}: sampled ${sampled.length} of ${found.length} matches`)
    if (!found.length) warnings.push(`${key}: no heuristic candidate in this state; not evidence of unsupported functionality`)
  }
  const allControls = document.querySelectorAll('button, input, textarea, [contenteditable="true"], [role="button"], a[href]')
  const controls: unknown[] = []
  // Prioritize input/file controls over potentially hundreds of sidebar links.
  const priority = Array.from(allControls).filter(el => /^(INPUT|TEXTAREA)$/.test(el.tagName) || el.getAttribute('contenteditable') === 'true')
  const seen = new Set<Element>()
  for (const el of [...priority, ...Array.from(allControls)]) {
    if (controls.length >= 60 || expired()) break
    if (!seen.has(el)) { seen.add(el); controls.push(describe(el)) }
  }
  const framesDetected = document.querySelectorAll('iframe').length
  if (framesDetected) warnings.push(`${framesDetected} iframe(s) not inspected; frame-local selectors cannot be used in the top document`)
  if (expired()) warnings.push('Capture time budget exhausted; missing measurements are unknown, not zero matches.')
  warnings.push('Single-state, top-document capture. Shadow roots, other frames, inactive modes, and unmounted history are not inspected.')
  warnings.push('No prompts were submitted and no controls were clicked. Send/stop states may require separate user-driven captures.')
  warnings.push('Attributes and configured selectors can still contain private data. Review before copying to an external AI.')
  const result = { version: 2, capturedAt: new Date().toISOString(), origin: location.origin, path: safeHref(location.href), candidates, counts, validations, controls, controlsDetected: allControls.length, framesDetected, warnings, truncated: false, durationMs: 0 }
  // Trim every sample source, including validations, until the ENTIRE result fits.
  const arrays = [...keys.map(k => candidates[k]), ...Object.values(validations).map(v => v.samples || []), controls]
  while (JSON.stringify(result).length > MAX_CHARS) {
    result.truncated = true
    const largest = arrays.reduce((a, b) => a.length > b.length ? a : b)
    if (!largest.length) break
    largest.pop()
  }
  if (result.truncated) warnings.push('Evidence samples trimmed to the 64k-character budget; counts are retained, omitted samples remain unknown.')
  // Leave room for final metadata/warnings as well.
  while (JSON.stringify(result).length > MAX_CHARS - 100) {
    if (!result.truncated) {
      result.truncated = true
      warnings.push('Evidence samples trimmed to reserve space for final metadata.')
    }
    const largest = arrays.reduce((a, b) => a.length > b.length ? a : b)
    if (!largest.length) break
    largest.pop()
  }
  result.durationMs = Math.round(performance.now() - started)
  return result
}

export function buildFeatureHookEvidenceScript(current: Record<string, unknown> = {}): string {
  const keys = [
    'attachmentSelector', 'promptNavSelector', 'composerSelector', 'sendButtonSelector',
    'chatTitleSelector', 'newChatSelector', 'stopGenerationSelector', 'virtualizationSelector',
    'assistantMessageSelector', 'streamingSelector', 'errorSelector', 'completionActionSelector'
  ]
  // Do not silently truncate a CSS expression into a different valid selector.
  const selectors = Object.fromEntries(keys.filter(k => typeof current[k] === 'string').map(k => [k, String(current[k]).length <= 2000 ? current[k] : 'x'.repeat(2001)]))
  return `(${collectFeatureHookEvidence.toString()})(${JSON.stringify(selectors)})`
}
