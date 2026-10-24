import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { buildFeatureHookEvidenceScript } from './featureHookEvidence'

function capture(html: string, selectors: Record<string, unknown> = {}) {
  const dom = new JSDOM(html, {
    url: 'https://arena.ai/agent/example?token=secret',
    runScripts: 'outside-only'
  })
  try {
    return dom.window.eval(buildFeatureHookEvidenceScript(selectors)) as any
  } finally {
    dom.window.close()
  }
}

describe('audit regressions', () => {
  it('preserves author semantics while removing auth credential attributes', () => {
    const result = capture('<div data-message-author-role="user" data-auth-token="PRIVATE_TOKEN"></div>')
    expect(result.candidates.promptNavSelector[0].attributes['data-message-author-role']).toBe('user')
    expect(JSON.stringify(result)).not.toContain('PRIVATE_TOKEN')
  })
  it('never reconstructs a redacted value in suggestedSelector or class attributes', () => {
    const result = capture('<div data-user-message-layout="PRIVATE_LAYOUT_SECRET" class="account-user@example.test"></div>')
    expect(JSON.stringify(result)).not.toContain('PRIVATE_LAYOUT_SECRET')
    expect(JSON.stringify(result)).not.toContain('user@example.test')
  })
  it('caps the entire object including validation samples and pathological attributes', () => {
    const attrs = Array.from({ length: 100 }, (_, i) => ` data-testid-${i}="${'x'.repeat(500)}"`).join('')
    const dom = new JSDOM(`<div ${attrs}><button ${attrs}>Send</button></div>`.repeat(5), { url: 'https://arena.ai/', runScripts: 'outside-only' })
    try {
      dom.window.performance.now = () => 0 // deterministic: exercise size cap, not deadline
      const selectors = Object.fromEntries(['attachmentSelector', 'promptNavSelector', 'composerSelector', 'sendButtonSelector', 'chatTitleSelector', 'newChatSelector', 'stopGenerationSelector', 'virtualizationSelector'].map(k => [k, '*']))
      const result = dom.window.eval(buildFeatureHookEvidenceScript(selectors)) as any
      expect(JSON.stringify(result).length).toBeLessThanOrEqual(64000)
      expect(result.validations.composerSelector.count).toBeGreaterThan(0)
    } finally { dom.window.close() }
  })
  it('reports overlong selectors without silently turning them into a different expression', () => {
    const result = capture('<textarea></textarea>', { composerSelector: 'textarea' + ' '.repeat(2100) })
    expect(result.validations.composerSelector.error).toBe('selector-too-long')
  })
  it('retains complete counts while sampling and identifies skipped frame scope', () => {
    const result = capture('<textarea></textarea><iframe></iframe>')
    expect(result.counts.composerSelector).toBe(1)
    expect(result.framesDetected).toBe(1)
    expect(result.version).toBe(2)
  })
})

describe('read-only feature hook evidence', () => {
  it('emits executable JavaScript and retains empty icon buttons, hidden files, and href targets', () => {
    const result = capture(
      '<button aria-label="Send"><svg></svg></button><input type="file" hidden accept=".txt"><a href="/agent">New Chat</a>'
    )
    expect(result.candidates.sendButtonSelector[0].attributes['aria-label']).toBe('Send')
    expect(result.candidates.attachmentSelector[0].attributes.type).toBe('file')
    expect(result.candidates.newChatSelector[0].attributes.href).toBe('/agent')
  })

  it('never copies conversation text, input values, scripts, URL queries, or external links', () => {
    const result = capture(
      '<div>PRIVATE_CHAT</div><textarea>PRIVATE_DRAFT</textarea><input value="PRIVATE_VALUE"><script>PRIVATE_SCRIPT</script><a href="https://external.test/?secret=x">private</a>'
    )
    const json = JSON.stringify(result)
    for (const secret of [
      'PRIVATE_CHAT',
      'PRIVATE_DRAFT',
      'PRIVATE_VALUE',
      'PRIVATE_SCRIPT',
      'token=secret',
      'external.test'
    ]) {
      expect(json).not.toContain(secret)
    }
  })

  it('validates current selectors and reports invalid selectors without crashing', () => {
    const result = capture('<textarea></textarea>', {
      composerSelector: 'textarea',
      sendButtonSelector: '['
    })
    expect(result.validations.composerSelector.count).toBe(1)
    expect(result.validations.sendButtonSelector.error).toBe('invalid-selector')
  })

  it('preserves user-root attributes and distinguishes them from assistant roots', () => {
    const result = capture(
      '<div data-agent-transcript-message="true" data-chat-message-id="secret"><div data-user-message-layout="true"></div></div><div data-agent-transcript-message="true"></div>',
      {
        promptNavSelector:
          '[data-agent-transcript-message]:has(> [data-user-message-layout])'
      }
    )
    expect(result.validations.promptNavSelector.count).toBe(1)
    expect(result.candidates.virtualizationSelector).toHaveLength(2)
    expect(
      result.candidates.promptNavSelector[0].ancestors[0].attributes['data-chat-message-id']
    ).toBe('[VALUE_REDACTED]')
  })

  it('reports absent-state and frame limitations rather than inventing controls', () => {
    const result = capture('<iframe></iframe>')
    expect(result.candidates.stopGenerationSelector).toHaveLength(0)
    expect(result.warnings.join(' ')).toContain('iframe')
    expect(result.warnings.join(' ')).toContain('not evidence of unsupported')
  })

  it('bounds sampling and strips executable/non-selector configuration before injection', () => {
    const result = capture('<button aria-label="Send"></button>'.repeat(300), {
      customInitScript: 'SECRET_INIT'
    })
    expect(result.controls.length).toBeLessThanOrEqual(80)
    expect(JSON.stringify(result).length).toBeLessThan(165000)
    expect(buildFeatureHookEvidenceScript({ customInitScript: 'SECRET_INIT' })).not.toContain(
      'SECRET_INIT'
    )
  })
})
