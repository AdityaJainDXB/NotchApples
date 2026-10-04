#!/bin/bash
# One-time setup of the license server on your free Cloudflare account.
#
#   server/license-worker/scripts/setup.sh            (mainnet, the real one)
#   server/license-worker/scripts/setup.sh testnet    (sandbox copy for the test purchase)
#
# It logs you in to Cloudflare (browser), creates the KV store, uploads the secrets straight to
# Cloudflare and deploys. Secrets never go in the repo: the signing key is read from
# private/license-signing-key.jwk (git-ignored), the others are generated or typed by you.
# At the end it prints the Worker URL to put in the website (pro.html: WORKER).

set -euo pipefail
cd "$(dirname "$0")/.."
ENV_NAME="${1:-}"
ENVFLAG=(); [ -n "$ENV_NAME" ] && ENVFLAG=(--env "$ENV_NAME")
W="npx --yes wrangler@4"

[ -f ../../private/license-signing-key.jwk ] || { echo "Missing private/license-signing-key.jwk (run: node server/license-worker/scripts/genkey.mjs)"; exit 1; }

$W whoami >/dev/null 2>&1 || $W login

KVNAME="LICENSES${ENV_NAME:+_$ENV_NAME}"
if grep -q "REPLACE_WITH${ENV_NAME:+_TESTNET}_KV_ID" wrangler.toml; then
  ID=$($W kv namespace create "$KVNAME" 2>&1 | grep -oE '[0-9a-f]{32}' | head -1)
  [ -n "$ID" ] || { echo "Couldn't create the KV namespace"; exit 1; }
  sed -i '' "s/REPLACE_WITH${ENV_NAME:+_TESTNET}_KV_ID/$ID/" wrangler.toml
  echo "✓ KV store $KVNAME ($ID)"
fi

if [ "$ENV_NAME" = "testnet" ] && grep -q REPLACE_WITH_TESTNET_ADDRESS wrangler.toml; then
  read -rp "Your Litecoin TESTNET receive address (tltc1…): " ADDR
  sed -i '' "s/REPLACE_WITH_TESTNET_ADDRESS/$ADDR/" wrangler.toml
fi

$W secret put SIGNING_KEY "${ENVFLAG[@]}" < ../../private/license-signing-key.jwk
openssl rand -hex 32 | $W secret put EMAIL_PEPPER "${ENVFLAG[@]}"
ADMIN=$(openssl rand -hex 24)
echo "$ADMIN" | $W secret put ADMIN_TOKEN "${ENVFLAG[@]}"
echo "$ADMIN" > "../../private/admin-token${ENV_NAME:+-$ENV_NAME}.txt"; chmod 600 "../../private/admin-token${ENV_NAME:+-$ENV_NAME}.txt"
echo "✓ Admin token saved to private/admin-token${ENV_NAME:+-$ENV_NAME}.txt (git-ignored)"

echo
echo "Email: create a free Brevo account (brevo.com), verify your sender email under Senders,"
echo "then make an API key under SMTP & API → API Keys."
read -rp "Sender email (MAIL_FROM, leave empty to skip email for now): " FROM
if [ -n "$FROM" ]; then
  # A secret, so the address isn't published in the repo.
  printf '%s' "$FROM" | $W secret put MAIL_FROM "${ENVFLAG[@]}"
  $W secret put MAIL_API_KEY "${ENVFLAG[@]}"
fi

$W deploy "${ENVFLAG[@]}"
echo
echo "Done. Put the workers.dev URL above into the website's pro.html (const WORKER=…)."
echo "Keep a backup of private/license-signing-key.jwk in your password manager: without it no new keys can be signed for this public key."
