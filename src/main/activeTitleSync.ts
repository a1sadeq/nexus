import { splitSelectorList } from '../shared/selectorUtils'

/** Reads only the configured title selector; no page content, URL, or title is logged. */
export function buildActiveTitleReadScript(selector: string): string {
  return `(() => {
    const splitList = ${splitSelectorList.toString()};
    for (const s of splitList(${JSON.stringify(selector)})) {
      let nodes;
      try { nodes = document.querySelectorAll(s); } catch (_) { continue; }
      for (const el of nodes) {
        const txt = (el.innerText || el.textContent || '').trim();
        if (!txt) continue;
        const st = getComputedStyle(el);
        if (el.getClientRects().length && st.visibility !== 'hidden' && st.display !== 'none' && !el.closest('[hidden], [aria-hidden="true"]')) return txt;
      }
    }
    return '';
  })()`
}

export interface ActiveTitleTask {
  contents: object
  intervalMs: number
  canRun: () => boolean
  read: () => Promise<string | null>
  publish: (title: string) => void
}

/** One active-view timer, single-flight per WebContents, with stale-result rejection. */
export class ActiveTitleSync {
  private timer: ReturnType<typeof setTimeout> | null = null
  private revision = 0
  private busy = new WeakSet<object>()
  private lastPublished: string | null = null

  start(task: ActiveTitleTask): void {
    this.stop()
    if (!Number.isFinite(task.intervalMs) || task.intervalMs <= 0) return
    const revision = this.revision
    const tick = () => {
      if (revision !== this.revision) return
      this.timer = setTimeout(tick, task.intervalMs)
      let runnable = false
      try { runnable = task.canRun() } catch { return }
      if (!runnable || this.busy.has(task.contents)) return
      this.busy.add(task.contents)
      Promise.resolve().then(() => {
        if (revision !== this.revision || !task.canRun()) return null
        return task.read()
      }).then((title) => {
        if (revision !== this.revision || !title || title === this.lastPublished || !task.canRun()) return
        task.publish(title)
        this.lastPublished = title
      }).catch(() => { /* navigation and destroyed views are expected; retry next tick */ })
        .finally(() => this.busy.delete(task.contents))
    }
    tick()
  }

  /** A native page-title update may have overwritten the last fallback title. */
  invalidate(): void { this.lastPublished = null }

  stop(): void {
    this.revision++
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.lastPublished = null
  }
}
