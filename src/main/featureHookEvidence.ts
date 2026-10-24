/** Read-only, bounded evidence capture. This function is serialized into the page. */
export function collectFeatureHookEvidence(current: Record<string, unknown> = {}) {
  const started = performance.now()
  const warnings: string[] = []
  const keys = [
    'attachmentSelector',
    'promptNavSelector',
    'composerSelector',
    'sendButtonSelector',
    'chatTitleSelector',
    'newChatSelector',
    'stopGenerationSelector',
    'virtualizationSelector'
  ]
  const redact = (value: string) =>
    value
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
      .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[DYNAMIC_ID]')
      .slice(0, 180)
  const safeHref = (value: string) => {
    try {
      const url = new URL(value, location.href)
      if (!/^https?:$/.test(url.protocol) || url.origin !== location.origin) return '[REDACTED_URL]'
      return url.pathname.replace(/[A-Za-z0-9_-]{24,}/g, '[DYNAMIC_ID]')
    } catch {
      return '[INVALID_URL]'
    }
  }
  const attrs = (el: Element) => {
    const out: Record<string, string> = {}
    for (const attr of Array.from(el.attributes)) {
      const n = attr.name
      if (/^(value|src|srcdoc|style|nonce|on.*)$/i.test(n)) continue
      if (
        !(
          /^(id|class|role|type|name|title|placeholder|accept|multiple|disabled|hidden|tabindex|contenteditable|href|dir)$/.test(
            n
          ) ||
          n.startsWith('aria-') ||
          n.startsWith('data-')
        )
      )
        continue
      if (/token|secret|auth|cookie|session|csrf|email/i.test(n)) continue
      if (n === 'href') out[n] = safeHref(attr.value)
      else if (n === 'class') out[n] = attr.value.slice(0, 600)
      else if (
        n.startsWith('data-') &&
        !/^(true|false|user|assistant|human|model|active|inactive|open|closed|[0-9]{1,3})$/.test(
          attr.value
        ) &&
        !/test.?id|slot|sidebar/.test(n)
      )
        out[n] = '[VALUE_REDACTED]'
      else if (n === 'id' && /radix|[0-9a-f]{8}-|[A-Za-z0-9_-]{28,}/i.test(attr.value))
        out[n] = '[DYNAMIC_ID]'
      else out[n] = redact(attr.value)
    }
    return out
  }
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'
  }
  const selectorFor = (el: Element): string | null => {
    const tag = el.tagName.toLowerCase()
    for (const name of [
      'data-testid',
      'data-test-id',
      'data-user-message-layout',
      'data-agent-transcript-message',
      'data-message-author-role',
      'data-message-author',
      'aria-label',
      'name',
      'role',
      'type'
    ]) {
      const value = el.getAttribute(name)
      if (!value || value.length > 100 || redact(value) !== value) continue
      const selector = `${tag}[${name}=${JSON.stringify(value)}]`
      try {
        if (document.querySelectorAll(selector).length) return selector
      } catch {
        /* invalid attribute value */
      }
    }
    return null
  }
  const describe = (el: Element) => {
    const r = el.getBoundingClientRect()
    const ancestors: Array<Record<string, unknown>> = []
    for (let p = el.parentElement, depth = 0; p && depth < 5; p = p.parentElement, depth++) {
      const s = getComputedStyle(p)
      ancestors.push({
        tag: p.tagName.toLowerCase(),
        attributes: attrs(p),
        overflowY: s.overflowY,
        clientHeight: p.clientHeight,
        scrollHeight: p.scrollHeight,
        scrollTop: Math.round(p.scrollTop)
      })
    }
    // Only preserve a small vocabulary of action labels, never arbitrary chat/title text.
    const text = /^(BUTTON|A)$/.test(el.tagName) ? (el.textContent || '').trim() : ''
    const actionText =
      /^(new chat|new conversation|send|stop|stop generating|attach|upload|add files|keep working|yes|no)$/i.test(
        text
      )
        ? text
        : undefined
    const children = Array.from(el.children)
      .slice(0, 5)
      .map((child) => ({ tag: child.tagName.toLowerCase(), attributes: attrs(child) }))
    return {
      tag: el.tagName.toLowerCase(),
      attributes: attrs(el),
      actionText,
      children,
      hasLayout: visible(el),
      inViewport: visible(el) && r.bottom > 0 && r.top < innerHeight,
      top: Math.round(r.top),
      height: Math.round(r.height),
      suggestedSelector: selectorFor(el),
      ancestors
    }
  }
  const candidates: Record<string, unknown[]> = Object.fromEntries(keys.map((k) => [k, []]))
  const queries: Record<string, string> = {
    attachmentSelector:
      'input[type="file"], button[aria-label*="attach" i], button[aria-label*="upload" i], [data-testid*="upload" i]',
    promptNavSelector:
      '[data-user-message-layout], [data-message-author-role="user"], [data-message-author="user"], [data-testid="user-message"], user-query, [class*="user-query"], [class*="user-message"]',
    composerSelector:
      'textarea:not([name*="captcha"]):not([id*="captcha"]), [contenteditable="true"], [role="textbox"]',
    sendButtonSelector: 'button[type="submit"], button[aria-label*="send" i], [data-testid*="send" i]',
    chatTitleSelector:
      'header h1, header h2, a[data-active="true"], [aria-current="page"], button[aria-haspopup="menu"] > span[dir="auto"].truncate',
    newChatSelector:
      'a[href="/"], a[href="/agent"], button[aria-label*="new" i], a[aria-label*="new" i], [data-testid*="new-chat" i]',
    stopGenerationSelector:
      'button[aria-label*="stop" i], [data-testid*="stop" i], button[class*="stop" i]',
    virtualizationSelector:
      '[data-agent-transcript-message], [data-chat-message-id], [data-message-id], [data-message-author-role], [data-testid="user-message"], [data-testid="assistant-message"]'
  }
  for (const key of keys) {
    const found = document.querySelectorAll(queries[key])
    candidates[key] = Array.from(found).slice(0, 16).map(describe)
    if (found.length > 16) warnings.push(`${key}: sampled 16 of ${found.length} matches`)
    if (!found.length)
      warnings.push(`${key}: no heuristic candidate in this state; not evidence of unsupported functionality`)
  }
  const validations: Record<string, unknown> = {}
  for (const key of keys) {
    const selector = current[key]
    if (typeof selector !== 'string' || !selector.trim()) continue
    try {
      const matches = document.querySelectorAll(selector)
      validations[key] = {
        count: matches.length,
        samples: Array.from(matches).slice(0, 4).map(describe)
      }
    } catch {
      validations[key] = { error: 'invalid-selector' }
    }
  }
  // Preserve icon-only controls and empty inputs; never clone chat text or input values.
  const controls = Array.from(
    document.querySelectorAll(
      'button, input, textarea, [contenteditable="true"], [role="button"], a[href]'
    )
  )
    .slice(0, 80)
    .map(describe)
  const frameCount = document.querySelectorAll('iframe').length
  if (frameCount)
    warnings.push(
      `${frameCount} iframe(s) not inspected; frame-local selectors cannot be used in the top document`
    )
  warnings.push(
    'Single-state, top-document capture. Closed shadow roots, other frames, inactive modes, and unmounted history are not inspected.'
  )
  warnings.push(
    'No prompts were submitted and no controls were clicked. Send/stop states may require separate user-driven captures.'
  )
  warnings.push(
    'Labels, class names, and attributes can still contain sensitive data. Review before copying to an external AI.'
  )
  const sampled = { candidates, validations, controls }
  let trimmed = false
  while (JSON.stringify(sampled).length > 160000) {
    trimmed = true
    if (controls.length) {
      controls.pop()
      continue
    }
    const largest = keys.reduce((a, b) =>
      candidates[a].length > candidates[b].length ? a : b
    )
    if (!candidates[largest].length) break
    candidates[largest].pop()
  }
  if (trimmed) warnings.push('Evidence trimmed to the 160k-character budget; omitted nodes remain unknown.')
  warnings.push('Control inventory samples at most 80 controls; heuristic groups sample 16 per hook.')
  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    origin: location.origin,
    path: safeHref(location.href),
    candidates,
    validations,
    controls,
    warnings,
    durationMs: Math.round(performance.now() - started)
  }
}

export function buildFeatureHookEvidenceScript(current: Record<string, unknown> = {}): string {
  const selectors = Object.fromEntries(
    Object.entries(current)
      .filter(([k, v]) => k.endsWith('Selector') && typeof v === 'string')
      .map(([k, v]) => [k, String(v).slice(0, 4000)])
  )
  return `(${collectFeatureHookEvidence.toString()})(${JSON.stringify(selectors)})`
}
