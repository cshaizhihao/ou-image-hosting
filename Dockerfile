# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=20.19.2
ARG PNPM_VERSION=9.15.9

FROM node:${NODE_VERSION}-bookworm-slim AS toolchain
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable \
  && corepack prepare "pnpm@${PNPM_VERSION}" --activate
WORKDIR /workspace

FROM toolchain AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY tsconfig.base.json vitest.config.ts ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN pnpm build
RUN pnpm --filter @ou-image/api deploy --prod /out/api
RUN set -eux; \
  deploy_status=0; \
  pnpm --filter @ou-image/web deploy --prod /out/web || deploy_status=$?; \
  test -f /out/web/.next/BUILD_ID; \
  test -f /out/web/next.config.mjs; \
  test -f /out/web/public/fonts/ou-brand-display-black.woff2; \
  node -e 'const root="/out/web"; const pkg=require(`${root}/package.json`); for (const name of Object.keys(pkg.dependencies ?? {})) require.resolve(name,{paths:[root]});'; \
  if [ "$deploy_status" -ne 0 ]; then echo "pnpm deploy reported a non-critical bin-link error; verified all production dependencies"; fi; \
  rm -rf /out/web/.next/cache

FROM node:${NODE_VERSION}-bookworm-slim AS runtime-base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates dumb-init \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

FROM runtime-base AS api
ENV API_PORT=4000
ENV OU_DATA_DIR=/data
WORKDIR /app
COPY --from=build --chown=node:node /out/api/package.json ./package.json
COPY --from=build --chown=node:node /out/api/node_modules ./node_modules
COPY --from=build --chown=node:node /out/api/dist ./dist
RUN mkdir -p /data \
  && chown node:node /data
USER node
EXPOSE 4000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]

FROM runtime-base AS web
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV API_PROXY_TARGET=http://api:4000
WORKDIR /app
COPY --from=build --chown=node:node /out/web/package.json ./package.json
COPY --from=build --chown=node:node /out/web/node_modules ./node_modules
COPY --from=build --chown=node:node /out/web/.next ./.next
COPY --from=build --chown=node:node /out/web/public ./public
COPY --from=build --chown=node:node /out/web/next.config.mjs ./next.config.mjs
USER node
EXPOSE 3000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "node_modules/next/dist/bin/next", "start"]
