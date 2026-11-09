ARG NODE_IMAGE=node:22-bookworm-slim
ARG NPM_REGISTRY=https://registry.npmjs.org

FROM ${NODE_IMAGE} AS build
ARG NPM_REGISTRY
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --registry="${NPM_REGISTRY}"
COPY . .
ARG APP_BASE_PATH=/
RUN VITE_BASE_PATH="${APP_BASE_PATH}" npm run build && npm run build:server

FROM ${NODE_IMAGE} AS production-dependencies
ARG NPM_REGISTRY
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --omit=dev --registry="${NPM_REGISTRY}"

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/family-tree.sqlite
WORKDIR /app
COPY --chown=node:node --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.mjs"]
