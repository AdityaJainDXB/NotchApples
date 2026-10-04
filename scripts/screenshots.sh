#!/bin/bash
# Takes the product screenshots used by the README and the website, from the real app.
#
#   scripts/screenshots.sh [--site <path to the website repo>]
#
# How it stays clean and repeatable:
#   • Builds a separate screenshot copy of the current code (bundle ID com.notchapple.demo)
#     whose data lives in a throwaway folder, so no personal settings, history or keys appear.
#   • AI answers are real, from Ollama on this Mac (gemma3:4b, which reads images); no API keys.
#   • Inputs are the sample images in scripts/screenshot-inputs (rendered by make_inputs.py).
#   • Only the app's own windows are captured (screencapture -l), never the whole screen.
#     The capture-overlay shot shows the overlay over the sample "screen" image, not your real screen.
#
# ONLY="f1 sports" scripts/screenshots.sh takes just those shots.
# Writes docs/screenshots/<name>.png; with --site also <site>/assets/screenshots/<name>.webp.
# Needs: Xcode, xcodegen, Ollama with `ollama pull gemma3:4b`, Python 3 with Pillow.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE=""
[ "${1:-}" = "--site" ] && SITE="$2"
WORK="${TMPDIR:-/tmp}/notchapple-shots"
DATA="$WORK/data"
OUT="$ROOT/docs/screenshots"
IN="$ROOT/scripts/screenshot-inputs"
D=com.notchapple.demo

echo "› Preparing the screenshot build"
rm -rf "$WORK"; mkdir -p "$WORK" "$DATA"
git -C "$ROOT" worktree add -q --detach "$WORK/src" HEAD
trap 'git -C "$ROOT" worktree remove --force "$WORK/src" >/dev/null 2>&1 || true' EXIT
rsync -a --exclude .git "$ROOT/NotchApple/" "$WORK/src/NotchApple/"   # include uncommitted work
cp "$ROOT/project.yml" "$WORK/src/"
cd "$WORK/src"
grep -rl "applicationSupportDirectory, in: .userDomainMask)\[0\]" NotchApple Shared | xargs sed -i '' \
  "s#FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)\[0\]#URL(fileURLWithPath: \"$DATA\")#; s#fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)\[0\]#URL(fileURLWithPath: \"$DATA\")#"
sed -i '' 's/group.com.notchapple.shared/group.com.notchapple.demo/' Shared/SharedStore.swift
sed -i '' 's/    static func runIfNeeded() {/    static func runIfNeeded() { if true { return }/' NotchApple/Core/SandboxMigration.swift
# Shots of Pro features (AI) pass -demoPro YES to show them unlocked. This patch exists only in this
# throwaway build; the real app is never changed. The "pro" shot runs without it (the real unlock screen).
sed -i '' 's/    static func isAppActivated() -> Bool {/    static func isAppActivated() -> Bool { UserDefaults.standard.bool(forKey: "demoPro") || realIsAppActivated() }\
    static func realIsAppActivated() -> Bool {/' NotchApple/Core/AccessCodeManager.swift
# Ultimate-only shots pass -demoTier ultimate (again, only in this throwaway build).
sed -i '' 's/let t = LicenseKey.tier(key: key, revoked: revoked, legacyActivated: hasLegacyActivation)/let t: Tier = UserDefaults.standard.string(forKey: "demoTier") == "ultimate" ? .ultimate : LicenseKey.tier(key: key, revoked: revoked, legacyActivated: hasLegacyActivation)/' NotchApple/Core/Entitlements.swift
sed -i '' 's/PRODUCT_BUNDLE_IDENTIFIER: com.notchapple.app$/PRODUCT_BUNDLE_IDENTIFIER: com.notchapple.demo/; s/com.notchapple.app.widget/com.notchapple.demo.widget/' project.yml
xcodegen generate -q
xcodebuild -project NotchApple.xcodeproj -scheme NotchApple -configuration Release -derivedDataPath "$WORK/dd" build 2>&1 | grep -E "error:|BUILD" | sort -u
APP="$WORK/dd/Build/Products/Release/Notch apple.app/Contents/MacOS/Notch apple"

cat > "$WORK/wid.swift" <<'EOF'
import CoreGraphics
let pid = Int(CommandLine.arguments[1])!, want = CommandLine.arguments[2]
let list = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as! [[String: Any]]
var best: (Int, Double)? = nil
for w in list where (w["kCGWindowOwnerPID"] as? Int) == pid {
    let b = w["kCGWindowBounds"] as! [String: Any], h = b["Height"] as! Double, area = h * (b["Width"] as! Double)
    let layer = w["kCGWindowLayer"] as! Int, n = w["kCGWindowNumber"] as! Int
    let ok = (want == "panel" && layer > 0 && layer < 1000 && h > 100) || (want == "trigger" && layer > 0 && layer < 1000 && h < 100) || (want == "settings" && layer == 0 && h > 200) || (want == "overlay" && layer >= 1000)
    if ok, best == nil || area > best!.1 { best = (n, area) }
}
if let best { print(best.0) }
EOF
swiftc -O "$WORK/wid.swift" -o "$WORK/wid" 2>/dev/null

