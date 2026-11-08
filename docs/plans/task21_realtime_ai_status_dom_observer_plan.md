# Task 21: Real-Time AI Status DOM Observer

## 1. Context & Objective
Currently, `webContents.on('did-start-loading')` only fires on initial page navigation and fails completely to track asynchronous in-page AI streams (SSE / WebSocket / AJAX) in ChatGPT, Claude, Gemini, DeepSeek, Perplexity, Kimi, and Qwen.
As chosen in A1, we will inject a lightweight DOM `MutationObserver` script in each webview that directly watches the provider's `stopGenerationSelector` (which is already configured per provider in `providerConfig.ts`).

## 2. In-Webview Observer Engine
Create a reusable injection script `src/main/aiStatusObserver.ts`:
```js
(function() {
  if (window.__nexusAiStatusObserverActive) return;
  window.__nexusAiStatusObserverActive = true;

  const stopSelector = /* Injected provider stopGenerationSelector */;
  let isGenerating = false;

  function checkStatus() {
    const stopBtn = document.querySelector(stopSelector);
    const visible = stopBtn && stopBtn.offsetParent !== null && !stopBtn.disabled;
    const nowGenerating = Boolean(visible);

    if (nowGenerating !== isGenerating) {
      isGenerating = nowGenerating;
      // Send IPC to main process
      window.ipcRenderer?.send('ai-webview-status', {
        isGenerating,
        timestamp: Date.now()
      });
    }
  }

  const observer = new MutationObserver(() => {
    checkStatus();
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled', 'style', 'class', 'aria-label']
  });

  setInterval(checkStatus, 600); // Polling safety net
})();
```

## 3. Main Process IPC Relay
In `src/main/index.ts`:
- When webview receives `ai-webview-status`, it relays `ai-live-status(tabId, status, lastResponseSnippet)` to the renderer.
- On `dom-ready` and `did-navigate-in-page`, the observer script is injected using `view.webContents.executeJavaScript(getObserverScript(modelKey))`.

## 4. Verification Plan
- Unit tests for script generation and selector validation.
- Mock test verifying `ai-webview-status` correctly triggers IPC relay.
