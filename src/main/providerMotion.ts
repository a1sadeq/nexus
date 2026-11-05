/** Optional, per-provider CSS animation pause. Default is off.
 * This does not stop video, canvas, WebGL, JS animation loops or site work.
 * The CSS can also freeze loading/progress indicators; users can turn it off.
 */
export const PROVIDER_MOTION_STYLE = '*, *::before, *::after { animation-play-state: paused !important; }'

/** Build a self-contained page script. Sequence numbers reject stale async updates. */
export function buildProviderMotionScript(enabled: boolean, sequence: number): string {
  const css = JSON.stringify(PROVIDER_MOTION_STYLE)
  return `(() => {
    const sequence = ${JSON.stringify(sequence)};
    if ((window.__nexusProviderMotionSequence || 0) > sequence) return;
    window.__nexusProviderMotionSequence = sequence;
    const selector = 'style[data-nexus-provider-motion="1"]';
    const style = document.querySelector(selector);
    if (!${enabled}) {
      if (style) style.remove();
      return;
    }
    if (!document.head) return;
    const node = style || document.createElement('style');
    if (!style) {
      node.setAttribute('data-nexus-provider-motion', '1');
      document.head.appendChild(node);
    }
    const css = ${css};
    if (node.textContent !== css) node.textContent = css;
  })()`
}
