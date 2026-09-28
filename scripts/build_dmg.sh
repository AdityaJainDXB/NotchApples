#!/usr/bin/env bash
# Builds a Release copy of Notch apple and packages it into a drag-to-install DMG.
# Usage: scripts/build_dmg.sh            → dist/NotchApple-<version>.dmg
set -euo pipefail
cd "$(dirname "$0")/.."

# Tunnelblick's notarized installer is bundled (GPL-2.0, unmodified) but not kept in git.
TB_DMG=NotchApple/Resources/Tunnelblick/Tunnelblick.dmg
TB_SHA=73ca843b7720cd9261a7fd6cf53b0901a06f69c25824ef09430e4094f0688ad0
if [ ! -f "$TB_DMG" ]; then
  curl -fsSL "https://github.com/Tunnelblick/Tunnelblick/releases/download/v9.0.1/Tunnelblick_9.0.1_build_6491.dmg" -o "$TB_DMG"
fi
echo "$TB_SHA  $TB_DMG" | shasum -a 256 -c - >/dev/null || { echo "Tunnelblick checksum mismatch"; exit 1; }

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
# Keep the Homebrew cask in step with this release.
SHA=$(shasum -a 256 "$DMG" | awk '{print $1}')
sed -i '' -E "s/^  version \".*\"/  version \"$VERSION\"/; s/^  sha256 \".*\"/  sha256 \"$SHA\"/" Casks/notch-apple.rb
echo "✅ $DMG  (cask updated: $VERSION)"
