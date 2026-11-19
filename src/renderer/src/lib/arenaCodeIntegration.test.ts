import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { extractArenaResponse } from './arenaResponseExtract'

function block(code = 'const first = 1'): string {
  return `<pre><div class="not-prose" data-code-block=""><div class="header"><div class="label"><svg width="1"><path d="x"></path></svg><span class="lang">JavaScript</span></div><button type="button" data-state="closed" data-slot="copy"><svg><path d="x"></path></svg><svg><path d="x"></path></svg></button></div><div class="container"><pre class="shiki-code-block" style="color: #ffffff; background-color: #111111" tabindex="0"><code class="whitespace-pre-wrap break-words"><span class="line"><span style="color: #abcdef">${code}</span></span>\n<span class="line">console.log(first)</span></code></pre></div></div></pre>`
}
function extract(html: string): ReturnType<typeof extractArenaResponse> {
  const doc = new JSDOM(`<div class="prose">${html}</div>`).window.document
  return extractArenaResponse(doc.querySelector('.prose')!)
}

describe('Arena response and highlighted code integration', () => {
  it('preserves heading, list, language label and highlighted code without the control text', () => {
    const out = extract(`<h3>Probe</h3><ul><li>One</li><li>Two</li></ul>${block()}`)
    expect(out.ok).toBe(true)
    if (out.ok === false) return
    expect(out.nodes[2]).toEqual({
      type: 'code-block',
      language: 'JavaScript',
      text: 'const first = 1\nconsole.log(first)'
    })
  })
  it.each([
    block().replace('data-code-block=""', 'data-code-block="" data-extra="x"'),
    block().replace('type="button"', 'type="button" onclick="x"'),
    block().replace('</button>', 'unexpected</button>'),
    block().replace('</span></div><button', '</span><span>extra</span></div><button'),
    block().replace('</code></pre></div>', '</code><span>extra</span></pre></div>'),
    block().replace('color: #ffffff; background-color: #111111', 'color: #ffffff; display: none'),
    block().replace('color: #abcdef', 'color: red'),
    block().replace('data-code-block=""', 'data-unrelated=""')
  ])('rejects unsupported wrapper or code %#', (html) => {
    expect(extract(html)).toEqual({ ok: false, reason: 'unsupported-content' })
  })
  it('preserves existing simple code blocks', () => {
    expect(extract('<pre><code>plain code</code></pre>').ok).toBe(true)
  })
  it('applies cumulative response limits to multiple code blocks', () => {
    const large = block('a'.repeat(110000))
    expect(extract(large + large)).toEqual({ ok: false, reason: 'limit-exceeded' })
  })
})
