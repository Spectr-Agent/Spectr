# Build context: services/ (the agent imports ../../api/src).
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY api/package.json api/package-lock.json api/
COPY call-agent/package.json call-agent/package-lock.json call-agent/
RUN cd api && npm ci --include=dev --no-audit --no-fund \
 && cd ../call-agent && npm ci --include=dev --no-audit --no-fund
COPY api/tsconfig.json api/
COPY api/src api/src
COPY call-agent/tsconfig.json call-agent/
COPY call-agent/src call-agent/src
WORKDIR /app/call-agent
CMD ["node_modules/.bin/tsx", "src/main.ts", "start"]