echo "› Settings for the screenshot copy"
defaults delete $D >/dev/null 2>&1 || true
for k in onboarding.permissionsShown onboarding.welcomeDismissed module.f1.enabled module.claude.enabled module.sports.enabled module.games.enabled module.launcher.enabled module.timer.enabled module.markets.enabled; do defaults write $D $k -bool true; done
defaults write $D updates.autoCheck -bool false
defaults write $D ai.provider ollama
defaults write $D ai.models -string '{"ollama":"gemma3:4b"}'
defaults write $D f1.follow ""
curl -s -m 3 localhost:11434/api/tags >/dev/null || { echo "Start Ollama first (ollama serve)"; exit 1; }

# Quit the installed app while shooting so two notches don't overlap; reopened at the end.
REAL_RUNNING=0; pgrep -x "Notch apple" >/dev/null && REAL_RUNNING=1 && osascript -e 'quit app "Notch apple"' && sleep 2

answers() { python3 -c "import json,sys;d=json.load(open('$DATA/Notch apple/ai-history.json'));print(sum(1 for s in d for m in s['messages'] if m['role']=='assistant'))" 2>/dev/null || echo 0; }
wait_answers() { local want=$1; for _ in $(seq 1 120); do [ "$(answers)" -ge "$want" ] && return; sleep 1; done; echo "  (timed out waiting for the answer)"; }

shot() {   # shot <name> <window kind> <wait: seconds | answers:N> <args…>
  local name=$1 kind=$2 wait=$3; shift 3
  if [ -n "${ONLY:-}" ] && [[ " $ONLY " != *" $name "* ]]; then return; fi
  "$APP" "$@" >/dev/null 2>&1 & local pid=$!
  if [[ $wait == answers:* ]]; then sleep 4; wait_answers "${wait#answers:}"; sleep 2; else sleep "$wait"; fi
  local w; w=$("$WORK/wid" $pid "$kind")
  if [ -n "$w" ]; then screencapture -x -o -l"$w" "$OUT/$name.png" && echo "  ✓ $name"; else echo "  ✗ $name (no window)"; fi
  kill $pid 2>/dev/null; wait $pid 2>/dev/null || true; sleep 1.5
}

echo "› Shooting"
mkdir -p "$OUT"
shot ai-empty      panel 6 -openNotch claude -demoPro YES
shot ai-input      panel 7 -openNotch claude -demoPro YES -demoInput "$IN/math.png"
shot ai-result     panel answers:1 -openNotch claude -demoPro YES -demoInput "$IN/math.png" -demoRun solve
shot follow-up     panel answers:3 -openNotch claude -demoPro YES -demoInput "$IN/math.png" -demoRun solve -demoFollowUp "Why are there two answers?"
shot code-analysis panel answers:4 -openNotch claude -demoPro YES -demoInput "$IN/code.png" -demoRun code
shot capture-overlay overlay 4 -demoOverlay "$IN/screen.png" -demoSelection 300,228,900,382
shot f1            panel 12 -openNotch f1
shot sports        panel 12 -openNotch sports
shot sports-table  panel 12 -openNotch sports -sports.showTable YES
shot sports-cricket panel 12 -openNotch sports -sports.league cricket/india
shot sports-detail panel 14 -openNotch sports -demoSportsDetail YES
shot games         panel 5 -openNotch games
shot history       settings 6 -openSettings aiHistory
shot settings-ai   settings 6 -openSettings claude
shot pro           panel 6 -openNotch launcher
shot settings-pro  settings 6 -openSettings license
shot settings-notch settings 6 -openSettings notch
shot settings-themes settings 6 -openSettings appearance -demoPro YES
shot onboarding    settings 6 -demoOnboarding 2
shot onboarding-tour settings 6 -demoOnboarding 4
shot notch-stacked trigger 5 -demoTier ultimate -demoTimer 1500 -demoActivity "id=build&title=Build&text=42%25&symbol=hammer.fill&color=34C759"
shot markets       panel 10 -openNotch markets -demoPro YES
shot ai-web        panel answers:1 -openNotch claude -demoPro YES -demoWeb YES -demoAsk "Who designed the Eiffel Tower, and how tall is it?"

[ $REAL_RUNNING = 1 ] && open -g -a "/Applications/Notch apple.app"
defaults delete $D >/dev/null 2>&1 || true

if [ -n "$SITE" ]; then
  echo "› WebP copies for the website"
  mkdir -p "$SITE/assets/screenshots"
  for f in ai-empty ai-input ai-result follow-up code-analysis capture-overlay f1 sports sports-table sports-cricket sports-detail games history settings-ai pro settings-pro settings-notch settings-themes onboarding onboarding-tour notch-stacked markets ai-web; do
    [ -f "$OUT/$f.png" ] && python3 -c "
from PIL import Image; im = Image.open('$OUT/$f.png'); im.thumbnail((1600, 1600)); im.save('$SITE/assets/screenshots/$f.webp', 'WEBP', quality=82, method=6)"
  done
  ls -la "$SITE/assets/screenshots"
fi
echo "Done: $OUT"
