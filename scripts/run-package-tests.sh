#!/bin/bash
# Runs a package's XCTest files WITHOUT Xcode, using a tiny XCTest stand-in (scripts/xctest-shim.swift).
# Real CI (Xcode) runs the same files under real XCTest; this exists so they can be run on a Mac that
# only has the command line tools. Usage: scripts/run-package-tests.sh Packages/NotchKit
set -euo pipefail
pkg="$1"
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$(mktemp -d)"
name="$(basename "$pkg")"
srcs=(); while IFS= read -r f; do srcs+=("$f"); done < <(find "$root/$pkg/Sources" -name '*.swift')
tests=(); while IFS= read -r f; do tests+=("$f"); done < <(find "$root/$pkg/Tests" -name '*.swift')
# Compile the package sources as module $name, then the shim, then the tests plus a runner.
swiftc -swift-version 5 -enable-testing -parse-as-library -emit-module -module-name "$name" -emit-library -o "$out/lib$name.dylib" "${srcs[@]}" -Xlinker -install_name -Xlinker "$out/lib$name.dylib" -emit-module-path "$out/$name.swiftmodule"
swiftc -swift-version 5 -parse-as-library -emit-module -module-name XCTest -emit-library -o "$out/libXCTest.dylib" "$root/scripts/xctest-shim.swift" -Xlinker -install_name -Xlinker "$out/libXCTest.dylib" -emit-module-path "$out/XCTest.swiftmodule"
python3 "$root/scripts/gen-xctest-main.py" "${tests[@]}" > "$out/main.swift"
swiftc -swift-version 5 -I "$out" -L "$out" -l"$name" -lXCTest -Xlinker -rpath -Xlinker "$out" -o "$out/run" "${tests[@]}" "$out/main.swift"
"$out/run"
