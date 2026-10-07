#!/usr/bin/env bash
# NotchApple/Resources/GoogleService-Info.plist (the Firebase client config) is kept out of git.
# Builds need the file to exist, so: keep the one on this machine; else restore it from the
# FIREBASE_PLIST_B64 secret (GitHub builds); else write a stub so the build still works
# (account sign-in is then switched off in that build).
set -euo pipefail
cd "$(dirname "$0")/.."
F=NotchApple/Resources/GoogleService-Info.plist
if [ -f "$F" ]; then exit 0; fi
if [ -n "${FIREBASE_PLIST_B64:-}" ]; then
  printf '%s' "$FIREBASE_PLIST_B64" | base64 --decode > "$F"
  echo "Firebase config restored from the secret."
else
  cat > "$F" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>BUNDLE_ID</key><string>com.notchapple.app</string></dict></plist>
PLIST
  echo "No Firebase config found: building without account sign-in."
fi
