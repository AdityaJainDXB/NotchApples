#!/bin/bash
# Brings the Ultimate modules (kept in a private repository) into this checkout, for official builds.
#
#   scripts/fetch-premium.sh             fetch them if they can be reached; otherwise carry on (a build from the public source
#                                        has no Ultimate modules, and those tabs say so)
#   scripts/fetch-premium.sh --require   fail unless they were fetched (used for official releases, so a release can never ship
#                                        without them by accident)
#
# Where it looks, in order:
#   1. a clone of the private repository next to this one (../NotchApples-Premium), updated with git pull;
#   2. CI: the PREMIUM_DEPLOY_KEY secret (a read-only deploy key) to clone it;
#   3. your own GitHub login (gh), if it can see the private repository.
# The files are copied into places the public repository ignores (see .gitignore), so they are never committed here.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
repo="AdityaJainDXB/NotchApples-Premium"
require="${1:-}"
src=""

if [ -d "$root/../NotchApples-Premium/mac" ]; then
  src="$root/../NotchApples-Premium"
  git -C "$src" pull -q --ff-only 2>/dev/null || true
elif [ -n "${PREMIUM_DEPLOY_KEY:-}" ]; then
  tmp="$(mktemp -d)"
  umask 077
  printf '%s\n' "$PREMIUM_DEPLOY_KEY" > "$tmp/key"
  GIT_SSH_COMMAND="ssh -i $tmp/key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" \
    git clone -q --depth 1 "git@github.com:$repo.git" "$tmp/premium" && src="$tmp/premium"
  rm -f "$tmp/key"
elif command -v gh >/dev/null 2>&1 && gh repo view "$repo" >/dev/null 2>&1; then
  tmp="$(mktemp -d)"
  gh repo clone "$repo" "$tmp/premium" -- --depth 1 -q >/dev/null 2>&1 && src="$tmp/premium"
fi

if [ -z "$src" ] || [ ! -d "$src/mac" ]; then
  if [ "$require" = "--require" ]; then echo "The Ultimate modules (private repository $repo) could not be fetched, so this build would be missing them." >&2; exit 1; fi
  echo "Ultimate modules not available: building from the public source only."
  exit 0
fi

# cp, not rsync: the Windows runner has no rsync.
cp -R "$src/mac/." "$root/NotchApple/"
cp -R "$src/windows/." "$root/NotchWindows/src/js/"
echo "Ultimate modules fetched from $repo."
