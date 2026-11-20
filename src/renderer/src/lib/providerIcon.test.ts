import { describe, it, expect } from 'vitest'
import { isSvgMarkup, resolveProviderIconSource, sanitizeSvgMarkup } from './providerIcon'

const BRANDS = ['gemini', 'chatgpt', 'claude']

describe('configured provider icons', () => {
  it('uses the SVG the user configured', () => {
    const source = resolveProviderIconSource('gemini', '<svg viewBox="0 0 24 24"><path d="M2 2h20" /></svg>', BRANDS)
    expect(source.custom).toContain('<path d="M2 2h20" />')
    expect(source.hasBrand).toBe(true)
  })

  it('prefers the configured icon even when a built-in brand path exists', () => {
    // This is the bug: the tabs drew the brand path and ignored the configuration.
    const source = resolveProviderIconSource('gemini', '<svg><circle r="4" /></svg>', BRANDS)
    expect(source.custom).toBeDefined()
  })

  it('falls back to the brand path when nothing is configured', () => {
    const source = resolveProviderIconSource('claude', undefined, BRANDS)
    expect(source.custom).toBeUndefined()
    expect(source.hasBrand).toBe(true)
  })

  it('falls back when the field holds something that is not SVG at all', () => {
    expect(resolveProviderIconSource('claude', 'circle', BRANDS).custom).toBeUndefined()
    expect(sanitizeSvgMarkup('just a note')).toBeUndefined()
    expect(sanitizeSvgMarkup('')).toBeUndefined()
    expect(sanitizeSvgMarkup(undefined)).toBeUndefined()
  })

  it('reports no brand path for an unknown provider, so the caller can draw a neutral mark', () => {
    const source = resolveProviderIconSource('some-new-thing', undefined, BRANDS)
    expect(source.hasBrand).toBe(false)
  })
})

describe('sanitising pasted markup', () => {
  it('drops script elements and their contents', () => {
    const cleaned = sanitizeSvgMarkup('<svg><script>alert(1)</script><path d="M0 0h4" /></svg>')
    expect(cleaned).toBeDefined()
    expect(cleaned).not.toContain('script')
    expect(cleaned).not.toContain('alert')
    expect(cleaned).toContain('<path d="M0 0h4" />')
  })

  it('drops self-closing and unclosed variants too', () => {
    expect(sanitizeSvgMarkup('<svg><script src="x.js" /><path d="M0 0" /></svg>')).not.toContain('script')
    expect(sanitizeSvgMarkup('<svg><SCRIPT>x</SCRIPT><path d="M0 0" /></svg>')).not.toContain('SCRIPT')
  })

  it('drops event handler attributes in all quoting styles', () => {
    const cleaned = sanitizeSvgMarkup(
      '<svg onload="alert(1)"><path onclick=\'alert(2)\' onmouseover=alert(3) d="M0 0" /></svg>'
    )
    expect(cleaned).not.toContain('onload')
    expect(cleaned).not.toContain('onclick')
    expect(cleaned).not.toContain('onmouseover')
    expect(cleaned).toContain('d="M0 0"')
  })

  it('drops javascript: and data:text/html URLs', () => {
    const cleaned = sanitizeSvgMarkup(
      '<svg><a href="javascript:alert(1)"><path d="M0 0" /></a><use xlink:href="data:text/html,<b>" /></svg>'
    )
    expect(cleaned).not.toContain('javascript:')
    expect(cleaned).not.toContain('data:text/html')
  })

  it('drops foreignObject, iframe, object, embed and media', () => {
    const cleaned = sanitizeSvgMarkup(
      '<svg><foreignObject><b>x</b></foreignObject><iframe src="x"></iframe><embed src="y"><audio src="z"></audio><path d="M0 0" /></svg>'
    )
    for (const element of ['foreignObject', 'iframe', 'embed', 'audio']) {
      expect(cleaned).not.toContain(element)
    }
    expect(cleaned).toContain('<path d="M0 0" />')
  })

  it('strips the XML prolog and doctype, which are invalid inside an HTML node', () => {
    const cleaned = sanitizeSvgMarkup('<?xml version="1.0"?><!DOCTYPE svg><svg><path d="M0 0" /></svg>')
    expect(cleaned).not.toContain('<?xml')
    expect(cleaned).not.toContain('DOCTYPE')
    expect(cleaned?.startsWith('<svg')).toBe(true)
  })

  it('keeps ordinary drawing markup untouched', () => {
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></svg>'
    const cleaned = sanitizeSvgMarkup(markup)
    expect(cleaned).toBe(markup)
  })

  it('returns undefined when sanitising left no svg behind', () => {
    expect(sanitizeSvgMarkup('<script>alert(1)</script>')).toBeUndefined()
  })

  it('recognises svg with attributes and without', () => {
    expect(isSvgMarkup('<svg>')).toBe(true)
    expect(isSvgMarkup('<svg viewBox="0 0 1 1">')).toBe(true)
    expect(isSvgMarkup('<svgs>')).toBe(false)
    expect(isSvgMarkup(null as unknown as string)).toBe(false)
  })
})
