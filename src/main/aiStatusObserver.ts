import { WebContentsView } from 'electron'
import type { AiObserverReport } from '../shared/aiLifecycle'
import {
  DEFAULT_PROVIDER_FEATURES,
  getMergedProviderFeatures,
  type ProviderOverrides
} from '../shared/providerConfig'

function resolveMergedObserverFeatures(
  modelKey: string,
  providerConfigMap?: Record<string, ProviderOverrides>
) {
  const globalOv = providerConfigMap?.['ALL'] || providerConfigMap?.['global'] || {}
  const normalizedKey = (modelKey || '').toLowerCase()
  const aliasKey =
    normalizedKey === 'arena'
      ? 'arena-ai'
      : normalizedKey === 'arena-ai'
        ? 'arena'
        : normalizedKey === 'glm' ||
            normalizedKey === 'z.ai' ||
            normalizedKey === 'zai' ||
            normalizedKey === 'z-ai'
          ? 'z-glm'
          : normalizedKey === 'z-glm'
            ? 'glm'
            : undefined

  const aliasOv = aliasKey ? providerConfigMap?.[aliasKey] : undefined
  const directOv = providerConfigMap?.[modelKey] || providerConfigMap?.[normalizedKey]
  const combinedSpecific: ProviderOverrides | undefined =
    aliasOv || directOv
      ? {
          ...aliasOv,
          ...directOv,
          features: {
            ...(aliasOv?.features || {}),
            ...(directOv?.features || {})
          }
        }
      : undefined

  return getMergedProviderFeatures(modelKey, combinedSpecific, globalOv)
}

/**
 * Generates the in-page client script to observe live generation status via DOM MutationObserver.
 */
