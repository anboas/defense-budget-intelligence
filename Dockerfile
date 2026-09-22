FROM node:22-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9 AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:cloudflare

FROM node:22-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9 AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force \
    && rm -rf /root/.npm /opt/yarn-v* /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node server ./server
COPY --chown=node:node src/data ./src/data
COPY --chown=node:node src/procurement-taxonomy.js ./src/procurement-taxonomy.js
COPY --chown=node:node src/event-ai-runtime.js ./src/event-ai-runtime.js
COPY --chown=node:node src/event-date-input.js ./src/event-date-input.js
COPY --chown=node:node src/d1-event-store.js ./src/d1-event-store.js
COPY --chown=node:node src/openai-models.js ./src/openai-models.js
COPY --chown=node:node src/security-policy.js ./src/security-policy.js
COPY --chown=node:node src/access-model.js ./src/access-model.js
COPY --chown=node:node src/acquisition-runtime-core.js ./src/acquisition-runtime-core.js
COPY --chown=node:node src/acquisition-delivery-core.js ./src/acquisition-delivery-core.js
COPY --chown=node:node src/registration-core.js ./src/registration-core.js
COPY --chown=node:node src/saas-control-plane-core.js ./src/saas-control-plane-core.js

USER node
EXPOSE 8080

CMD ["node", "server/index.mjs"]
