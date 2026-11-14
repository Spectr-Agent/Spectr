#!/bin/bash
# Installs the Chert FaceTime connector as a login service on the Spectr Mac.
#
# Why on the Mac: Spectr's Chert line is a Shared line, and Chert only lets Dedicated
# lines route calls to a webhook (services/api/src/facetime is ready for that). On a
# Shared line, `chert dev` must stay connected. The Mac has to be on for Spectr to act
# anyway, so the connector lives there, starts at login and restarts if it stops.
#
# Needs: ~/.config/spectr/dev.env with LIVEKIT_* and CHERT_PROJECT_ID, and a Chert
# sign-in (`chert login`, 30 days). Remove with:
#   launchctl bootout gui/$(id -u)/dev.spectr.chert && rm ~/Library/LaunchAgents/dev.spectr.chert.plist
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
app="$HOME/Library/Application Support/Spectr/chert"
mkdir -p "$app"
cd "$app"
[ -f package.json ] || npm init -y >/dev/null
# The Chert CLI supports Node 22, 24 and 26 only; pin a private Node 24.
npm install --silent --no-audit --no-fund node@24 @trychert/facetime@0.1.0-beta.21
install -m 700 "$here/run.sh" "$app/run.sh"
sed "s#__APP__#$app#g; s#__HOME__#$HOME#g" "$here/dev.spectr.chert.plist" > "$HOME/Library/LaunchAgents/dev.spectr.chert.plist"
launchctl bootout "gui/$(id -u)/dev.spectr.chert" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/dev.spectr.chert.plist"
echo "Started. Log: ~/Library/Logs/spectr-chert.log"
