import { WebContentsView } from 'electron'
import {
  DEFAULT_PROVIDER_FEATURES,
  getMergedProviderFeatures,
  type ProviderOverrides
} from '../shared/providerConfig'

/**
 * Generates the in-page client script to observe live generation status via DOM MutationObserver.
 */
export function getAiStatusObserverScript(
  modelKey: string,
  providerConfigMap?: Record<string, ProviderOverrides>
): string {
  const globalOv = providerConfigMap?.['ALL'] || providerConfigMap?.['global'] || {}
  const specific = providerConfigMap?.[modelKey]
  const feats = getMergedProviderFeatures(modelKey, specific, globalOv)

  const stopSelector =
    feats.stopGenerationSelector ||
    DEFAULT_PROVIDER_FEATURES[modelKey]?.stopGenerationSelector ||
    DEFAULT_PROVIDER_FEATURES['global']?.stopGenerationSelector ||
    'button[aria-label*="stop" i], [role="button"][aria-label*="stop" i], button[aria-label*="停止" i], [role="button"][aria-label*="停止" i], button[data-testid*="stop" i], button[aria-label*="interrupt" i], button:has(svg.lucide-square), button:has(rect), button[class*="stop" i]'

  return `(() => {
    try {
      if (window.__nexusAiStatusObserverActive) return;
      window.__nexusAiStatusObserverActive = true;

      const customStopSelector = ${JSON.stringify(stopSelector)};
      let isGenerating = false;
      let lastTokenTime = 0;
      let doneDebounceTimer = null;
      let evaluateScheduled = false;

      function getAssistantSnippet() {
        try {
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
              const last = nodes[nodes.length - 1];
              const text = (last.innerText || last.textContent || '').trim();
              if (text) return text.slice(-300);
            }
          }
        } catch {}
        return '';
      }

      function isElementVisible(el) {
        if (!el) return false;
        if (el.disabled) return false;
        if (el.getAttribute('aria-hidden') === 'true') return false;
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

      function isStopButton(btn) {
        if (!isElementVisible(btn)) return false;
        if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return false;
        try {
          const label = (btn.getAttribute('aria-label') || '').toLowerCase();
          const title = (btn.getAttribute('title') || '').toLowerCase();
          const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
          const className = (typeof btn.className === 'string' ? btn.className : '').toLowerCase();
          const text = (btn.textContent || '').trim().toLowerCase();

          // Stop keywords in label, title, testid, class
          if (label.includes('stop') || label.includes('停止') || label.includes('interrupt') || label.includes('cancel generation')) return true;
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

          // Inner rect/square detection ONLY if inside composer / form / chat-input area
          const inComposer = Boolean(btn.closest('form, [class*="composer" i], [class*="prompt" i], [class*="input" i], footer, [class*="chat-bar" i]'));
          if (inComposer) {
            if (btn.querySelector('svg.lucide-square, [class*="square" i]')) return true;
            const svg = btn.querySelector('svg');
            if (svg && svg.querySelector('rect') && !svg.querySelector('path:not([fill="none"])')) return true;
          }
        } catch (e) {}
        return false;
      }

      function checkGenerationActive() {
        // 1. Check custom configured stop selector
        if (customStopSelector) {
          try {
            const nodes = document.querySelectorAll(customStopSelector);
            for (let i = 0; i < nodes.length; i++) {
              if (isElementVisible(nodes[i])) return true;
            }
          } catch (e) {}
        }

        // 2. Button inspection (Aria, TestID, text "Stop", "停止", in-composer square icons)
        try {
          const buttons = document.querySelectorAll('button, [role="button"]');
          for (let i = 0; i < buttons.length; i++) {
            if (isStopButton(buttons[i])) return true;
          }
        } catch (e) {}

        // 3. Streaming containers and cursor indicators (ChatGPT, Claude, Gemini, DeepSeek, z.ai, Arena)
        const streamingSelectors = [
          '.result-streaming', '[data-is-streaming="true"]', 'model-response.is-streaming',
          '.cursor-blink', '[class*="cursor-blink" i]', '[class*="streaming-cursor" i]',
          '[class*="ds-thinking" i]', 'span[class*="typing" i]'
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

        // 5. Active token streaming (only prolongs an active or assistant-anchored stream within 1500ms)
        if (isGenerating && lastTokenTime > 0 && Date.now() - lastTokenTime < 1500) {
          return true;
        }

        return false;
      }

      function evaluateStatus() {
        evaluateScheduled = false;
        try {
          const active = checkGenerationActive();
          if (active) {
            // Cancel pending completion debounce
            if (doneDebounceTimer) {
              clearTimeout(doneDebounceTimer);
              doneDebounceTimer = null;
            }
            if (!isGenerating) {
              isGenerating = true;
              console.log('__NEXUS_AI_STATUS__:' + JSON.stringify({ isGenerating: true, lastSnippet: '' }));
            }
          } else {
            // If active was true and now false, debounce 1000ms to prevent flapping
            if (isGenerating && !doneDebounceTimer) {
              doneDebounceTimer = setTimeout(() => {
                doneDebounceTimer = null;
                // Double check active state after debounce
                if (!checkGenerationActive()) {
                  isGenerating = false;
                  const lastSnippet = getAssistantSnippet();
                  console.log('__NEXUS_AI_STATUS__:' + JSON.stringify({ isGenerating: false, lastSnippet }));
                }
              }, 1000);
            }
          }
        } catch (e) {}
      }

      function scheduleEvaluate() {
        if (evaluateScheduled) return;
        evaluateScheduled = true;
        setTimeout(evaluateStatus, 120);
      }

      const observer = new MutationObserver((mutations) => {
        for (let i = 0; i < mutations.length; i++) {
          const m = mutations[i];
          if (m.type === 'characterData' || (m.type === 'childList' && m.addedNodes.length > 0)) {
            const target = m.target;
            const el = target.nodeType === 1 ? target : target.parentElement;
            if (el && !el.closest('textarea, input, [contenteditable="true"], header, nav, [class*="sidebar" i]')) {
              // Update lastTokenTime
              lastTokenTime = Date.now();
            }
          }
        }
        scheduleEvaluate();
      });

      const target = document.body || document.documentElement;
      if (target) {
        observer.observe(target, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['style', 'class', 'disabled', 'aria-label', 'aria-hidden']
        });
      }

      // Safety polling interval
      setInterval(evaluateStatus, 600);
      evaluateStatus();
    } catch (e) {}
  })()`
}

/**
 * Attaches the console-message listener to intercept live AI status updates from the webview.
 */
export function attachAiStatusListener(
  webContents: Electron.WebContents,
  tabId: string,
  onStatus: (tabId: string, isGenerating: boolean, lastSnippet: string) => void
): () => void {
  const handler = (_event: Electron.Event, _level: number, message: string) => {
    if (typeof message === 'string' && message.startsWith('__NEXUS_AI_STATUS__:')) {
      try {
        const payload = JSON.parse(message.slice('__NEXUS_AI_STATUS__:'.length))
        onStatus(tabId, Boolean(payload.isGenerating), String(payload.lastSnippet || ''))
      } catch (err) {
        console.warn('[aiStatusObserver] Failed to parse status payload:', err)
      }
    }
  }

  webContents.on('console-message', handler)
  return () => {
    webContents.removeListener('console-message', handler)
  }
}

/**
 * Injects the observer script into the view's webContents.
 */
export function injectAiStatusObserver(view: WebContentsView, modelKey: string): void {
  if (!view || !view.webContents || view.webContents.isDestroyed()) return
  const script = getAiStatusObserverScript(modelKey)
  view.webContents.executeJavaScript(script).catch(() => {
    // Ignore execution errors on unloaded pages
  })
}
