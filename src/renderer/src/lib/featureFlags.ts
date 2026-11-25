/**
 * Feature flags for surfaces this build deliberately does not show.
 *
 * Not a settings toggle on purpose: the point is that the UI is absent, not that it is hidden behind a
 * preference someone can flip and then wonder about.
 */

/**
 * "Import sessions from your browser" — the whole card in Settings → Providers that scanned Zen /
 * Firefox / Chrome / Edge profiles and merged their cookies in.
 *
 * Turned off because signing in inside Nexus works and is the only route that is honest about what is
 * happening: the page is loaded, the provider asks for a login, the session stays in that container.
 * The import path cannot read Chrome or Edge cookie stores on Windows at all (they are encrypted), so it
 * promised something it could not always deliver, and it taught people to expect that a browser-history
 * import was part of setup. It is not.
 *
 * The main-process handlers behind it are untouched — this hides the UI, it does not disable a feature
 * that something else might still call.
 */
export const BROWSER_IMPORT_UI = false
