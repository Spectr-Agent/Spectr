#!/bin/bash
# DEVELOPMENT ONLY. Prints a one-time sign-in code for an email address without sending
# an email, so you can sign in to the iPhone app while Supabase's built-in mailer is
# rate-limited (2 emails per hour on the free plan).
#
# Uses the project's secret key from ~/.config/spectr/dev.env. That key never goes in
# the app or the repo. In the app: type the email, tap "I already have a code", enter it.
#
# Usage: apps/ios/Scripts/dev-signin-code.sh you@example.com
set -euo pipefail

EMAIL="${1:?Usage: dev-signin-code.sh <email>}"
ENV_FILE="${SPECTR_DEV_ENV:-$HOME/.config/spectr/dev.env}"
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE (needs SUPABASE_URL and SUPABASE_SECRET_KEY)" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
: "${SUPABASE_URL:?SUPABASE_URL not set in $ENV_FILE}"
: "${SUPABASE_SECRET_KEY:?SUPABASE_SECRET_KEY not set in $ENV_FILE}"

BODY=$(EMAIL="$EMAIL" python3 -c 'import json,os; print(json.dumps({"type":"magiclink","email":os.environ["EMAIL"]}))')
RESPONSE=$(curl -sS -m 30 -X POST "$SUPABASE_URL/auth/v1/admin/generate_link" \
  -H "apikey: $SUPABASE_SECRET_KEY" -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
  -H "Content-Type: application/json" --data "$BODY")

python3 -c '
import json, sys
data = json.loads(sys.argv[1])
code = data.get("email_otp")
if not code:
    sys.exit("Supabase did not return a code: " + str(data.get("msg") or data.get("message") or data))
print("Sign-in code:", code)
print("Valid for one hour, single use. In the app: enter the email, tap \"I already have a code\".")
' "$RESPONSE"
