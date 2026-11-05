// Throttle only automatic switch-triggered captures. Explicit captures are unchanged.
export function shouldCaptureAutomaticSnapshot(last: number | undefined, now: number, hidden: boolean): boolean {
  return !hidden && (last === undefined || now - last >= 30000 || now < last)
}
