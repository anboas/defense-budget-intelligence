FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:cloudflare

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node server ./server
COPY --chown=node:node src/data ./src/data
COPY --chown=node:node src/procurement-taxonomy.js ./src/procurement-taxonomy.js
COPY --chown=node:node src/event-ai-runtime.js ./src/event-ai-runtime.js
COPY --chown=node:node src/openai-models.js ./src/openai-models.js
COPY --chown=node:node src/security-policy.js ./src/security-policy.js

USER node
EXPOSE 8080

CMD ["node", "server/index.mjs"]
