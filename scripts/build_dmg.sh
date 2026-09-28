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
mkdir -p dist
DMG="dist/NotchApple-$VERSION.dmg"
rm -f "$DMG"
hdiutil create -volname "Notch apple" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$STAGE"
echo "✅ $DMG"
