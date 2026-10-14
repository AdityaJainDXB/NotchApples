#!/usr/bin/env bash
# The quality gate for the website, run before anything is published to GitHub Pages.
#   scripts/gate-site.sh          links, secrets, then the browser tests (Chromium; set GATE_FAST=1 to skip the browser tests)
# Exits non-zero when something is broken, and says what. Used by .github/workflows/pages.yml and weekly-site-update.yml.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
step() { printf '\n== %s\n' "$1"; }

step "Links, images and the sitemap"
node scripts/check-site.mjs || fail=1

step "No secrets in the site"
# Private keys, GitHub / Anthropic / AWS tokens, and long hex-or-base64 assignments to key-like names.
if grep -rInE --exclude-dir=node_modules --exclude-dir=tests --exclude=package-lock.json \
  '(-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-ant-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|(secret|token|password|api[_-]?key)["'"'"' ]*[:=]["'"'"' ]*[A-Za-z0-9+/_-]{32,})' web; then
  echo "A secret-looking string is in web/. Remove it (and rotate it)."; fail=1
else echo "clean"; fi

step "The site only talks to hosts it is meant to (payment and licence links cannot be quietly redirected)"
# Every http(s) host that appears in a page, a script or a data file must be on this list. Adding a host is a deliberate edit here.
allowed='^(github\.com|api\.github\.com|raw\.githubusercontent\.com|adityajaindxb\.github\.io|notchapple-licenses\.adityajain1225\.workers\.dev|www\.w3\.org|www\.sitemaps\.org|schema\.org|fonts\.googleapis\.com|fonts\.gstatic\.com|notch\.cc\.cd|example\.invalid)$'
odd=$(grep -IhoE 'https?://[a-zA-Z0-9._-]+' web/*.html web/api.json web/latest.json web/sitemap.xml web/robots.txt $(find web/assets -name '*.js' -o -name '*.css' 2>/dev/null) 2>/dev/null | sed -E 's#https?://##' | sort -u | grep -vE "$allowed" || true)
if [ -n "$odd" ]; then echo "These hosts are not on the allowlist (scripts/gate-site.sh):"; echo "$odd"; fail=1; else echo "ok"; fi
# The licence server address and the wallet the pricing page shows must be exactly what they were.
grep -q 'https://notchapple-licenses.adityajain1225.workers.dev' web/api.json || { echo "web/api.json no longer points at the licence server"; fail=1; }

step "Scripts parse"
for f in web/*.html; do
  node -e '
    const fs=require("fs"); const html=fs.readFileSync(process.argv[1],"utf8"); let bad=0;
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="(?:application\/ld\+json|module)")[^>]*>([\s\S]*?)<\/script>/g)) {
      try { new Function(m[1]); } catch (e) { console.log(process.argv[1]+": "+e.message); bad=1; }
    }
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) { try { JSON.parse(m[1]); } catch (e) { console.log(process.argv[1]+": structured data is not valid JSON"); bad=1; } }
    process.exit(bad);' "$f" || fail=1
done

if [ -z "${GATE_FAST:-}" ]; then
  step "Browser tests"
  ( cd web && npm ci --silent && npx playwright install --with-deps chromium >/dev/null 2>&1 && npx playwright test --project=desktop --project=mobile ) || fail=1
fi

printf '\n'
[ "$fail" = 0 ] && echo "GATE PASSED" || echo "GATE FAILED"
exit "$fail"
