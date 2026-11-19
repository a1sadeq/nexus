import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { extractArenaHighlightedCode } from './arenaHighlightedCode'

function parse(content: string): ReturnType<typeof extractArenaHighlightedCode> {
  const doc = new JSDOM(`<code class="whitespace-pre-wrap break-words">${content}</code>`).window
    .document
  return extractArenaHighlightedCode(doc.querySelector('code')!)
}

describe('highlighted code candidate', () => {
  it('preserves token and newline text for the observed line shape', () => {
    expect(
      parse(
        '<span class="line"><span style="color: #abcdef">const</span> first = 1</span>\n<span class="line">const second = 2</span>\n<span class="line">console.log(first + second)</span>'
      )
    ).toEqual({
      ok: true,
      text: 'const first = 1\nconst second = 2\nconsole.log(first + second)'
    })
  })
  it('preserves blank lines and HTML-looking code as text', () => {
    expect(
      parse(
        '<span class="line">&lt;x&gt;</span>\n<span class="line"></span>\n<span class="line">end</span>'
      )
    ).toEqual({ ok: true, text: '<x>\n\nend' })
  })
  it.each([
    '<span class="line">x</span><span class="line">y</span>',
    '<span class="line">x</span>\n',
    '<span class="line"><span style="color:red; display:none">x</span></span>',
    '<span class="line"><span style="color:#fff; unknown: x">x</span></span>',
    '<span class="line"><span class="hidden">x</span></span>',
    '<span class="line"><span><em>x</em></span></span>',
    '<span class="line">x</span><!-- hidden -->',
    '<span class="line" data-extra="x">x</span>',
    '<img src="x">'
  ])('rejects ambiguous or unsupported shape %#', (html) => {
    expect(parse(html)).toEqual({ ok: false, reason: 'unsupported-content' })
  })
  it('rejects oversized text', () => {
    expect(parse(`<span class="line">${'a'.repeat(200001)}</span>`)).toEqual({
      ok: false,
      reason: 'limit-exceeded'
    })
  })
  it('rejects empty data and wrong class', () => {
    expect(parse('<span class="line"></span>')).toEqual({
      ok: false,
      reason: 'empty-content'
    })
    const doc = new JSDOM('<code class="other">x</code>').window.document
    expect(extractArenaHighlightedCode(doc.querySelector('code')!)).toEqual({
      ok: false,
      reason: 'unsupported-content'
    })
  })
})
