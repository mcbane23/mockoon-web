# syntax=docker/dockerfile:1

# ---- build: install everything, build the server and the web UI ----
# Runs on the build machine's own platform; the output is plain JavaScript.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /src

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY e2e/package.json e2e/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @stubhouse/server... --filter @stubhouse/web...

COPY . .
RUN pnpm --filter @stubhouse/server... --filter @stubhouse/web build

# Server with production dependencies only, next to the built UI
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @stubhouse/server deploy --prod --legacy /out/apps/server \
 && cp -r apps/web/dist /out/apps/web-dist

# ---- runtime ----
FROM node:22-alpine
ENV NODE_ENV=production \
    STUBHOUSE_HOST=0.0.0.0 \
    STUBHOUSE_PORT=3300 \
    STUBHOUSE_DATA_DIR=/data
WORKDIR /app
COPY --from=build --chown=node:node /out/apps/server apps/server
COPY --from=build --chown=node:node /out/apps/web-dist apps/web/dist
COPY LICENSE THIRD_PARTY_NOTICES.md ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
# 3300: the UI and its API; 3001 and up: the mock APIs
EXPOSE 3300 3001-3020
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -q -O /dev/null "http://127.0.0.1:${STUBHOUSE_PORT}/" || exit 1
CMD ["node", "apps/server/dist/index.js"]
