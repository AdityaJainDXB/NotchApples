#!/usr/bin/env bash
# Builds a Release copy of Notch apple and packages it into a drag-to-install DMG.
# Usage: scripts/build_dmg.sh            → dist/NotchApple-<version>.dmg
set -euo pipefail
cd "$(dirname "$0")/.."

command -v xcodegen >/dev/null && xcodegen generate >/dev/null
VERSION=$(grep 'MARKETING_VERSION' project.yml | head -1 | sed -E 's/.*"(.*)".*/\1/')
xcodebuild -project NotchApple.xcodeproj -scheme NotchApple -configuration Release \
  -derivedDataPath build/dd build | xcbeautify 2>/dev/null || true
APP="build/dd/Build/Products/Release/Notch apple.app"
[ -d "$APP" ] || { echo "Build failed"; exit 1; }

STAGE=$(mktemp -d)
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
# Optional audio driver for macOS 14.0–14.1 (GPL-2.0, shipped unmodified with its licence).
mkdir -p "$STAGE/Extras"
cp NotchApple/Resources/BackgroundMusic.pkg "$STAGE/Extras/Install BackgroundMusic audio driver (optional).pkg"
cp ThirdParty/BackgroundMusic-LICENSE.txt "$STAGE/Extras/BackgroundMusic LICENSE.txt"
cat > "$STAGE/Extras/About these extras.txt" <<'TXT'
BackgroundMusic audio driver (optional)

You only need this on macOS 14.0 or 14.1. On macOS 14.2 and later, Notch apple
changes per-app volume and EQ natively, with nothing to install.

BackgroundMusic is free software by Kyle Neideck and contributors, licensed
under the GNU GPL v2 (see "BackgroundMusic LICENSE.txt").
Source code: https://github.com/kyleneideck/BackgroundMusic
TXT
mkdir -p dist
DMG="dist/NotchApple-$VERSION.dmg"
rm -f "$DMG"
hdiutil create -volname "Notch apple" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$STAGE"
echo "✅ $DMG"
