export function fzfMatch(query: string, text: string): boolean {
  if (query === '') return true
  // Smart-case: if the query contains any uppercase letter, match case-sensitively.
  const hasUpper = /[A-Z]/.test(query)
  const haystack = hasUpper ? text : text.toLowerCase()
  const needle = hasUpper ? query : query.toLowerCase()
  return haystack.includes(needle)
}
