import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { extractArenaResponse } from './arenaResponseExtract'

function extract(html: string): ReturnType<typeof extractArenaResponse> {
  const doc = new JSDOM(`<div class="prose">${html}</div>`).window.document
  return extractArenaResponse(doc.querySelector('.prose')!)
}

describe('conservative Arena response extraction', () => {
  it('preserves a simple paragraph and exact text', () => {
    expect(extract('<p>NEXUS_REVIEW_PROBE_314159</p>')).toEqual({
      ok: true,
      nodes: [
        {
          type: 'element',
          tag: 'p',
          children: [{ type: 'text', value: 'NEXUS_REVIEW_PROBE_314159' }]
        }
      ]
    })
  })
  it('preserves headings, list boundaries and emphasis', () => {
    const result = extract(
      '<h3>Probe</h3><ul><li>First <strong>item</strong></li><li>Second item</li></ul>'
    )
    expect(result.ok).toBe(true)
    if (result.ok)
      expect(result.nodes.map((n) => n.type === 'element' && n.tag)).toEqual(['h3', 'ul'])
  })
  it('preserves a simple code block without interpreting text as HTML', () => {
    const result = extract('<pre><code>console.log(&quot;&lt;probe&gt;&quot;)</code></pre>')
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result)).toContain('console.log')
  })
  it('rejects the observed nested pre and language header rather than flattening', () => {
    expect(
      extract(
        '<pre><div>JavaScript</div><pre><code>console.log(&quot;probe&quot;)</code></pre></pre>'
      )
    ).toEqual({ ok: false, reason: 'unsupported-content' })
  })
  it.each([
    '<p>ok</p><img src="x">',
    '<p>ok <a href="https://example.com">link</a></p>',
    '<p style="display:none">secret</p>',
    '<p>ok</p><!-- omitted -->',
    '<table><tr><td>x</td></tr></table>',
    '<p><span>text</span></p>'
  ])('rejects unsupported or attributed content %#', (html) =>
    expect(extract(html)).toEqual({ ok: false, reason: 'unsupported-content' })
  )
  it('rejects empty output', () =>
    expect(extract('  <p> </p>')).toEqual({
      ok: false,
      reason: 'empty-content'
    }))
  it('rejects oversized content', () =>
    expect(extract(`<p>${'x'.repeat(200001)}</p>`)).toEqual({
      ok: false,
      reason: 'limit-exceeded'
    }))
  it('rejects excessive nesting', () =>
    expect(extract(`${'<em>'.repeat(67)}x${'</em>'.repeat(67)}`)).toEqual({
      ok: false,
      reason: 'limit-exceeded'
    }))
  it('rejects a missing or incorrect root', () => {
    const doc = new JSDOM('<div>hi</div>').window.document
    expect(extractArenaResponse(doc.querySelector('div')!)).toEqual({
      ok: false,
      reason: 'invalid-root'
    })
    expect(extractArenaResponse(null as never)).toEqual({
      ok: false,
      reason: 'invalid-root'
    })
  })
})
