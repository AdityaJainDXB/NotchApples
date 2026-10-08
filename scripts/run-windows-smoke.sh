#!/bin/bash
# Runs the Windows app's logic tests (Node) and a smoke test of its real screens in a simulated browser (jsdom).
# No Windows machine is needed. Usage: scripts/run-windows-smoke.sh
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
node --test "$root"/NotchWindows/tests/*.test.mjs
work="$(mktemp -d)"
cp -R "$root/NotchWindows/src/js" "$work/js"
cp "$root/NotchWindows/tests/smoke.mjs" "$work/smoke.mjs"
echo '{"type":"module","private":true}' > "$work/package.json"
(cd "$work" && npm install jsdom --silent --no-audit --no-fund >/dev/null 2>&1)
(cd "$work" && node smoke.mjs)
