// Pure, unit-testable selection logic for the Alt+J/K prompt-navigation engine.
// The engine string (Task 3) inlines these same functions via .toString() so the
// tested logic and the page-context logic can never drift.

export interface MsgRect {
  top: number
  bottom: number
  el: unknown
}

/** Newest message whose top is strictly above anchorY. */
export function pickOlderTarget(msgs: MsgRect[], anchorY: number): MsgRect | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].top < anchorY) return msgs[i]
  }
  return null
}

/** Oldest message whose top is strictly below anchorY. */
export function pickNewerTarget(msgs: MsgRect[], anchorY: number): MsgRect | null {
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].top > anchorY) return msgs[i]
  }
  return null
}

export interface WinRect {
  top: number
  bottom: number
}

/** True if the rect intersects [scrollTop - clientHeight*m, scrollTop + clientHeight*m]. */
export function inWindow(rect: WinRect, scrollTop: number, clientHeight: number, m: number): boolean {
  const lo = scrollTop - clientHeight * m
  const hi = scrollTop + clientHeight * m
  return rect.bottom >= lo && rect.top <= hi
}

/** Newest message (last in array) whose top is strictly below anchorY. Array is assumed oldest→newest. */
export function pickNewestAbove<T extends WinRect>(msgs: T[], anchorY: number): T | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].top < anchorY) return msgs[i]
  }
  return null
}

// --- Engine string builder -------------------------------------------------
// buildEngine('older' | 'newer') returns a self-contained IIFE string executed
// in the webview page context via executeJavaScript. Must not close over any
// module scope (no imports, no outer variables) — inlines the pure functions.

