#!/bin/bash
# Tests remote view end to end on this Mac with a stand-in iPhone (scripts/remote-view-loopback.swift).
#   scripts/remote-view-loopback.sh "<path to a built Notch Apple.app>"
# It TEMPORARILY: quits the installed app, backs up its secrets file, seeds a test phone, turns the companion and
# "Allow viewing this Mac's screen" on, runs the given build, streams for a few seconds, and then puts everything back
# (secrets file, preferences) and relaunches the installed app. Needs Screen Recording allowed for Notch Apple.
set -uo pipefail
cd "$(dirname "$0")/.."
BUILD="${1:?path to a built Notch Apple.app}"
DIR="$HOME/Library/Application Support/Notch apple"; SECRETS="$DIR/secrets.json"; WORK=$(mktemp -d)
INSTALLED="/Applications/Notch apple.app"; ID=com.notchapple.app
had() { defaults read $ID "$1" >/dev/null 2>&1; }
for k in companion.enabled companion.allowView companion.port; do had $k && echo "$k=$(defaults read $ID $k)" >> "$WORK/prefs"; done
[ -f "$SECRETS" ] && cp -p "$SECRETS" "$WORK/secrets.backup"
cleanup() {
  osascript -e 'tell application "Notch Apple" to quit' 2>/dev/null; sleep 2; pkill -x "Notch Apple" 2>/dev/null; sleep 1
  [ -f "$WORK/secrets.backup" ] && cp -p "$WORK/secrets.backup" "$SECRETS"
  for k in companion.enabled companion.allowView companion.port; do
    old=$(grep "^$k=" "$WORK/prefs" 2>/dev/null | cut -d= -f2-)
    if [ -n "$old" ]; then case "$old" in 1|0) defaults write $ID $k -bool $([ "$old" = 1 ] && echo true || echo false);; *) defaults write $ID $k "$old";; esac; else defaults delete $ID $k 2>/dev/null; fi
  done
  open "$INSTALLED"; echo "restored your settings and relaunched the installed app"
}
trap cleanup EXIT
osascript -e 'tell application "Notch Apple" to quit' 2>/dev/null; sleep 2; pkill -x "Notch Apple" 2>/dev/null; sleep 1
TOKEN=$(python3 -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())")
python3 - "$SECRETS" "$TOKEN" <<'PY'
import json, base64, sys
path, token = sys.argv[1], sys.argv[2]
d = json.load(open(path)) if __import__('os').path.exists(path) else {}
phones = [{"id": "loopback-test", "name": "Loopback test", "token": token, "added": 0}]
d["companion.phones"] = base64.b64encode(json.dumps(phones).encode()).decode()
json.dump(d, open(path, "w"))
PY
defaults write $ID companion.enabled -bool true; defaults write $ID companion.allowView -bool true; defaults delete $ID companion.port 2>/dev/null
cp -R "$BUILD" "$WORK/Notch Apple.app"; xattr -cr "$WORK/Notch Apple.app"
codesign --force --sign - --preserve-metadata=entitlements,flags,runtime -r='designated => identifier "com.notchapple.app"' "$WORK/Notch Apple.app" 2>/dev/null
open "$WORK/Notch Apple.app"
for i in $(seq 1 75); do nc -z 127.0.0.1 47813 2>/dev/null && break; sleep 1; done
if nc -z 127.0.0.1 47813; then echo "the Mac is listening on 47813"; else echo "NOT listening on 47813"; pgrep -x "Notch Apple" >/dev/null && echo "(the app is running)" || echo "(the app is NOT running)"; lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -i "notch" | head -3; fi
mkdir -p /tmp/rv; cp scripts/remote-view-loopback.swift "$WORK/main.swift"
swiftc -swift-version 5 -o "$WORK/loopback" "$WORK/main.swift" CompanionKit/CompanionProtocol.swift CompanionKit/CompanionPairing.swift CompanionKit/CompanionStream.swift 2>&1 | grep error
"$WORK/loopback" "$TOKEN" loopback-test 47813 5
