// Pure, unit-testable selection logic and injected prompt-navigation engine.
// Alt+J: move to next/newer user prompt.
// Alt+K: move to previous/older user prompt.

export interface CandidateRoot {
  id?: string
  top: number
  bottom: number
  height: number
  el?: unknown
}

export interface ContainerInfo {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  clientTop?: number
  rectTop?: number
  isDocument?: boolean
}

export interface NavigationResult {
  status:
    | 'ok'
    | 'boundary'
    | 'no-matches'
    | 'invalid-selector'
    | 'no-container'
    | 'search-exhausted'
    | 'cancelled'
    | 'error'
  direction: 'older' | 'newer'
  matchedCount: number
  targetId?: string
  containerTag?: string
  scrollBefore?: number
  scrollAfter?: number
  reason?: string
  durationMs?: number
}

// Backward-compatible alias
export type EngineResult = NavigationResult

// --- Legacy exports for backward compatibility ------------------------------
export interface MsgRect {
  top: number
  bottom: number
  el: unknown
}

export function pickOlderTarget(msgs: MsgRect[], anchorY: number): MsgRect | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].top < anchorY) return msgs[i]
  }
  return null
}

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

export function inWindow(
  rect: WinRect,
  scrollTop: number,
  clientHeight: number,
  m: number
): boolean {
  const lo = scrollTop - clientHeight * m
  const hi = scrollTop + clientHeight * m
  return rect.bottom >= lo && rect.top <= hi
}

export function pickNewestAbove<T extends WinRect>(msgs: T[], anchorY: number): T | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].top < anchorY) return msgs[i]
  }
  return null
}

// --- Pure Helpers -----------------------------------------------------------

/** Matches hostname against target host rule (exact match or dot-separated subdomain). */
export function isMatchingHostname(hostname: string, targetHost: string): boolean {
  if (!hostname || !targetHost) return false
  const h = hostname.toLowerCase().trim()
  const t = targetHost.toLowerCase().trim()
  return h === t || h.endsWith('.' + t)
}

/**
 * Resolves the effective promptNav selector:
 * 1. If customSelector is provided and non-empty, it takes strict precedence (authoritative; no fallback appended).
 * 2. Else matches hostname against the provider table.
 * 3. Else uses fallback generic selector.
 */
export function resolveEffectiveSelector(
  customSelector: string | undefined | null,
  hostname: string,
  table: Array<{ host: string; sel: string }>,
  fallback: string
): string {
  const trimmed = (customSelector || '').trim()
  if (trimmed) return trimmed
  const row = table.find((r) => isMatchingHostname(hostname, r.host))
  if (row && row.sel) return row.sel
  return fallback
}

/**
 * Calculates target scrollTop to bring an element's top into view below sticky headers.
 * Top-aligns target rather than centering it, preventing tall prompts from being pushed off-screen.
 */
export function calculateScrollTarget(
  container: ContainerInfo,
  targetRect: { top: number; height?: number },
  topInset: number = 24
): number {
  const cTop = container.isDocument ? 0 : (container.rectTop ?? 0) + (container.clientTop ?? 0)
  const relativeTop = targetRect.top - cTop
  const desired = container.scrollTop + relativeTop - topInset
  const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight)
  return Math.max(0, Math.min(maxScroll, Math.round(desired)))
}

/**
 * Picks the target index in an ordered array of candidate roots.
 * If currentIndex is valid (0 <= currentIndex < rootsCount):
 *   older -> currentIndex - 1 (or -1 if already at index 0)
 *   newer -> currentIndex + 1 (or -1 if already at index rootsCount - 1)
 * If currentIndex is -1 (uninitialized or re-anchoring from geometry):
 *   Calculates based on anchorTop relative to container viewport top,
 *   with boundary handling for top / bottom of chat.
 */