export function buildEngine(dir: 'older' | 'newer', customSelector?: string): string {
  const pickOlder = pickOlderTarget.toString()
  const pickNewer = pickNewerTarget.toString()
  const inWin = inWindow.toString()
  const newestAbove = pickNewestAbove.toString()
  const custom = customSelector ? JSON.stringify(customSelector) : 'null'
  return `(() => {
  const DIR = ${JSON.stringify(dir)};
  const CUSTOM_SEL = ${custom};
  ${pickOlder}
  ${pickNewer}
  ${inWin}
  ${newestAbove}

  const TABLE = [
    { host: 'gemini.google.com', sel: 'user-query, [data-test-id="user-query"], .user-query-container, [class*="user-query"]' },
    { host: 'chat.qwen.ai', sel: '.chat-user-message, .qwen-chat-message-user, [class*="chat-user-message"]' },
    { host: 'qwen.ai', sel: '.chat-user-message, .qwen-chat-message-user, [class*="chat-user-message"]' },
    { host: 'kimi.ai', sel: '.segment.segment-user, [class*="segment-user"], [class*="user-segment"]' },
    { host: 'moonshot.cn', sel: '.segment.segment-user, [class*="segment-user"], [class*="user-segment"]' },
    { host: 'claude.ai', sel: '[data-testid="user-message"], .font-user-message, [class*="UserMessage"]' },
    { host: 'chatgpt.com', sel: '[data-message-author-role="user"]' },
    { host: 'chat.openai.com', sel: '[data-message-author-role="user"]' },
    { host: 'perplexity.ai', sel: '[data-testid="query-bubble"], [class*="user-query"], [class*="query-text"]' }
  ];
  const FALLBACK = '[class*="user-query"]:not([class*="assistant"]), [class*="user-message"], [class*="UserMessage"]';
  const EXCLUDE = /(assistant|answer|reply|response|model|markdown)/i;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function queryWindow(container) {
    const host = location.hostname;
    const row = TABLE.find(r => host.includes(r.host));
    const baseSel = row ? row.sel + ', ' + FALLBACK : FALLBACK;
    const sel = CUSTOM_SEL ? CUSTOM_SEL + ', ' + baseSel : baseSel;
    const out = [];
    const all = Array.from((container === document.documentElement || container === document.body || !container ? document : container).querySelectorAll(sel));
    for (const el of all) {
      const cls = (typeof el.className === 'string' ? el.className : '') + ' ' + (el.dataset && el.dataset.testId ? el.dataset.testId : '');
      if (EXCLUDE.test(cls)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const txt = (el.textContent || '').trim();
      if (!txt) continue;
      if (out.some(o => o.el.contains(el))) continue;
      out.push({ top: r.top, bottom: r.bottom, el });
    }
    return out;
  }

  function findContainer(el) {
    let best = null;
    let node = el.parentElement;
    while (node && node !== document.body) {
      if (node.scrollHeight > node.clientHeight + 4) {
        if (!best || node.scrollHeight > best.scrollHeight) best = node;
      }
      node = node.parentElement;
    }
    return best || document.scrollingElement || document.documentElement || document.body;
  }

  function firstUserEl() {
    const host = location.hostname;
    const row = TABLE.find(r => host.includes(r.host));
    const sel = row ? row.sel + ', ' + FALLBACK : FALLBACK;
    const all = Array.from(document.querySelectorAll(sel));
    for (const el of all) {
      const cls = (typeof el.className === 'string' ? el.className : '') + ' ' + (el.dataset && el.dataset.testId ? el.dataset.testId : '');
      if (EXCLUDE.test(cls)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (!(el.textContent || '').trim()) continue;
      return el;
    }
    return null;
  }

  function discoverContainer() {
    const st = window.__nexusNavState;
    if (st && st.container && st.container.isConnected) return st.container;
    const first = firstUserEl();
    if (first) return findContainer(first);
    const anyMsg = document.querySelector('[class*="response"], [class*="message"], [class*="answer"], [class*="segment"]');
    if (anyMsg && anyMsg.getBoundingClientRect().width > 0) return findContainer(anyMsg);
    return document.scrollingElement || document.documentElement || document.body;
  }

  function glideTo(container, targetY, ms, token) {
    const startY = container.scrollTop;
    const dist = targetY - startY;
    if (Math.abs(dist) < 1) return Promise.resolve();
    return new Promise(resolve => {
      const t0 = performance.now();
      const easeOut = p => 1 - Math.pow(1 - p, 3);
      let done = false;
      const finish = (snap) => {
        if (done) return;
        done = true;
        clearTimeout(watchdog);
        if (snap) container.scrollTop = targetY;
        resolve();
      };
      const watchdog = setTimeout(() => finish(true), ms + 250);
      const step = now => {
        if (done) return;
        if (window.__nexusNavRunToken !== token) { finish(false); return; }
        const p = Math.min(1, (now - t0) / ms);
        container.scrollTop = startY + dist * easeOut(p);
        if (p < 1) requestAnimationFrame(step);
        else finish(true);
      };
      requestAnimationFrame(step);
    });
  }

  function scrollToEl(container, el, ms, token) {
    const cr = container.getBoundingClientRect ? container.getBoundingClientRect() : { top: 0 };
    const r = el.getBoundingClientRect();
    const containerTop = (container === document.documentElement || container === document.scrollingElement || container === document.body) ? 0 : cr.top;
    const targetY = container.scrollTop + (r.top - containerTop) - (container.clientHeight - r.height) / 2;
    return glideTo(container, targetY, ms || 300, token);
  }

  function showToast(msg) {
    let t = document.getElementById('__nexusNavToast');
    if (!t) {
      t = document.createElement('div');
      t.id = '__nexusNavToast';
      t.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:rgba(20,20,20,.92);color:#fff;font:12px/1.5 system-ui,sans-serif;padding:8px 16px;border-radius:999px;z-index:2147483647;pointer-events:none;opacity:0;transition:opacity .25s ease;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,.25)';
      document.documentElement.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._t);
    t._t = setTimeout(() => { t.style.opacity = '0'; }, 1600);
  }

  function highlight(el) {
    const prevTrans = el.style.transition;
    const prevShadow = el.style.boxShadow;
    const prevRadius = el.style.borderRadius;
    
    el.style.transition = 'box-shadow 0.2s cubic-bezier(0.2, 0, 0, 1), border-radius 0.2s cubic-bezier(0.2, 0, 0, 1)';
    el.style.boxShadow = '0 0 0 3px rgba(138, 180, 248, 0.9), 0 4px 16px rgba(0, 0, 0, 0.4)';
    el.style.borderRadius = '12px';
    
    setTimeout(() => {
      el.style.transition = 'box-shadow 0.8s cubic-bezier(0.2, 0, 0, 1), border-radius 0.8s cubic-bezier(0.2, 0, 0, 1)';
      el.style.boxShadow = '0 0 0 8px rgba(138, 180, 248, 0), 0 4px 12px rgba(0, 0, 0, 0)';
      
      setTimeout(() => { 
        el.style.transition = prevTrans; 
        el.style.boxShadow = prevShadow;
        el.style.borderRadius = prevRadius;
      }, 800);
    }, 250);
  }

  async function main() {
    const token = (window.__nexusNavRunToken = (window.__nexusNavRunToken || 0) + 1);
    const alive = () => window.__nexusNavRunToken === token;

    const container = discoverContainer();
    if (!container) return { status: 'none' };
    window.__nexusNavState = { ...(window.__nexusNavState || {}), container };
    const cr = container.getBoundingClientRect ? container.getBoundingClientRect() : { top: 0 };

    const containerTop = (container === document.documentElement || container === document.scrollingElement || container === document.body) 
      ? 0 
      : cr.top;

    const st = window.__nexusNavState;
    const lastTarget = st && st.el && st.el.isConnected ? st.el : null;
    let anchorY = containerTop + container.clientHeight / 2;
    if (lastTarget) {
      const r = lastTarget.getBoundingClientRect();
      if (r.bottom >= containerTop && r.top <= containerTop + container.clientHeight) {
        anchorY = r.top;
      }
    }

    let msgs = queryWindow(container);
    let target = DIR === 'older' ? pickNewestAbove(msgs, anchorY) : pickNewerTarget(msgs, anchorY);

    let iters = 0;
    while (!target && iters++ < 30) {
      const before = container.scrollTop;
      const step = container.clientHeight * 0.8;
      const next = before + (DIR === 'older' ? -1 : 1) * step;
      if (next < 0) break;
      if (next > container.scrollHeight - container.clientHeight) break;
      await glideTo(container, next, 200, token);
      if (!alive()) return { status: 'cancelled' };
      if (container.scrollTop === before) break;
      msgs = queryWindow(container);
      target = DIR === 'older' ? pickNewestAbove(msgs, anchorY) : pickNewerTarget(msgs, anchorY);
    }

    if (target) {
      await scrollToEl(container, target.el, 300, token);
      if (!alive()) return { status: 'cancelled' };
      window.__nexusNavState = { el: target.el, container };
      highlight(target.el);
      return { status: 'ok' };
    }

    showToast(DIR === 'older' ? 'Already at oldest prompt' : 'Already at newest prompt');
    return { status: 'boundary' };
  }

  return main();
})()`
}

/** Type of the result object the engine resolves to (mirrors return values above). */
export type EngineResult = {
  status: 'ok' | 'busy' | 'none' | 'boundary' | 'cancelled'
  wrapped?: boolean
}
