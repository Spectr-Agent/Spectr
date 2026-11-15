#!/bin/sh
# Starts Spectr in the background inside a Coder workspace. Logs: ~/spectr-cloud.log
set -eu
here=$(cd "$(dirname "$0")" && pwd)
env_file="$HOME/.config/spectr/cloud.env"
log="$HOME/spectr-cloud.log"

[ -f "$env_file" ] || { echo "Run coder-setup.sh first." >&2; exit 1; }
set -a
. "$env_file"
set +a

pkill -f "cloud-browser/entrypoint.sh" 2>/dev/null || true
pkill -f "scripts/mock-mac.ts" 2>/dev/null || true
pkill -x Xvfb 2>/dev/null || true
pkill -x x11vnc 2>/dev/null || true
pkill -f "websockify.*6080" 2>/dev/null || true
sleep 1

export SPECTR_API_DIR="$here/../api"
export SPECTR_DATA_DIR="$HOME/.spectr-data"
mkdir -p "$SPECTR_DATA_DIR"
nohup sh "$here/entrypoint.sh" >"$log" 2>&1 &
echo "Spectr started. Logs: tail -f $log"
