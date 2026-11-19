import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { extractArenaResponse } from './arenaResponseExtract'

function extract(html: string): ReturnType<typeof extractArenaResponse> {
  const doc = new JSDOM(`<div class="prose">${html}</div>`).window.document
  return extractArenaResponse(doc.querySelector('.prose')!)
}
const link =
  '<a target="_blank" rel="noopener" href="https://example.com" class="link">Visit example.com</a>'
const table =
  '<div class="table-wrapper"><table node="[object Object]" class="table"><thead><tr><th node="x" class="header">Item</th><th node="x" class="header">Status</th></tr></thead><tbody><tr><td node="x" class="cell">Build</td><td node="x" class="cell">Ready</td></tr></tbody></table></div>'

describe('Arena rich-response candidate', () => {
  it('preserves link destination, table structure and inline code', () => {
    const result = extract(
      `<h3>Example</h3><p>${link}</p>${table}<p>Run <code class="inline" node="x">npm test</code>.</p>`
    )
    expect(result.ok).toBe(true)
    if (result.ok === false) return
    expect(result.nodes[1]).toEqual({
      type: 'element',
      tag: 'p',
      children: [
        {
          type: 'link',
          href: 'https://example.com',
          children: [{ type: 'text', value: 'Visit example.com' }]
        }
      ]
    })
    expect(result.nodes[2].type === 'element' && result.nodes[2].tag).toBe('table-wrapper')
    expect(JSON.stringify(result.nodes)).toContain('npm test')
    expect(JSON.stringify(result.nodes)).toContain('Ready')
  })
  it.each([
    link.replace('https://example.com', 'javascript:alert(1)'),
    link.replace('https://example.com', '/relative'),
    link.replace('https://example.com', 'https://user:pass@example.com'),
    link.replace('class="link"', 'class="link" onclick="alert(1)"'),
    table.replace('<table ', 'unexpected<table '),
    table.replace('class="table-wrapper"', 'style="display:none"'),
    table.replace('class="cell"', 'class="cell" colspan="2"'),
    '<p><code class="inline" node="x" style="display:none">x</code></p>',
    '<div class="wrapper"><p>unknown</p></div>'
  ])('rejects unfamiliar or unsafe content %#', (html) => {
    expect(extract(html)).toEqual({ ok: false, reason: 'unsupported-content' })
  })
  it('counts long attributes towards the shared size budget', () => {
    expect(extract(link.replace('class="link"', `class="${'x'.repeat(200001)}"`))).toEqual({
      ok: false,
      reason: 'limit-exceeded'
    })
  })
})
