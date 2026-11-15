#!/bin/sh
set -eu

if [ -z "${SPECTR_DEVICE_TOKEN:-}" ]; then
  echo "SPECTR_DEVICE_TOKEN is required." >&2
  exit 1
fi

export DISPLAY="${DISPLAY:-:99}"
export SCREEN_SIZE="${SCREEN_SIZE:-1280x800}"
export MOCK_MAC_BROWSER="${MOCK_MAC_BROWSER:-$(command -v spectr-browser || echo "$(dirname "$0")/browser.sh")}"
API_URL="${API_URL:-https://spectr-api.vercel.app}"

rm -f "/tmp/.X${DISPLAY#:}-lock"
Xvfb "$DISPLAY" -screen 0 "${SCREEN_SIZE}x24" -nolisten tcp &
for _ in $(seq 1 50); do
  xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && break
  sleep 0.1
done
fluxbox >/dev/null 2>&1 &

if [ -n "${VNC_PASSWORD:-}" ]; then
  x11vnc -storepasswd "$VNC_PASSWORD" /tmp/vncpass >/dev/null
  x11vnc -display "$DISPLAY" -rfbauth /tmp/vncpass -localhost -forever -shared -quiet -bg
  websockify --web /usr/share/novnc 6080 localhost:5900 >/dev/null 2>&1 &
  echo "Viewer: http://<host>:6080/vnc.html"
else
  echo "VNC_PASSWORD not set; viewer disabled."
fi

"$MOCK_MAC_BROWSER" about:blank >/dev/null 2>&1 &

cd "${SPECTR_API_DIR:-/app/api}"
while :; do
  node_modules/.bin/tsx scripts/mock-mac.ts --executor desktop --api "$API_URL" || true
  echo "Runner exited; restarting in 5s."
  sleep 5
done
