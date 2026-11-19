import { extractArenaHighlightedCode } from './arenaHighlightedCode'

export type ArenaCodeBlockResult =
  | {
      ok: true
      language: string
      text: string
      nodeCount: number
      charCount: number
      maxDepth: number
    }
  | { ok: false; reason: 'unsupported-content' | 'limit-exceeded' }

// This is an exact structural compatibility check, not provider authentication,
// sanitization, CSS visibility verification or proof of response completeness.
export function extractArenaCodeBlock(outer: Element): ArenaCodeBlockResult {
  let nodeCount = 0
  let charCount = 0
  let maxDepth = 0
  const pending: Array<{ node: Node; depth: number }> = [{ node: outer, depth: 0 }]
  while (pending.length) {
    const current = pending.pop()!
    if (++nodeCount > 10000 || current.depth > 64) return { ok: false, reason: 'limit-exceeded' }
    maxDepth = Math.max(maxDepth, current.depth)
    const n = current.node
    if (n.nodeType === 3) charCount += (n.nodeValue ?? '').length
    else if (n.nodeType === 1) {
      for (const attr of Array.from((n as Element).attributes))
        charCount += attr.name.length + attr.value.length
    } else return { ok: false, reason: 'unsupported-content' }
    if (charCount > 200000) return { ok: false, reason: 'limit-exceeded' }
    for (const child of Array.from(n.childNodes))
      pending.push({ node: child, depth: current.depth + 1 })
  }
  const fail = (): ArenaCodeBlockResult => ({ ok: false, reason: 'unsupported-content' })
  const tag = (el: Element, name: string): boolean => el.localName === name
  const attrs = (el: Element, allowed: string[]): boolean =>
    Array.from(el.attributes).every((a) => allowed.includes(a.name))
  const elements = (el: Element): Element[] | null => {
    const result: Element[] = []
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 1) result.push(n as Element)
      else if (n.nodeType !== 3 || (n.nodeValue ?? '').trim()) return null
    }
    return result
  }
  const svg = (el: Element): boolean => {
    if (
      !tag(el, 'svg') ||
      !attrs(el, [
        'width',
        'height',
        'stroke-width',
        'viewBox',
        'viewbox',
        'fill',
        'xmlns',
        'color',
        'class'
      ])
    )
      return false
    const paths = elements(el)
    return (
      paths !== null &&
      paths.length > 0 &&
      paths.every(
        (p) =>
          tag(p, 'path') &&
          attrs(p, ['d', 'stroke', 'stroke-linecap', 'stroke-linejoin', 'fill']) &&
          elements(p)?.length === 0
      )
    )
  }
  if (!tag(outer, 'pre') || outer.attributes.length) return fail()
  const top = elements(outer)
  if (!top || top.length !== 1) return fail()
  const wrapper = top[0]
  if (
    !tag(wrapper, 'div') ||
    !wrapper.hasAttribute('data-code-block') ||
    !wrapper.classList.contains('not-prose') ||
    !attrs(wrapper, ['class', 'data-code-block'])
  )
    return fail()
  const parts = elements(wrapper)
  if (!parts || parts.length !== 2) return fail()
  const [header, body] = parts
  if (
    !tag(header, 'div') ||
    !attrs(header, ['class']) ||
    !tag(body, 'div') ||
    !attrs(body, ['class'])
  )
    return fail()
  const headerParts = elements(header)
  if (!headerParts || headerParts.length !== 2) return fail()
  const [labelBox, button] = headerParts
  if (
    !tag(labelBox, 'div') ||
    !attrs(labelBox, ['class']) ||
    !tag(button, 'button') ||
    !attrs(button, ['class', 'type', 'data-state', 'data-slot'])
  )
    return fail()
  const labelParts = elements(labelBox)
  if (!labelParts || labelParts.length !== 2 || !svg(labelParts[0])) return fail()
  const label = labelParts[1]
  if (
    !tag(label, 'span') ||
    !attrs(label, ['class']) ||
    Array.from(label.childNodes).some((n) => n.nodeType !== 3)
  )
    return fail()
  const language = label.textContent ?? ''
  if (!language.trim() || language.length > 200) return fail()
  const icons = elements(button)
  if (!icons || icons.length !== 2 || !icons.every(svg)) return fail()
  const bodyParts = elements(body)
  if (!bodyParts || bodyParts.length !== 1) return fail()
  const innerPre = bodyParts[0]
  if (
    !tag(innerPre, 'pre') ||
    !innerPre.classList.contains('shiki-code-block') ||
    !attrs(innerPre, ['class', 'style', 'tabindex'])
  )
    return fail()
  // Only color/background styling is tolerated. External stylesheets and the
  // values of styling are not an evidence of rendered visibility.
  if (innerPre.hasAttribute('style')) {
    const rawStyle = innerPre.getAttribute('style') ?? ''
    const declarations = rawStyle.split(';').filter((part) => part.trim())
    if (
      !declarations.length ||
      declarations.some(
        (part) =>
          !/^\s*(?:color|background-color)\s*:\s*(?:#[a-f0-9]{3,8}|rgba?\([\d.,%\s]+\))\s*$/i.test(
            part
          )
      )
    )
      return fail()
  }
  const inner = elements(innerPre)
  if (!inner || inner.length !== 1) return fail()
  const code = extractArenaHighlightedCode(inner[0])
  if (code.ok === false)
    return {
      ok: false,
      reason: code.reason === 'limit-exceeded' ? 'limit-exceeded' : 'unsupported-content'
    }
  return { ok: true, language, text: code.text, nodeCount, charCount, maxDepth }
}
