/** Splits a CSS selector list on TOP-LEVEL commas only, so multi-selector
 *  configs resolve in PRIORITY order. `document.querySelector("a, b")`
 *  returns the first match in DOCUMENT order, which lets broad alternatives
 *  hijack the intended target. Handles quotes and nested parens/brackets
 *  (`:not(a, b)`, `[attr*="x, y"]`). */
export function splitSelectorList(sel: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  let q: string | null = null
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i]
    if (q) {
      cur += c
      if (c === q && sel[i - 1] !== '\\') q = null
      continue
    }
    if (c === '"' || c === "'") {
      q = c
      cur += c
      continue
    }
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    if (c === ',' && depth === 0) {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}
