#!/bin/bash
# Starts the freshly built app and fails if it dies within 15 seconds, so a release that crashes at launch
# (2.0.17 and 2.0.18 did) never gets published. Usage: scripts/launch-check.sh
set -uo pipefail
cd "$(dirname "$0")/.."
APP="build/dd/Build/Products/Release/Notch apple.app"
BIN="$APP/Contents/MacOS/Notch apple"
[ -x "$BIN" ] || { echo "launch-check: no built app at $BIN"; exit 1; }
"$BIN" >/tmp/notch-launch.log 2>&1 &
pid=$!
for _ in $(seq 1 15); do
  sleep 1
  if ! kill -0 "$pid" 2>/dev/null; then
    wait "$pid"; code=$?
    echo "launch-check: the app exited after launch (status $code)"; tail -20 /tmp/notch-launch.log
    exit 1
  fi
done
kill "$pid" 2>/dev/null
echo "launch-check: the app stayed running for 15 seconds"