export function pickTargetIndex(
  rootsCount: number,
  currentIndex: number,
  dir: 'older' | 'newer',
  rootsGeometry?: Array<{ top: number; bottom: number }>,
  anchorTop?: number,
  isAtBoundary?: 'top' | 'bottom' | null
): number {
  if (rootsCount <= 0) return -1

  // Identity-based progression during an uninterrupted sequence
  if (currentIndex >= 0 && currentIndex < rootsCount) {
    if (dir === 'older') {
      return currentIndex - 1
    } else {
      return currentIndex + 1 >= rootsCount ? -1 : currentIndex + 1
    }
  }

  // Fallback: Re-anchor from geometry
  if (!rootsGeometry || rootsGeometry.length === 0) {
    return dir === 'older' ? rootsCount - 1 : 0
  }

  // If at top of transcript and going newer, select first prompt
  if (isAtBoundary === 'top' && dir === 'newer') {
    return 0
  }
  // If at bottom of transcript and going older, select last prompt
  if (isAtBoundary === 'bottom' && dir === 'older') {
    return rootsCount - 1
  }

  const anchor = anchorTop !== undefined ? anchorTop : 0

  if (dir === 'older') {
    for (let i = rootsGeometry.length - 1; i >= 0; i--) {
      if (rootsGeometry[i].top < anchor - 10) {
        return i
      }
    }
    // If none strictly above anchor, align prompt 0 if it is visible
    return rootsGeometry[0].top < anchor + 20 ? 0 : -1
  } else {
    for (let i = 0; i < rootsGeometry.length; i++) {
      if (rootsGeometry[i].top > anchor + 10) {
        return i
      }
    }
    return -1
  }
}

// --- Engine string builder --------------------------------------------------
// buildEngine('older' | 'newer', customSelector) returns a self-contained IIFE string
// executed in the webview page context via executeJavaScript. Must not close over
// any module scope (no outer variables) — inlines all pure helpers via .toString().

