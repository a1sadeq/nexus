# Plan: Export Session Context & Progress

## Status: Ready for implementation

## Objective
Add an "Export Session Context" button to the top right of the application. When clicked, it will generate a deep summary of the current session, copy it to the clipboard, and display it in a beautiful, provider-styled overlay.

## User Requirements Gathered
1. **Extraction Method (Primary):** Auto-Prompting. Inject a highly robust prompt asking the current AI to summarize the entire issue, overview, notes, user feedback, and edits.
2. **Extraction Method (Fallback):** DOM Scraping. If the AI hits a rate limit or refuses, the app will fallback to scraping the actual user prompts and AI responses from the DOM of the active session.
3. **Export Format:** Copy directly to the clipboard.
4. **UI/UX:** Display the extracted context in a beautiful, modern, sleek overlay styled with the current AI provider's theme colors. No automatic tab handoff is required.

## Implementation Steps
1. **The Prompt:** Craft a comprehensive "Context Extraction" prompt.
2. **The Extraction Logic (Main Process):** 
   - Add IPC handlers to trigger the extraction.
   - Inject JavaScript into the active `webview` to submit the prompt.
   - Listen for the AI's response to finish streaming.
   - Implement the DOM scraping fallback (will require basic selectors for major providers like ChatGPT, Claude, Gemini, etc.).
3. **The UI (Renderer Process):**
   - Add a top-right export button (perhaps near the settings gear).
   - Create an `ExportOverlay.tsx` component.
   - Style the overlay dynamically using `modelColor(activeTab.model)`.
4. **Integration:** Hook up the button -> IPC -> Extraction -> IPC -> Overlay -> Clipboard flow.
