#!/usr/bin/env bash
# Run build then notify on completion (success or failure)
set -u
BUILDER="${1:-build}"
notify-send -u normal \
  "Nexus Build: ${BUILDER}" \
  "Started…" &
notif_pid=$!
npm run "${BUILDER}" --if-present >/tmp/nexus-build.log 2>&1
result=$?
kill "$notif_pid" 2>/dev/null || true
if [ $result -eq 0 ]; then
  notify-send -u critical \
    "Nexus Build: ${BUILDER} ✓" \
    "Finished successfully — see /tmp/nexus-build.log"
else
  notify-send -u critical \
    "Nexus Build: ${BUILDER} ✗ FAILED" \
    "Exit code ${result} — see /tmp/nexus-build.log"
fi
exit $result
