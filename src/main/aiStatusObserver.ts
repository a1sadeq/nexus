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

      function getAssistantElement() {
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
          const text = el ? (el.innerText || el.textContent || '').trim() : '';
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

      function isStopButton(btn) {
        if (!isElementVisible(btn)) return false;
        // Strictly scope to prompt composer / chat input area to prevent false positives from audio/video buttons
        if (!isInComposer(btn)) return false;

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
            for (let i = 0; i < nodes.length; i++) {
              if (isElementVisible(nodes[i]) && isInComposer(nodes[i])) return true;
            }
          } catch (e) {}
        }

        try {
          const buttons = document.querySelectorAll('button, [role="button"]');
          for (let i = 0; i < buttons.length; i++) {
            if (isStopButton(buttons[i])) return true;
          }
        } catch (e) {}

        return false;
      }

      function isSendButtonVisible() {
        const customSendSelector = getCfg().sendSelector;
        if (customSendSelector) {
          try {
            const nodes = document.querySelectorAll(customSendSelector);
            for (let i = 0; i < nodes.length; i++) {
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
          for (let i = 0; i < nodes.length; i++) {
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
          for (let i = 0; i < nodes.length; i++) {
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
          for (let i = 0; i < streamingNodes.length; i++) {
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
          for (let i = 0; i < spinnerNodes.length; i++) {
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

          // Measure assistant text growth (reset baseline when turn container node changes)
          const assistantEl = getAssistantElement();
          const currentText = assistantEl ? (assistantEl.innerText || assistantEl.textContent || '').trim() : '';
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
        setTimeout(evaluateStatus, 100);
      }

      const observer = new MutationObserver(() => {
        scheduleEvaluate();
      });

      const target = document.documentElement || document.body;
      if (target) {
        observer.observe(target, {
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

      window.__nexusAiStatusEvaluate = evaluateStatus;

      // Safety polling interval
      setInterval(evaluateStatus, 500);
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
