#!/bin/bash
# Builds the DMG, commits, pushes, publishes the GitHub release, updates the Homebrew cask and attaches the iPhone .ipa.
#   scripts/release.sh "<title>" <notes.md> "<commit message>"
# The version comes from project.yml. Run the tests first.
set -euo pipefail
cd "$(dirname "$0")/.."
TITLE="$1"; NOTES="$2"; MSG="$3"
VERSION=$(grep 'MARKETING_VERSION' project.yml | head -1 | sed -E 's/.*"(.*)".*/\1/')
# Mac versions stay readable: the last number rolls over into the next middle number before it reaches 100 (see docs/VERSIONING.md).
PATCH=${VERSION##*.}
if [ "$PATCH" -ge 100 ]; then
  MID=${VERSION%.*}; MAJ=${MID%.*}; MIN=${MID##*.}
  echo "Version $VERSION is past the rollover: 2.0.100 is 2.1.0, so $VERSION should be $MAJ.$((MIN + PATCH / 100)).$((PATCH % 100)). Edit MARKETING_VERSION in project.yml (and the notes, README and WhatsNew) first."; exit 1
fi
export REQUIRE_PREMIUM=1     # an official release must contain the Ultimate modules (private repository)
scripts/build_dmg.sh >/dev/null 2>&1 || true
DMG="dist/NotchApple-$VERSION.dmg"
[ -f "$DMG" ] || { echo "No $DMG"; exit 1; }
M=$(hdiutil attach -nobrowse -readonly "$DMG" 2>/dev/null | grep -o '/Volumes/.*' | head -1)
ARCHS=$(lipo -archs "$M/Notch Apple.app/Contents/MacOS/Notch Apple"); V=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$M/Notch Apple.app/Contents/Info.plist")
KEY=$(/usr/libexec/PlistBuddy -c "Print API_KEY" "$M/Notch Apple.app/Contents/Resources/GoogleService-Info.plist" 2>/dev/null || true)
PREMIUM=$(strings "$M/Notch Apple.app/Contents/MacOS/Notch Apple" | grep -c NotchPremiumEntry || true)
hdiutil detach -quiet "$M"
[ "${PREMIUM:-0}" -gt 0 ] || { echo "This DMG has no Ultimate modules (the private repository AdityaJainDXB/NotchApples-Premium was not fetched), so Convert, Smart Home and the others would be missing. Fix scripts/fetch-premium.sh access and rebuild."; exit 1; }
[ -n "$KEY" ] || { echo "This DMG has no Firebase config, so account sign-in would be off. Put NotchApple/Resources/GoogleService-Info.plist back (it is git-ignored; git pull can delete it) and rebuild."; exit 1; }
[ "$V" = "$VERSION" ] && [[ "$ARCHS" == *x86_64* && "$ARCHS" == *arm64* ]] || { echo "Bad DMG: $V $ARCHS"; exit 1; }
git add -A -- . ':!Casks'
# Nothing to commit is fine (the work may already be committed); the script used to stop here.
git diff --cached --quiet || git commit -q -m "$MSG"
git push -q origin main
gh release create "v$VERSION" "$DMG" --latest --title "Notch Apple $VERSION · $TITLE" --notes-file "$NOTES"
git add Casks && git commit -q -m "Cask: $VERSION" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" && git push -q origin main
# The iPhone companion is rebuilt for every release, so the .ipa on the release is always the same version as the Mac app.
scripts/build_ipa.sh --upload || { echo "WARNING: the iPhone app was NOT attached to v$VERSION: run scripts/build_ipa.sh --upload"; exit 1; }
echo "Released $VERSION ($ARCHS)"