export function getAiStatusObserverScript(
  modelKey: string,
  providerConfigMap?: Record<string, ProviderOverrides>,
  viewGeneration?: number
): string {
  const feats = resolveMergedObserverFeatures(modelKey, providerConfigMap)

  const stopSelector =
    feats.stopGenerationSelector ||
    DEFAULT_PROVIDER_FEATURES[modelKey]?.stopGenerationSelector ||
    DEFAULT_PROVIDER_FEATURES['global']?.stopGenerationSelector ||
    'button[aria-label*="stop" i], [role="button"][aria-label*="stop" i], button[aria-label*="停止" i], [role="button"][aria-label*="停止" i], button[data-testid*="stop" i], button[aria-label*="interrupt" i], button:has(svg.lucide-square), button:has(rect), button[class*="stop-button" i], button[class*="btn-stop" i]'

  const sendSelector =
    feats.sendButtonSelector ||
    DEFAULT_PROVIDER_FEATURES[modelKey]?.sendButtonSelector ||
    'button[data-testid="send-button"], button[aria-label*="send" i], button[aria-label*="Send message" i], button[type="submit"]'

  const assistantSelector = feats.assistantMessageSelector || ''
  const streamingSelector = feats.streamingSelector || ''
  const errorSelector = feats.errorSelector || ''
  const completionSelector = feats.completionActionSelector || ''
  const watchdogTimeoutMs =
    typeof feats.statusWatchdogTimeoutMs === 'number' && feats.statusWatchdogTimeoutMs > 0
      ? feats.statusWatchdogTimeoutMs
      : 5000

  return `(() => {
    try {
      window.__nexusAiStatusConfig = {
        stopSelector: ${JSON.stringify(stopSelector)},
        sendSelector: ${JSON.stringify(sendSelector)},
        assistantSelector: ${JSON.stringify(assistantSelector)},
        streamingSelector: ${JSON.stringify(streamingSelector)},
        errorSelector: ${JSON.stringify(errorSelector)},
        completionSelector: ${JSON.stringify(completionSelector)},
        watchdogTimeout: ${JSON.stringify(watchdogTimeoutMs)},
        viewGeneration: ${JSON.stringify(viewGeneration ?? 1)}
      };

      if (window.__nexusArenaBeaconTimer) {
        clearInterval(window.__nexusArenaBeaconTimer);
        window.__nexusArenaBeaconTimer = null;
      }

      if (window.__nexusAiStatusObserverV2Active) {
        if (typeof window.__nexusAiStatusEvaluate === 'function') {
          window.__nexusAiStatusEvaluate();
        }
        return;
      }
      window.__nexusAiStatusObserverActive = true;
      window.__nexusAiStatusObserverV2Active = true;

      let isGenerating = false;
      let lastAssistantEl = null;
      let lastTextLength = 0;
      let lastTextGrowthTime = 0;
      let lastTokenTime = 0; // Compatibility alias
      let doneDebounceTimer = null;
      let heartbeatTimer = null;
      let evaluateScheduled = false;
      // A page-wide button sweep is a "does one exist?" question; it is not an inventory.
      const STOP_SCAN_LIMIT = 60;
      // "Is anything matching this visible?" needs a handful of candidates, not a census.
      const VISIBLE_SCAN_LIMIT = 8;
      // Build 52: how often this script is allowed to do real work. The observer fires on every mutation
      // of the page and a streaming answer mutates the document continuously, so the 100 ms debounce
      // meant ten evaluations a second. Four is already more often than any status change needs, and
      // each evaluation is bounded as well (see looksLikeStopButton).
      const EVALUATE_FLOOR_MS = 250;
      let lastEvaluateAt = 0;
      let initialEmitted = false;
      let lastReportedStatus = null;

      function getCfg() {
        return window.__nexusAiStatusConfig || {};
      }

      function emitStatus(payload) {
        if (payload) {
          payload.viewGeneration = getCfg().viewGeneration;
          console.log('__NEXUS_AI_STATUS__:' + JSON.stringify(payload));
        }
      }

      function hasReliableLiveEvidence() {
        if (isSendButtonVisible() || hasActiveStopButton()) return true;
        const assistantEl = getAssistantElement();
        if (assistantEl && isElementLaidOut(assistantEl)) return true;
        return false;
      }

      function hasReliableDetectionHooks() {
        return hasReliableLiveEvidence();
      }

      function getErrorSnippet() {
        const customErrorSelector = getCfg().errorSelector;
        if (!customErrorSelector) return '';
        try {
          const nodes = document.querySelectorAll(customErrorSelector);
          for (let i = 0; i < nodes.length; i++) {
            if (isElementVisible(nodes[i])) {
              return (nodes[i].innerText || nodes[i].textContent || '').trim().slice(0, 300);
            }
          }
        } catch (e) {}
        return '';
      }

      // Build 52: resolve the assistant element once, not on every evaluation.
      //
      // Finding it walks up to fifteen selector lists over the whole document, and this runs several
      // times a second on a page that is mutating thousands of times a second. The element only needs
      // re-resolving when it has left the document (a new turn) or after half a second, which keeps a
      // new turn's message found immediately while removing the walk from almost every evaluation.
      let cachedAssistantEl = null;
      let cachedAssistantAt = 0;
      function getAssistantElement() {
        try {
          const now = Date.now();
          if (cachedAssistantEl && cachedAssistantEl.isConnected && now - cachedAssistantAt < 500) {
            return cachedAssistantEl;
          }
          const found = resolveAssistantElement();
          cachedAssistantEl = found;
          cachedAssistantAt = now;
          return found;
        } catch (e) {}
        return null;
      }

      function resolveAssistantElement() {
        try {
          const customAssistantSelector = getCfg().assistantSelector;
          if (customAssistantSelector) {
            const customNodes = document.querySelectorAll(customAssistantSelector);
            if (customNodes && customNodes.length > 0) {
              return customNodes[customNodes.length - 1];
            }
          }
          const selectors = [
            '[data-message-author-role="assistant"]',
            '[data-testid="assistant-message"]',
            '[data-assistant-message-layout="true"]',
            'model-response',
            'article[class*="message" i]',
            '.segment-assistant',
            '.qwen-chat-message-assistant',
            'div[class*="ds-message" i]',
            '.bot.message',
            'div.message.bot',
            'div[class*="message" i][class*="bot" i]',
            '.markdown-body',
            'div[class*="prose" i]',
            '[class*="assistant" i]'
          ];
          for (const sel of selectors) {
            const nodes = document.querySelectorAll(sel);
            if (nodes && nodes.length > 0) {
              return nodes[nodes.length - 1];
            }
          }
        } catch {}
        return null;
      }

      function getAssistantSnippet() {
        try {
          const hasInteractiveChoice = Boolean(
            document.querySelector('[role="radiogroup"] [role="radio"]:not([disabled])')
          );
          const el = getAssistantElement();
          const text = el ? (el.textContent || '').trim() : '';
          if (hasInteractiveChoice) {
            const base = text ? text.slice(-260) : 'Waiting for your input';
            return /[?？؟]\\s*$/.test(base) ? base : base + ' — Please choose an option?';
          }
          if (text) return text.slice(-300);
        } catch {}
        return '';
      }

      function isElementLaidOut(el) {
        if (!el) return false;
        if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
        try {
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          if (window.getComputedStyle) {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
              return false;
            }
          }
          return true;
        } catch (e) {}
        return false;
      }

      function isElementVisible(el) {
        if (!el) return false;
        if (el.disabled || (el.getAttribute && el.getAttribute('aria-disabled') === 'true')) return false;
        return isElementLaidOut(el);
      }

      function isInComposer(el) {
        if (!el || !el.closest) return false;
        return Boolean(
          el.closest(
            'form, [data-perf-target="composer"], [data-testid*="composer" i], [data-testid*="prompt" i], [data-testid*="chat-input" i], [class*="composer" i], [class*="prompt" i], [class*="input" i], [class*="chat-input" i], [class*="chat-bar" i], footer'
          )
        );
      }

      /**
       * Build 52: the cheap half of the stop-button test, and the reason this file is no longer a CPU
       * problem.
       *
       * isStopButton used to begin with isElementVisible, which reads a bounding rect and the computed
       * style — a forced layout — and it was called for every button and [role=button] in the document,
       * several times a second, driven by a mutation observer that fires on every streamed token. On an
       * app the size of arena.ai that is hundreds of layout flushes per evaluation.
       *
       * These tests read attributes and text only: no layout, no style resolution. A button that fails
       * them cannot be a stop button, so it is dropped before anything expensive is asked about it.
       */
      function looksLikeStopButton(btn) {
        try {
          const get = (name) => (btn.getAttribute ? String(btn.getAttribute(name) || '') : '');
          const label = get('aria-label').toLowerCase();
          const title = get('title').toLowerCase();
          const testId = get('data-testid').toLowerCase();
          const className = (typeof btn.className === 'string' ? btn.className : '').toLowerCase();
          const text = String(btn.textContent || '').trim().toLowerCase();
          if (label.indexOf('stop') >= 0 || label.indexOf('interrupt') >= 0 || label.indexOf('停止') >= 0 || label.indexOf('cancel generation') >= 0) return true;
          if (title.indexOf('stop') >= 0 || title.indexOf('停止') >= 0 || title.indexOf('interrupt') >= 0) return true;
          if (testId.indexOf('stop') >= 0 || testId.indexOf('interrupt') >= 0) return true;
          if (className.indexOf('stop-button') >= 0 || className.indexOf('btn-stop') >= 0 || className.indexOf('stop_button') >= 0 || className.indexOf('stop-btn') >= 0) return true;
          if (text === 'stop' || text === 'stop generating' || text === '停止' || text === '停止生成' || text === 'interrupt' || text === 'pause') return true;
          // Providers that draw the control as a filled square with no words at all.
          if (btn.querySelector && btn.querySelector('svg.lucide-square, [class*="square" i]')) return true;
          return false;
        } catch (e) {
          return false;
        }
      }

      function isStopButton(btn) {
        if (!looksLikeStopButton(btn)) return false;
        // Strictly scope to prompt composer / chat input area to prevent false positives from audio/video
        // buttons. closest() walks the tree and reads no geometry, so it is still the cheap test — it now
        // runs before the layout read instead of after it.
        if (!isInComposer(btn)) return false;
        if (!isElementVisible(btn)) return false;

        try {
          const label = (btn.getAttribute('aria-label') || '').toLowerCase();
          const title = (btn.getAttribute('title') || '').toLowerCase();
          const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
          const className = (typeof btn.className === 'string' ? btn.className : '').toLowerCase();
          const text = (btn.textContent || '').trim().toLowerCase();

          // Stop keywords in label, title, testid, class
          if (
            label.includes('stop') ||
            label.includes('stop generating') ||
            label.includes('stop response') ||
            label.includes('stop streaming') ||
            label.includes('停止') ||
            label.includes('interrupt') ||
            label.includes('cancel generation')
          ) return true;

          if (title.includes('stop') || title.includes('停止') || title.includes('interrupt')) return true;
          if (testId.includes('stop') || testId.includes('interrupt')) return true;
          if (className.includes('stop-button') || className.includes('btn-stop') || className.includes('stop_button') || className.includes('stop-btn')) return true;

          // Text content checks for Gradio, Arena.ai, Svelte, z.ai buttons
          if (
            text === 'stop' ||
            text === 'stop generating' ||
            text === '停止' ||
            text === '停止生成' ||
            text === 'interrupt' ||
            text === 'pause'
          ) {
            return true;
          }

          // Inner rect/square detection inside composer
          if (btn.querySelector('svg.lucide-square, [class*="square" i]')) return true;
          const svg = btn.querySelector('svg');
          if (svg && svg.querySelector('rect') && !svg.querySelector('path:not([fill="none"])')) return true;
        } catch (e) {}
        return false;
      }

      function hasActiveStopButton() {
        const customStopSelector = getCfg().stopSelector;
        if (customStopSelector) {
          try {
            const nodes = document.querySelectorAll(customStopSelector);
            const stopLimit = Math.min(nodes.length, VISIBLE_SCAN_LIMIT);
            for (let i = 0; i < stopLimit; i++) {
              if (isElementVisible(nodes[i]) && isInComposer(nodes[i])) return true;
            }
          } catch (e) {}
        }

        try {
          // Only a composer can hold a stop button, and a composer is a small subtree: searching it
          // costs a fraction of walking every button in the document. The page-wide sweep stays as the
          // fallback for providers that render the control outside the composer, and it is capped.
          const scopes = document.querySelectorAll(
            'form, [data-perf-target="composer"], [class*="composer" i], [class*="chat-input" i], [class*="chat-bar" i], footer'
          );
          let checked = 0;
          for (let s = 0; s < scopes.length && checked < STOP_SCAN_LIMIT; s++) {
            const buttons = scopes[s].querySelectorAll('button, [role="button"]');
            for (let i = 0; i < buttons.length && checked < STOP_SCAN_LIMIT; i++) {
              checked++;
              if (isStopButton(buttons[i])) return true;
            }
          }
          const all = document.querySelectorAll('button, [role="button"]');
          const limit = Math.min(all.length, STOP_SCAN_LIMIT);
          for (let i = 0; i < limit; i++) {
            if (isStopButton(all[i])) return true;
          }
        } catch (e) {}

        return false;
      }

      function isSendButtonVisible() {
        const customSendSelector = getCfg().sendSelector;
        if (customSendSelector) {
          try {
            const nodes = document.querySelectorAll(customSendSelector);
            const sendLimit = Math.min(nodes.length, VISIBLE_SCAN_LIMIT);
            for (let i = 0; i < sendLimit; i++) {
              const node = nodes[i];
              // Allow disabled Send buttons when composer is empty after completion,
              // as long as the button is visibly laid out inside the composer and is not a Stop button.
              if (isElementLaidOut(node) && isInComposer(node) && !isStopButton(node)) return true;
            }
          } catch (e) {}
        }
        return false;
      }

      function isErrorVisible() {
        const customErrorSelector = getCfg().errorSelector;
        if (!customErrorSelector) return false;
        try {
          const nodes = document.querySelectorAll(customErrorSelector);
          const errorLimit = Math.min(nodes.length, VISIBLE_SCAN_LIMIT);
          for (let i = 0; i < errorLimit; i++) {
            if (isElementVisible(nodes[i])) return true;
          }
        } catch (e) {}
        return false;
      }

      function isCompletionActionVisible() {
        const customCompletionSelector = getCfg().completionSelector;
        if (!customCompletionSelector) return false;
        try {
          const nodes = document.querySelectorAll(customCompletionSelector);
          const completionLimit = Math.min(nodes.length, VISIBLE_SCAN_LIMIT);
          for (let i = 0; i < completionLimit; i++) {
            if (isElementVisible(nodes[i])) return true;
          }
        } catch (e) {}
        return false;
      }

      function checkGenerationActive() {
        // 0. If error is displayed, generation aborted/failed
        if (isErrorVisible()) return false;

        // 1 & 2. Active Stop button inside composer
        if (hasActiveStopButton()) return true;

        // 3. Streaming containers and cursor indicators (ChatGPT, Claude, Gemini, DeepSeek, z.ai, Arena)
        const customStreamingSelector = getCfg().streamingSelector;
        if (customStreamingSelector) {
          try {
            const nodes = document.querySelectorAll(customStreamingSelector);
            for (let i = 0; i < nodes.length; i++) {
              if (isElementVisible(nodes[i])) return true;
            }
          } catch (e) {}
        }

        const streamingSelectors = [
          '.result-streaming', '[data-is-streaming="true"]', 'model-response.is-streaming',
          '.cursor-blink', '[class*="cursor-blink" i]', '[class*="streaming-cursor" i]',
          '[class*="ds-thinking" i]', 'span[class*="typing" i]',
          'div[class*="ds-message"].streaming'
        ];
        try {
          const streamingNodes = document.querySelectorAll(streamingSelectors.join(', '));
          const streamingLimit = Math.min(streamingNodes.length, VISIBLE_SCAN_LIMIT);
          for (let i = 0; i < streamingLimit; i++) {
            if (isElementVisible(streamingNodes[i])) return true;
          }
        } catch (e) {}

        // 4. Loading spinners inside chat or composer (crucial for Arena.ai & Gradio interfaces)
        const spinnerSelectors = [
          'model-response svg.animate-spin', 'article svg.animate-spin',
          '.bot.message svg.animate-spin', '[data-message-author-role="assistant"] svg.animate-spin',
          'form svg.animate-spin', '[class*="composer" i] svg.animate-spin',
          '[class*="generating-indicator" i]'
        ];
        try {
          const spinnerNodes = document.querySelectorAll(spinnerSelectors.join(', '));
          const spinnerLimit = Math.min(spinnerNodes.length, VISIBLE_SCAN_LIMIT);
          for (let i = 0; i < spinnerLimit; i++) {
            if (isElementVisible(spinnerNodes[i])) return true;
          }
        } catch (e) {}

        // 5. Completion Action check:
        // If completion action (e.g. Copy / Regenerate) is already present and Send is back, generation is done!
        if (isCompletionActionVisible() && isSendButtonVisible()) {
          return false;
        }

        // 6. Assistant text growth heartbeat: if text grew in the last 1500ms
        const now = Date.now();
        if (isGenerating && lastTextGrowthTime > 0 && now - lastTextGrowthTime < 1500) {
          lastTokenTime = lastTextGrowthTime;
          return true;
        }

        return false;
      }

      function evaluateStatus() {
        evaluateScheduled = false;
        try {
          const now = Date.now();
          if (now - lastEvaluateAt < EVALUATE_FLOOR_MS - 10) {
            // Asked again inside the floor (the safety interval or a second caller): come back later.
            scheduleEvaluate();
            return;
          }
          lastEvaluateAt = now;

          // Measure assistant text growth (reset baseline when turn container node changes)
          const assistantEl = getAssistantElement();
          const currentText = assistantEl ? (assistantEl.textContent || '').trim() : '';
          const currentLength = currentText.length;
          if (assistantEl !== lastAssistantEl) {
            lastAssistantEl = assistantEl;
            lastTextLength = currentLength;
            if (currentLength > 0 && hasActiveStopButton()) {
              lastTextGrowthTime = now;
            }
          } else if (currentLength > lastTextLength) {
            lastTextGrowthTime = now;
            lastTextLength = currentLength;
          }

          const active = checkGenerationActive();

          if (!initialEmitted) {
            let initialStatus = 'unknown';
            let initialSnippet = '';
            let initialError = undefined;

            if (isErrorVisible()) {
              initialStatus = 'error';
              initialError = getErrorSnippet();
              initialSnippet = initialError;
            } else if (active) {
              initialStatus = 'working';
              isGenerating = true;
            } else {
              const hasInteractiveChoice = Boolean(
                document.querySelector('[role="radiogroup"] [role="radio"]:not([disabled])')
              );
              const snippet = getAssistantSnippet();
              const isAwaiting = hasInteractiveChoice || (Boolean(snippet) && /[?？؟]\s*$/.test(snippet));
              if (isAwaiting) {
                initialStatus = 'waiting-input';
                initialSnippet = snippet;
              } else if (hasReliableLiveEvidence()) {
                initialStatus = 'idle';
              } else {
                initialStatus = 'unknown';
              }
            }

            initialEmitted = true;
            lastReportedStatus = initialStatus;
            emitStatus({
              isGenerating: initialStatus === 'working',
              lastSnippet: initialSnippet,
              status: initialStatus,
              error: initialError,
              initial: true,
              hasReliableHooks: initialStatus !== 'unknown'
            });
          }

          if (active) {
            // Cancel pending completion debounce
            if (doneDebounceTimer) {
              clearTimeout(doneDebounceTimer);
              doneDebounceTimer = null;
            }
            if (!isGenerating) {
              isGenerating = true;
              lastTextGrowthTime = now;
              lastTextLength = currentLength;
              lastReportedStatus = 'working';
              emitStatus({ isGenerating: true, lastSnippet: '', status: 'working' });
            } else {
              if (!hasActiveStopButton()) {
                if (heartbeatTimer) clearTimeout(heartbeatTimer);
                const timeRemaining = Math.max(100, 1550 - (now - lastTextGrowthTime));
                heartbeatTimer = setTimeout(scheduleEvaluate, timeRemaining);
              }
              // Fail-safe watchdog: only recover if no active composer Stop button remains,
              // text growth stalled > watchdogTimeout, and Send or Completion is back.
              const watchdogLimit = getCfg().watchdogTimeout || 5000;
              const isStalled = lastTextGrowthTime > 0 && now - lastTextGrowthTime > watchdogLimit;
              if (isStalled && !hasActiveStopButton()) {
                const hasSend = isSendButtonVisible();
                const hasCompletion = isCompletionActionVisible();
                if (hasSend || hasCompletion || !assistantEl) {
                  isGenerating = false;
                  const lastSnippet = getAssistantSnippet();
                  const hasInteractiveChoice = Boolean(
                    document.querySelector('[role="radiogroup"] [role="radio"]:not([disabled])')
                  );
                  const isAwaiting = hasInteractiveChoice || /[?？؟]\s*$/.test(lastSnippet);
                  const status = isAwaiting ? 'waiting-input' : 'done';
                  lastReportedStatus = status;
                  emitStatus({ isGenerating: false, lastSnippet, status });
                  return;
                }
              }
            }
          } else {
            if (heartbeatTimer) {
              clearTimeout(heartbeatTimer);
              heartbeatTimer = null;
            }
            // Fast-track 250ms debounce when explicit completion action bar is mounted; 1000ms fallback otherwise
            if (isGenerating && !doneDebounceTimer) {
              const debounceMs = isCompletionActionVisible() ? 250 : 1000;
              doneDebounceTimer = setTimeout(() => {
                doneDebounceTimer = null;
                if (!checkGenerationActive()) {
                  isGenerating = false;
                  lastTextLength = 0;
                  lastTextGrowthTime = 0;
                  const lastSnippet = getAssistantSnippet();
                  if (isErrorVisible()) {
                    const err = getErrorSnippet();
                    lastReportedStatus = 'error';
                    emitStatus({ isGenerating: false, lastSnippet: err, status: 'error', error: err });
                  } else {
                    const hasInteractiveChoice = Boolean(
                      document.querySelector('[role="radiogroup"] [role="radio"]:not([disabled])')
                    );
                    const isAwaiting = hasInteractiveChoice || /[?？؟]\s*$/.test(lastSnippet);
                    const status = isAwaiting ? 'waiting-input' : 'done';
                    lastReportedStatus = status;
                    emitStatus({ isGenerating: false, lastSnippet, status });
                  }
                }
              }, debounceMs);
            } else if (!isGenerating && !doneDebounceTimer) {
              // Post initial-load re-evaluation of pending input, errors, and reliable hooks
              if (isErrorVisible()) {
                if (lastReportedStatus !== 'error') {
                  const err = getErrorSnippet();
                  lastReportedStatus = 'error';
                  emitStatus({ isGenerating: false, lastSnippet: err, status: 'error', error: err });
                }
              } else {
                const hasInteractiveChoice = Boolean(
                  document.querySelector('[role="radiogroup"] [role="radio"]:not([disabled])')
                );
                const snippet = getAssistantSnippet();
                const isAwaiting = hasInteractiveChoice || (Boolean(snippet) && /[?？؟]\s*$/.test(snippet));

                if (isAwaiting) {
                  if (lastReportedStatus !== 'waiting-input') {
                    lastReportedStatus = 'waiting-input';
                    emitStatus({ isGenerating: false, lastSnippet: snippet, status: 'waiting-input' });
                  }
                } else if (lastReportedStatus === 'waiting-input') {
                  if (hasReliableLiveEvidence()) {
                    lastReportedStatus = 'idle';
                    emitStatus({ isGenerating: false, lastSnippet: snippet, status: 'idle' });
                  } else {
                    lastReportedStatus = 'unknown';
                    emitStatus({ isGenerating: false, lastSnippet: '', status: 'unknown' });
                  }
                } else if (lastReportedStatus === 'error') {
                  if (hasReliableLiveEvidence()) {
                    lastReportedStatus = 'idle';
                    emitStatus({ isGenerating: false, lastSnippet: snippet, status: 'idle' });
                  } else {
                    lastReportedStatus = 'unknown';
                    emitStatus({ isGenerating: false, lastSnippet: '', status: 'unknown' });
                  }
                } else if (lastReportedStatus === 'unknown') {
                  if (hasReliableLiveEvidence()) {
                    lastReportedStatus = 'idle';
                    emitStatus({ isGenerating: false, lastSnippet: snippet, status: 'idle', hasReliableHooks: true });
                  }
                } else if (lastReportedStatus === 'idle') {
                  if (!hasReliableLiveEvidence()) {
                    lastReportedStatus = 'unknown';
                    emitStatus({ isGenerating: false, lastSnippet: '', status: 'unknown', hasReliableHooks: false });
                  }
                }
              }
            }
          }
        } catch (e) {}
      }

      function scheduleEvaluate() {
        if (evaluateScheduled) return;
        evaluateScheduled = true;
        // Not dropped, spaced: the evaluation still happens, just not ten times a second.
        const since = Date.now() - lastEvaluateAt;
        setTimeout(evaluateStatus, since >= EVALUATE_FLOOR_MS ? 60 : EVALUATE_FLOOR_MS - since);
      }

      const observer = new MutationObserver(() => {
        scheduleEvaluate();
      });

      // A tab nobody is looking at has nothing to report: its observer is disconnected and its safety
      // interval does nothing until it is visible again. Background tabs used to keep a full mutation
      // observer and a 500 ms poll alive — presentation work for nobody, on a page that is already
      // being asked for a frame a second by the frame budget.
      function syncObservation() {
        try {
          if (document.visibilityState === 'hidden') {
            observer.disconnect();
            return;
          }
          const scope = document.documentElement || document.body;
          if (scope) {
            observer.observe(scope, {
              childList: true,
              subtree: true,
              characterData: true,
              attributes: true,
              attributeFilter: [
                'style',
                'class',
                'disabled',
                'aria-disabled',
                'aria-label',
                'aria-hidden',
                'data-testid',
                'data-active',
                'data-is-streaming',
                'data-state'
              ]
            });
          }
          scheduleEvaluate();
        } catch (e) {}
      }
      document.addEventListener('visibilitychange', syncObservation);
      syncObservation();

      window.__nexusAiStatusEvaluate = evaluateStatus;

      // Safety poll, not a heartbeat: the observer does the work, and this exists only so that a page
      // which changes status without mutating (a provider that swaps a class on an existing node) is
      // still noticed. 1.5 s is enough for that, and it costs nothing while hidden.
      setInterval(() => {
        if (document.visibilityState === 'hidden') return;
        evaluateStatus();
      }, 500);
      evaluateStatus();
    } catch (e) {}
  })()`
}

