#!/bin/bash
# Builds the iPhone companion as an unsigned .ipa (Sideloadly signs it with the person's own Apple ID) and, with --upload,
# attaches it to the GitHub release of the current version.
#   scripts/build_ipa.sh [--upload]
# The version comes from project.yml (the same as the Mac app, which the README tells people to match).
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(grep 'MARKETING_VERSION' project.yml | head -1 | sed -E 's/.*"(.*)".*/\1/')
xcodegen generate >/dev/null
OUT="build/ios"; rm -rf "$OUT"
xcodebuild -project NotchApple.xcodeproj -scheme NotchCompanion -configuration Release -sdk iphoneos \
  -derivedDataPath "$OUT" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)" | sort -u
APP="$OUT/Build/Products/Release-iphoneos/NotchCompanion.app"
[ -d "$APP" ] || { echo "No iPhone app was built"; exit 1; }
V=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$APP/Info.plist")
[ "$V" = "$VERSION" ] || { echo "The iPhone app says $V, expected $VERSION"; exit 1; }
PAY=$(mktemp -d); mkdir "$PAY/Payload"; cp -R "$APP" "$PAY/Payload/"
mkdir -p dist; rm -f dist/NotchAppleCompanion.ipa
(cd "$PAY" && zip -qry "$OLDPWD/dist/NotchAppleCompanion.ipa" Payload)
rm -rf "$PAY"
unzip -l dist/NotchAppleCompanion.ipa | grep -q "Payload/NotchCompanion.app/NotchCompanion" || { echo "The .ipa has no app binary"; exit 1; }
echo "Built dist/NotchAppleCompanion.ipa ($V)"
if [ "${1:-}" = "--upload" ]; then
  gh release upload "v$VERSION" dist/NotchAppleCompanion.ipa --clobber
  echo "Attached it to v$VERSION"
fi
