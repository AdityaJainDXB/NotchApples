#!/usr/bin/env bash
# Builds a Release copy of Notch Apple and packages it into a drag-to-install DMG.
# Usage: scripts/build_dmg.sh            → dist/NotchApple-<version>.dmg
set -euo pipefail
cd "$(dirname "$0")/.."
scripts/ensure_firebase_config.sh
# The Ultimate modules (private repository). REQUIRE_PREMIUM=1 (official releases) makes a missing fetch an error.
scripts/fetch-premium.sh ${REQUIRE_PREMIUM:+--require}

command -v xcodegen >/dev/null && xcodegen generate >/dev/null
VERSION=$(grep 'MARKETING_VERSION' project.yml | head -1 | sed -E 's/.*"(.*)".*/\1/')
xcodebuild -project NotchApple.xcodeproj -scheme NotchApple -configuration Release \
  -derivedDataPath build/dd ARCHS="arm64 x86_64" ONLY_ACTIVE_ARCH=NO build | xcbeautify 2>/dev/null || true
APP="build/dd/Build/Products/Release/Notch Apple.app"
[ -d "$APP" ] || { echo "Build failed"; exit 1; }

# Ad-hoc signatures identify the app by its exact hash, so every new build
# looks like a different app to macOS and loses its Accessibility permission.
# Re-sign with a designated requirement based on the bundle ID instead, so a
# permission granted once keeps working across updates.
xattr -cr "$APP"
codesign --force --sign - --preserve-metadata=entitlements,flags,runtime \
  -r='designated => identifier "com.notchapple.app"' "$APP"

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
  "Notch Apple" "$DMG" >/dev/null

# Keep the Homebrew cask in step with this release.
SHA=$(shasum -a 256 "$DMG" | awk '{print $1}')
sed -i '' -E "s/^  version \".*\"/  version \"$VERSION\"/; s/^  sha256 \".*\"/  sha256 \"$SHA\"/" Casks/notch-apple.rb
# Remove the built app now that it's inside the DMG, so there's only one
# "Notch Apple" on this Mac (the one in /Applications). Build caches stay.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$PWD/$APP" 2>/dev/null || true
rm -rf "$APP"

echo "✅ $DMG  (cask updated: $VERSION)"