/**
 * Lightweight main-process check matching renderer's hasQuestionOrChoice(lastSnippet)
 * so TabDiscardManager keeps background waiting-input tabs immune from eviction.
 */
export function isSnippetAwaitingInput(text?: string | null): boolean {
  if (!text || typeof text !== 'string') return false
  const trimmed = text.trim()
  if (!trimmed) return false
  const cleanedEnd = trimmed.replace(/[\s*_"`')\]}]+$/g, '')
  if (/[?？؟]/.test(cleanedEnd.slice(-15))) return true
  const tail = trimmed.toLowerCase().slice(-200)
  const phrases = [
    'which one',
    'which option',
    'would you like',
    'do you want me to',
    'should i proceed',
    'let me know',
    'please confirm',
    'please choose',
    'select an option',
    'what do you think',
    'how would you like',
    'choice 1',
    'option 1',
    'option a',
    'yes or no',
    'yes/no'
  ]
  if (phrases.some((p) => tail.includes(p))) return true
  return /(?:^|\n)\s*1[.)]\s+.+[\r\n]+\s*2[.)]\s+/i.test(tail)
}

/**
 * Attaches the console-message listener to intercept live AI status updates from the webview.
 * Supports both Electron's modern Event<WebContentsConsoleMessageEventParams> (`event.message`)
 * and legacy positional `(event, level, message)` signatures.
 */