export function buildEngine(dir: 'older' | 'newer', customSelector?: string): string {
  const matchHostFn = isMatchingHostname.toString()
  const resolveSelFn = resolveEffectiveSelector.toString()
  const calcScrollFn = calculateScrollTarget.toString()
  const pickTargetFn = pickTargetIndex.toString()
  const custom = customSelector ? JSON.stringify(customSelector) : 'null'

  return `(() => {
  const DIR = ${JSON.stringify(dir)};
  const CUSTOM_SEL = ${custom};

  const isMatchingHostname = ${matchHostFn};
  const resolveEffectiveSelector = ${resolveSelFn};
  const calculateScrollTarget = ${calcScrollFn};
  const pickTargetIndex = ${pickTargetFn};

  const TABLE = [
    { host: 'arena.lmsys.org', sel: '[data-agent-transcript-message="true"][data-chat-message-id]:has(> [data-user-message-layout="true"])' },
    { host: 'chat.lmsys.org', sel: '[data-agent-transcript-message="true"][data-chat-message-id]:has(> [data-user-message-layout="true"])' },
    { host: 'arena.ai', sel: '[data-agent-transcript-message="true"][data-chat-message-id]:has(> [data-user-message-layout="true"])' },
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
  const FALLBACK = '[class*="user-query"]:not([class*="assistant"]), [class*="user-message"], [class*="UserMessage"], [data-message-author="user"]';
  const EXCLUDE_FALLBACK = /(assistant|answer|reply|response|model)/i;

  const effectiveSel = resolveEffectiveSelector(CUSTOM_SEL, location.hostname, TABLE, FALLBACK);

  function getRoots(container) {
    const scope = (container === document.documentElement || container === document.scrollingElement || container === document.body || !container)
      ? document
      : container;
    let all;
    try {
      all = Array.from(scope.querySelectorAll(effectiveSel));
    } catch (err) {
      return { error: 'invalid-selector', reason: err && err.message ? err.message : String(err) };
    }
    if (!all || all.length === 0) return { roots: [] };

    const set = new Set(all);
    const roots = [];
    const isCustom = Boolean(CUSTOM_SEL && CUSTOM_SEL.trim());

    for (const el of all) {
      // Filter nested matches: if an ancestor is also in set, only keep outer root
      let isNested = false;
      let p = el.parentElement;
      while (p && p !== scope && p !== document.body) {
        if (set.has(p)) { isNested = true; break; }
        p = p.parentElement;
      }
      if (isNested) continue;

      // Exclude assistant classes ONLY if using generic fallback selector
      if (!isCustom) {
        const cls = (typeof el.className === 'string' ? el.className : '') + ' ' + (el.dataset && el.dataset.testId ? el.dataset.testId : '');
        if (EXCLUDE_FALLBACK.test(cls)) continue;
      }

      // Layout box validation
      const rects = el.getClientRects();
      if (rects.length === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;

      roots.push(el);
    }
    return { roots };
  }

  function findScrollContainer(firstEl) {
    if (!firstEl) {
      return document.scrollingElement || document.documentElement || document.body;
    }
    let node = firstEl.parentElement;
    let candidate = null;
    while (node && node !== document.body && node !== document.documentElement) {
      try {
        const style = window.getComputedStyle(node);
        const overflowY = style.overflowY;
        if (/^(auto|scroll|overlay)$/.test(overflowY) && node.clientHeight > 0) {
          if (node.scrollHeight > node.clientHeight + 1) {
            return node;
          }
          if (!candidate) candidate = node;
        }
      } catch (e) {}
      node = node.parentElement;
    }
    return candidate || document.scrollingElement || document.documentElement || document.body;
  }

  function isDocumentScroller(c) {
    return c === document.documentElement || c === document.scrollingElement || c === document.body;
  }

  function getScrollTop(c) {
    if (isDocumentScroller(c)) {
      return window.scrollY || document.documentElement.scrollTop || (document.body ? document.body.scrollTop : 0) || 0;
    }
    return c.scrollTop;
  }

  function setScrollTop(c, y) {
    if (isDocumentScroller(c)) {
      window.scrollTo(0, y);
      document.documentElement.scrollTop = y;
      if (document.body) document.body.scrollTop = y;
    } else {
      c.scrollTop = y;
    }
  }

  function getContainerInfo(c) {
    const isDoc = isDocumentScroller(c);
    if (isDoc) {
      const docEl = document.documentElement;
      const body = document.body;
      const scrollHeight = Math.max(docEl.scrollHeight, body ? body.scrollHeight : 0);
      const clientHeight = window.innerHeight || docEl.clientHeight;
      return {
        scrollTop: getScrollTop(c),
        scrollHeight,
        clientHeight,
        clientTop: 0,
        rectTop: 0,
        isDocument: true
      };
    }
    const cr = c.getBoundingClientRect();
    return {
      scrollTop: c.scrollTop,
      scrollHeight: c.scrollHeight,
      clientHeight: c.clientHeight,
      clientTop: c.clientTop || 0,
      rectTop: cr.top,
      isDocument: false
    };
  }

  function glideTo(container, targetY, ms, token) {
    const startY = getScrollTop(container);
    const dist = targetY - startY;
    if (Math.abs(dist) < 1) return Promise.resolve();

    return new Promise(resolve => {
      const t0 = performance.now();
      const easeOut = p => 1 - Math.pow(1 - p, 3);
      let done = false;
      let rafId = null;

      const finish = (snap) => {
        if (done) return;
        done = true;
        clearTimeout(watchdog);
        if (rafId) cancelAnimationFrame(rafId);
        if (snap && window.__nexusNavRunToken === token) {
          setScrollTop(container, targetY);
        }
        resolve();
      };

      const watchdog = setTimeout(() => {
        finish(window.__nexusNavRunToken === token);
      }, ms + 250);

      const step = (now) => {
        if (done) return;
        if (window.__nexusNavRunToken !== token) {
          finish(false);
          return;
        }
        const p = Math.min(1, (now - t0) / ms);
        setScrollTop(container, startY + dist * easeOut(p));
        if (p < 1) {
          rafId = requestAnimationFrame(step);
        } else {
          finish(true);
        }
      };
      rafId = requestAnimationFrame(step);
    });
  }

  function showToast(msg) {
    let t = document.getElementById('__nexusNavToast');
    if (!t) {
      t = document.createElement('div');
      t.id = '__nexusNavToast';
      t.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:rgba(20,20,20,.92);color:#fff;font:12px/1.5 system-ui,sans-serif;padding:8px 16px;border-radius:999px;z-index:2147483647;pointer-events:none;opacity:0;transition:opacity .25s ease;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,.25)';
      (document.body || document.documentElement).appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._t);
    t._t = setTimeout(() => { t.style.opacity = '0'; }, 1600);
  }

  function ensureHighlightStyles() {
    if (document.getElementById('__nexusNavStyles')) return;
    const s = document.createElement('style');
    s.id = '__nexusNavStyles';
    s.textContent = '@keyframes __nexusNavPulse { 0% { box-shadow: 0 0 0 3px rgba(138, 180, 248, 0.9), 0 4px 16px rgba(0, 0, 0, 0.4); border-radius: 12px; } 30% { box-shadow: 0 0 0 4px rgba(138, 180, 248, 0.8), 0 4px 14px rgba(0, 0, 0, 0.3); } 100% { box-shadow: 0 0 0 8px rgba(138, 180, 248, 0), 0 4px 12px rgba(0, 0, 0, 0); } } [data-nexus-nav-highlight="true"] { animation: __nexusNavPulse 1s cubic-bezier(0.2, 0, 0, 1) forwards !important; }';
    (document.head || document.documentElement).appendChild(s);
  }

  function highlight(el) {
    ensureHighlightStyles();
    const prev = document.querySelectorAll('[data-nexus-nav-highlight="true"]');
    for (const p of prev) p.removeAttribute('data-nexus-nav-highlight');
    el.setAttribute('data-nexus-nav-highlight', 'true');
    clearTimeout(el._nexusHighlightTimer);
    el._nexusHighlightTimer = setTimeout(() => {
      el.removeAttribute('data-nexus-nav-highlight');
    }, 1000);
  }

  function getTopInset(container) {
    try {
      const style = window.getComputedStyle(container);
      const pad = parseFloat(style.scrollPaddingTop || style.paddingTop) || 0;
      return Math.max(16, Math.min(pad, 80));
    } catch (e) {
      return 24;
    }
  }

  async function main() {
    const tStart = performance.now();
    const token = (window.__nexusNavRunToken = (window.__nexusNavRunToken || 0) + 1);
    const alive = () => window.__nexusNavRunToken === token;

    const state = (window.__nexusNavState = window.__nexusNavState || {
      container: null,
      selectedId: null,
      selectedEl: null,
      selector: null,
      contextKey: null
    });

    const contextKey = location.pathname + '::' + effectiveSel;
    if (state.contextKey !== contextKey) {
      state.container = null;
      state.selectedId = null;
      state.selectedEl = null;
      state.contextKey = contextKey;
      state.selector = effectiveSel;
    }

    let candidateRes = getRoots(state.container);
    if (candidateRes.error === 'invalid-selector') {
      showToast('Invalid prompt selector: ' + candidateRes.reason);
      return {
        status: 'invalid-selector',
        direction: DIR,
        matchedCount: 0,
        reason: candidateRes.reason
      };
    }

    let roots = candidateRes.roots || [];

    if (!state.container || !state.container.isConnected) {
      state.container = findScrollContainer(roots[0] || null);
    }
    const container = state.container;
    if (!container) {
      return {
        status: 'no-container',
        direction: DIR,
        matchedCount: 0
      };
    }

    if (roots.length === 0) {
      candidateRes = getRoots(container);
      if (candidateRes.error === 'invalid-selector') {
        return {
          status: 'invalid-selector',
          direction: DIR,
          matchedCount: 0,
          reason: candidateRes.reason
        };
      }
      roots = candidateRes.roots || [];
    }

    const initialScroll = getScrollTop(container);
    const cInfo = getContainerInfo(container);

    if (roots.length === 0) {
      showToast('No user prompts found');
      return {
        status: 'no-matches',
        direction: DIR,
        matchedCount: 0,
        containerTag: container.tagName,
        scrollBefore: initialScroll,
        scrollAfter: initialScroll
      };
    }

    let currIdx = -1;
    if (state.selectedEl && state.selectedEl.isConnected && roots.includes(state.selectedEl)) {
      currIdx = roots.indexOf(state.selectedEl);
    } else if (state.selectedId) {
      currIdx = roots.findIndex(el => {
        const id = el.id || el.getAttribute('data-chat-message-id');
        return id && id === state.selectedId;
      });
    }

    const cTop = cInfo.isDocument ? 0 : (cInfo.rectTop + cInfo.clientTop);
    const topInset = getTopInset(container);

    let targetIdx = -1;
    if (currIdx !== -1) {
      targetIdx = pickTargetIndex(roots.length, currIdx, DIR);
    } else {
      const isAtBoundary = initialScroll <= topInset + 10
        ? 'top'
        : (initialScroll >= cInfo.scrollHeight - cInfo.clientHeight - 10 ? 'bottom' : null);
      const rootsGeom = roots.map(el => {
        const r = el.getBoundingClientRect();
        return { top: r.top - cTop, bottom: r.bottom - cTop };
      });
      targetIdx = pickTargetIndex(roots.length, -1, DIR, rootsGeom, topInset, isAtBoundary);
    }

    let targetEl = (targetIdx >= 0 && targetIdx < roots.length) ? roots[targetIdx] : null;

    // Virtualized content search loop (if target not currently mounted)
    if (!targetEl) {
      let iters = 0;
      const maxScroll = Math.max(0, cInfo.scrollHeight - cInfo.clientHeight);
      const stepDist = Math.max(100, Math.floor(cInfo.clientHeight * 0.8));
      const knownIds = new Set(roots.map(el => el.id || el.getAttribute('data-chat-message-id')).filter(Boolean));

      while (!targetEl && iters++ < 30) {
        const currentScroll = getScrollTop(container);
        const desiredNext = currentScroll + (DIR === 'older' ? -1 : 1) * stepDist;
        const next = Math.max(0, Math.min(maxScroll, desiredNext));

        if (next === currentScroll) {
          break;
        }

        await glideTo(container, next, 150, token);
        if (!alive()) return { status: 'cancelled', direction: DIR, matchedCount: roots.length };

        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        const nextRes = getRoots(container);
        if (nextRes.roots && nextRes.roots.length > 0) {
          const newRoots = nextRes.roots.filter(el => {
            const id = el.id || el.getAttribute('data-chat-message-id');
            return id ? !knownIds.has(id) : !roots.includes(el);
          });

          if (newRoots.length > 0) {
            roots = nextRes.roots;
            targetEl = DIR === 'older' ? newRoots[newRoots.length - 1] : newRoots[0];
            break;
          }
        }
      }

      if (!targetEl && iters >= 30) {
        return {
          status: 'search-exhausted',
          direction: DIR,
          matchedCount: roots.length,
          scrollBefore: initialScroll,
          scrollAfter: getScrollTop(container),
          durationMs: Math.round(performance.now() - tStart)
        };
      }
    }

    if (targetEl) {
      // Commit intended target identity synchronously before animation
      state.selectedEl = targetEl;
      state.selectedId = targetEl.id || targetEl.getAttribute('data-chat-message-id') || null;

      const r = targetEl.getBoundingClientRect();
      const currentCInfo = getContainerInfo(container);
      const targetY = calculateScrollTarget(currentCInfo, r, topInset);

      await glideTo(container, targetY, 250, token);
      if (!alive()) return { status: 'cancelled', direction: DIR, matchedCount: roots.length };

      highlight(targetEl);

      const finalScroll = getScrollTop(container);
      return {
        status: 'ok',
        direction: DIR,
        matchedCount: roots.length,
        targetId: state.selectedId || undefined,
        containerTag: container.tagName,
        scrollBefore: initialScroll,
        scrollAfter: finalScroll,
        durationMs: Math.round(performance.now() - tStart)
      };
    }

    showToast(DIR === 'older' ? 'Already at oldest prompt' : 'Already at newest prompt');
    return {
      status: 'boundary',
      direction: DIR,
      matchedCount: roots.length,
      containerTag: container.tagName,
      scrollBefore: initialScroll,
      scrollAfter: getScrollTop(container),
      durationMs: Math.round(performance.now() - tStart)
    };
  }

  return main();
})()`
}
