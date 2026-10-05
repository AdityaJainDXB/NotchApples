#!/usr/bin/env bash
# Sets the admin access codes (as SHA-256 hashes) on the live Worker and redeploys it.
# Usage: bash scripts/set-admin-codes.sh <hash1>,<hash2>,<hash3>
# Make a hash from a code with:  printf '%s' 'NA-XXXX-XXXX-XXXX-XXXX' | shasum -a 256
set -euo pipefail
cd "$(dirname "$0")/.."
[ -n "${1:-}" ] || { echo "Usage: $0 <hash1>,<hash2>,<hash3>"; exit 1; }
printf '%s' "$1" | npx wrangler secret put ADMIN_TOKENS
npx wrangler deploy
echo "Done. Sign in at <your worker URL>/admin or the site's hidden admin page with one of the codes."