export function attachAiStatusListener(
  webContents: Electron.WebContents,
  tabId: string,
  onStatus: (
    tabId: string,
    isGenerating: boolean,
    lastSnippet: string,
    report?: AiObserverReport
  ) => void,
  getViewGeneration?: () => number
): () => void {
  const handler = (
    event: Electron.Event & { message?: string },
    _level?: number,
    legacyMessage?: string
  ) => {
    const message = typeof event?.message === 'string' ? event.message : legacyMessage
    if (typeof message === 'string' && message.startsWith('__NEXUS_AI_STATUS__:')) {
      try {
        const payload = JSON.parse(message.slice('__NEXUS_AI_STATUS__:'.length))
        if (getViewGeneration) {
          const currentGen = getViewGeneration()
          if (payload.viewGeneration !== undefined && payload.viewGeneration !== currentGen) {
            // Stale observer update from an older view/navigation generation; discard
            return
          }
        }
        const isGenerating = Boolean(payload.isGenerating)
        const lastSnippet = String(payload.lastSnippet || '')
        const report: AiObserverReport = {
          isGenerating,
          lastSnippet,
          status: payload.status,
          error: payload.error,
          hasReliableHooks: payload.hasReliableHooks,
          initial: payload.initial,
          viewGeneration: payload.viewGeneration
        }
        if (
          payload.status !== undefined ||
          payload.initial !== undefined ||
          payload.error !== undefined ||
          payload.hasReliableHooks !== undefined ||
          payload.viewGeneration !== undefined
        ) {
          onStatus(tabId, isGenerating, lastSnippet, report)
        } else {
          onStatus(tabId, isGenerating, lastSnippet)
        }
      } catch (err) {
        console.warn('[aiStatusObserver] Failed to parse status payload:', err)
      }
    }
  }

  webContents.on('console-message', handler as any)
  return () => {
    webContents.removeListener('console-message', handler as any)
  }
}

/**
 * Injects or hot-updates the observer script in the view's webContents.
 */
export function injectAiStatusObserver(
  view: WebContentsView,
  modelKey: string,
  providerConfigMap?: Record<string, ProviderOverrides>,
  viewGeneration?: number
): void {
  if (!view || !view.webContents || view.webContents.isDestroyed()) return
  const script = getAiStatusObserverScript(modelKey, providerConfigMap, viewGeneration)
  view.webContents.executeJavaScript(script).catch(() => {
    // Ignore execution errors on unloaded pages
  })
}
