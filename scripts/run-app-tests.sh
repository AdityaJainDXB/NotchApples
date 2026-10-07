#!/bin/bash
# Runs the app's pure-logic XCTest files without Xcode, with the XCTest stand-in (scripts/xctest-shim.swift).
# The sources named here are compiled straight into the test binary, the same way project.yml's test target does.
# CI (real XCTest) is the source of truth. Usage: scripts/run-app-tests.sh
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$(mktemp -d)"
swiftc -swift-version 5 -parse-as-library -emit-module -module-name XCTest -emit-library -o "$out/libXCTest.dylib" "$root/scripts/xctest-shim.swift" \
  -Xlinker -install_name -Xlinker "$out/libXCTest.dylib" -emit-module-path "$out/XCTest.swiftmodule"
tests=("$root/NotchAppleTests/GameEngineTests.swift" "$root/NotchAppleTests/ClaudeCodeStatusTests.swift" "$root/NotchAppleTests/VPNTunnelTests.swift" "$root/NotchAppleTests/GeminiFallbackTests.swift" "$root/NotchAppleTests/ClaudeUsagePaceTests.swift" "$root/NotchAppleTests/MathEngineTests.swift" "$root/NotchAppleTests/ModuleLayoutTests.swift" "$root/NotchAppleTests/PairDropTests.swift" "$root/NotchAppleTests/TourLogicTests.swift" "$root/NotchAppleTests/ClaudeLimitsTests.swift")
python3 "$root/scripts/gen-xctest-main.py" "${tests[@]}" > "$out/main.swift"
swiftc -swift-version 5 -I "$out" -L "$out" -lXCTest -Xlinker -rpath -Xlinker "$out" -o "$out/run" \
  "$root/NotchApple/Modules/Games/GameEngines.swift" "$root/NotchApple/Core/ClaudeCodeStatusLogic.swift" "$root/NotchApple/Core/VPNTunnel.swift" "$root/NotchApple/Modules/Claude/GeminiFallbackLogic.swift" "$root/NotchApple/Core/ClaudeUsageLogic.swift" "$root/NotchApple/Modules/Tools/MathEngine.swift" "$root/NotchApple/Core/ModuleLayoutLogic.swift" "$root/NotchApple/Modules/Sharing/PairDropLogic.swift" "$root/NotchApple/Core/TourLogic.swift" "$root/NotchApple/Core/ClaudeLimitsLogic.swift" "${tests[@]}" "$out/main.swift"
"$out/run"
