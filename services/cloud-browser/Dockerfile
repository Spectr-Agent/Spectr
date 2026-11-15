# Build context: services/ (runs api/scripts/mock-mac.ts with the desktop executor).
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    ca-certificates chromium fluxbox fonts-liberation fonts-noto-color-emoji \
    imagemagick novnc scrot websockify x11-utils x11vnc xdotool xvfb \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app/api
COPY api/package.json api/package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY api/tsconfig.json ./
COPY api/src src
COPY api/scripts/mock-mac.ts scripts/mock-mac.ts
COPY cloud-browser/entrypoint.sh /usr/local/bin/spectr-entrypoint
COPY cloud-browser/browser.sh /usr/local/bin/spectr-browser
RUN sed -i 's/\r$//' /usr/local/bin/spectr-entrypoint /usr/local/bin/spectr-browser \
 && chmod +x /usr/local/bin/spectr-entrypoint /usr/local/bin/spectr-browser \
 && useradd --create-home --uid 1001 spectr \
 && mkdir -p /data /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix && chown spectr:spectr /data
USER spectr
ENV DISPLAY=:99 \
    SCREEN_SIZE=1280x800 \
    API_URL=https://spectr-api.vercel.app \
    MOCK_MAC_BROWSER=/usr/local/bin/spectr-browser
VOLUME /data
EXPOSE 6080
CMD ["spectr-entrypoint"]
