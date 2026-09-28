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

# Optional extras (BackgroundMusic driver, licences) ship inside the app:
# Settings → Audio installs the driver; licences are in Contents/Resources.

# Styled installer window (vibrant background, drag-to-Applications layout).
# dmgbuild writes the Finder layout directly — no Finder scripting needed.
VENV=build/.dmgvenv
[ -x "$VENV/bin/dmgbuild" ] || { python3 -m venv "$VENV" && "$VENV/bin/pip" -q install "dmgbuild==1.6.5"; }
BG=build/dmg-background.tiff
swift scripts/make_dmg_background.swift build >/dev/null
mkdir -p dist
DMG="dist/NotchApple-$VERSION.dmg"
rm -f "$DMG"
"$VENV/bin/dmgbuild" -s scripts/dmg/dmg_settings.py \
  -D app="$APP" -D background="$BG" \
  "Notch apple" "$DMG" >/dev/null

# Keep the Homebrew cask in step with this release.
SHA=$(shasum -a 256 "$DMG" | awk '{print $1}')
sed -i '' -E "s/^  version \".*\"/  version \"$VERSION\"/; s/^  sha256 \".*\"/  sha256 \"$SHA\"/" Casks/notch-apple.rb
# Remove the built app now that it's inside the DMG, so there's only one
# "Notch apple" on this Mac (the one in /Applications). Build caches stay.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$PWD/$APP" 2>/dev/null || true
rm -rf "$APP"

echo "✅ $DMG  (cask updated: $VERSION)"
