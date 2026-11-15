#!/bin/sh
browser=${CHROME_BIN:-$(command -v chromium || command -v google-chrome)}
exec "$browser" \
  --user-data-dir="${SPECTR_DATA_DIR:-/data}/chrome-profile" \
  --no-sandbox \
  --no-first-run \
  --no-default-browser-check \
  --disable-dev-shm-usage \
  --password-store=basic \
  --start-maximized \
  --window-position=0,0 \
  --window-size="$(echo "${SCREEN_SIZE:-1280x800}" | tr x ,)" \
  "$@"
