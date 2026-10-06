#!/bin/bash
# Type-checks the whole Mac app with only the command line tools (no Xcode): builds the local packages as modules,
# then runs swiftc -typecheck over every app source. Prints only errors.
set -uo pipefail
cd "$(dirname "$0")/.."
out=$(mktemp -d)
for pk in NotchKit FoldCore; do
  srcs=(); while IFS= read -r f; do srcs+=("$f"); done < <(find Packages/$pk/Sources -name '*.swift')
  swiftc -swift-version 5 -target arm64-apple-macos14.0 -parse-as-library -emit-module -module-name $pk -I "$out" \
    -emit-module-path "$out/$pk.swiftmodule" -emit-library -o "$out/lib$pk.dylib" "${srcs[@]}" 2>&1 | grep -E "error" || true
done
app=(); while IFS= read -r f; do app+=("$f"); done < <(find NotchApple Shared CompanionKit -name '*.swift')
swiftc -typecheck -swift-version 5 -target arm64-apple-macos14.0 -I "$out" "${app[@]}" 2>&1 | grep -E "error:" -A3 || true
echo "typecheck finished"
