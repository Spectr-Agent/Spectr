#!/bin/bash
# Keeps Spectr's Chert FaceTime line connected to the hosted spectr-call agent.
# Started at login by ~/Library/LaunchAgents/dev.spectr.chert.plist; launchd restarts it.
set -euo pipefail
cd "$(dirname "$0")"
set -a
. "$HOME/.config/spectr/dev.env"
set +a
exec ./node_modules/.bin/node ./node_modules/.bin/chert dev --agent spectr-call --project "$CHERT_PROJECT_ID" --takeover
