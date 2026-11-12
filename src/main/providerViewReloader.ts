// Reload only AI webview instances whose viewModelKeys match one of the supplied
// provider keys, normalizing 'google' -> 'gemini' so it aligns with the model key
// registry used by the renderer.
import type { WebContentsView } from 'electron'

export function reloadProviderViews(
  aiViews: Map<string, WebContentsView>,
  viewModelKeys: Map<string, string>,
  providers: Iterable<string>
): void {
  const targetKeys = new Set<string>()
  for (const p of providers) {
    if (p === 'google') targetKeys.add('gemini')
    else targetKeys.add(p)
  }
  for (const [tabId, view] of aiViews.entries()) {
    const key = viewModelKeys.get(tabId) ?? ''
    if (!targetKeys.has(key)) continue
    if (view.webContents.isDestroyed()) {
      aiViews.delete(tabId)
      viewModelKeys.delete(tabId)
      continue
    }
    view.webContents.reload()
  }
}