#!/bin/bash
# Starts the freshly built app and fails if it dies within 15 seconds, so a release that crashes at launch
# (2.0.17 and 2.0.18 did) never gets published. Usage: scripts/launch-check.sh
set -uo pipefail
cd "$(dirname "$0")/.."
# build_dmg.sh removes the built app once it's in the DMG, so check the app inside the DMG: the one people install.
VERSION=$(grep 'MARKETING_VERSION' project.yml | head -1 | sed -E 's/.*"(.*)".*/\1/')
DMG="dist/NotchApple-$VERSION.dmg"
[ -f "$DMG" ] || { echo "launch-check: no DMG at $DMG"; exit 1; }
MNT=$(mktemp -d)
hdiutil attach -nobrowse -readonly -mountpoint "$MNT" "$DMG" >/dev/null || { echo "launch-check: couldn't open $DMG"; exit 1; }
WORK=$(mktemp -d)
cp -R "$MNT/Notch apple.app" "$WORK/"
hdiutil detach "$MNT" >/dev/null 2>&1 || true
trap 'rm -rf "$WORK"' EXIT
APP="$WORK/Notch apple.app"
BIN="$APP/Contents/MacOS/Notch apple"
[ -x "$BIN" ] || { echo "launch-check: no app inside $DMG"; exit 1; }
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
