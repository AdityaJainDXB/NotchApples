#!/bin/bash
# Makes a key on the license server and emails it from the support address, with an optional personal note on top.
#   scripts/issue-key-email.sh <pro|ultimate> <email> "<note for the admin audit log>" [intro-text-file]
# The admin token is read from private/admin-token.txt on this Mac and never printed. The key itself is not printed either
# unless the email could not be sent (then it is shown once so you can send it yourself).
set -euo pipefail
cd "$(dirname "$0")/.."
TIER="${1:?tier: pro or ultimate}"; EMAIL="${2:?email address}"; NOTE="${3:-}"; INTRO_FILE="${4:-}"
SERVER=$(python3 -c "import json; print(json.load(open('web/api.json'))['licenseServer'])")
BODY=$(TIER="$TIER" EMAIL="$EMAIL" NOTE="$NOTE" INTRO_FILE="$INTRO_FILE" python3 -c '
import json, os
b = {"tier": os.environ["TIER"], "email": os.environ["EMAIL"], "note": os.environ["NOTE"]}
f = os.environ["INTRO_FILE"]
if f: b["intro"] = open(f).read().strip()
print(json.dumps(b))')
RESP=$(curl -s -X POST "$SERVER/admin/issue" -H "Authorization: Bearer $(cat private/admin-token.txt)" -H 'content-type: application/json' -d "$BODY")
RESP="$RESP" python3 -c '
import json, os
try: r = json.loads(os.environ["RESP"])
except Exception: print("Unexpected answer from the server:", os.environ["RESP"][:200]); raise SystemExit(1)
if "key" not in r: print("Not issued:", r); raise SystemExit(1)
print("Key", r.get("keyId", "?"), "made. Emailed:", r.get("emailed"))
if not r.get("emailed"): print("The email was NOT sent. Send this key yourself:", r["key"])'
