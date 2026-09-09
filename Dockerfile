FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY packages/sdk ./packages/sdk
COPY public ./public
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    APP_MODE=local \
    HOST=0.0.0.0 \
    PORT=4174 \
    RUNTIME_PORT=4175 \
    DB_PATH=/app/.data/platform.sqlite \
    STORAGE_PATH=/app/.data
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node packages ./packages
COPY --chown=node:node examples ./examples
COPY --chown=node:node scripts/docker-healthcheck.mjs ./scripts/docker-healthcheck.mjs
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node
EXPOSE 4174 4175
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "scripts/docker-healthcheck.mjs"]
CMD ["node", "server/index.mjs"]
