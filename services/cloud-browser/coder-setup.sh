#!/bin/sh
# One-time setup inside a Coder workspace (Ubuntu/Debian with sudo and Node.js).
set -eu
api_dir=$(cd "$(dirname "$0")/../api" && pwd)

sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  ca-certificates fluxbox fonts-liberation fonts-noto-color-emoji imagemagick \
  novnc scrot websockify wget x11-utils x11vnc xdotool xvfb

if ! command -v google-chrome >/dev/null 2>&1; then
  wget -qO /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y /tmp/google-chrome.deb
  rm -f /tmp/google-chrome.deb
fi

cd "$api_dir" && npm ci --include=dev --no-audit --no-fund

mkdir -p "$HOME/.config/spectr"
if [ ! -f "$HOME/.config/spectr/cloud.env" ]; then
  umask 077
  printf 'SPECTR_DEVICE_TOKEN=\nVNC_PASSWORD=\n' > "$HOME/.config/spectr/cloud.env"
fi
echo "Setup done. Fill in $HOME/.config/spectr/cloud.env, then run coder-start.sh."
