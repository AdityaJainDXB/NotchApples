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

# An ad-hoc signature identifies the app by its exact hash, so every new build looks like a different app to macOS and
# loses its Accessibility permission (and the notch's volume and brightness gauge with it). Official builds are signed
# with a fixed self-signed certificate (scripts/setup-signing.sh) and a requirement tied to it, so a permission granted
# once keeps working across updates. Without that certificate (any other Mac) the build falls back to ad-hoc.
xattr -cr "$APP"
SIGN_KC="$HOME/Library/Keychains/notchapple-signing.keychain-db"
SIGN_HASH=""
if [ -f "$SIGN_KC" ]; then
  security unlock-keychain -p "" "$SIGN_KC" 2>/dev/null || true
  SIGN_HASH=$(security find-identity -p codesigning "$SIGN_KC" 2>/dev/null | awk '/Notch Apple Self-Signed/ {print $2; exit}')
fi
if [ -n "$SIGN_HASH" ]; then
  LEAF=$(echo "$SIGN_HASH" | tr 'A-F' 'a-f')
  codesign --force --sign "$SIGN_HASH" --keychain "$SIGN_KC" --preserve-metadata=entitlements,flags,runtime \
    -r="designated => identifier \"com.notchapple.app\" and certificate leaf = H\"$LEAF\"" "$APP"
  echo "Signed with the fixed Notch Apple certificate ($SIGN_HASH)" >&2
else
  codesign --force --sign - --preserve-metadata=entitlements,flags,runtime \
    -r='designated => identifier "com.notchapple.app"' "$APP"
  echo "No fixed certificate on this Mac: signed ad-hoc (run scripts/setup-signing.sh)" >&2
fi

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
