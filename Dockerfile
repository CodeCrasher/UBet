# ── build stage: install deps, compile better-sqlite3, build the client ──
FROM node:20-bookworm-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
# postinstall generates fixtures.json; build compiles the Preact client to /dist
RUN npm ci && npm run build && npm prune --omit=dev

# ── run stage: slim image with only prod deps + built artifacts ──
FROM node:20-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/package.json ./package.json
EXPOSE 8080
# DATABASE_PATH defaults to /app/data/ubet.db — mount a volume there on Railway
# so pool data survives redeploys.
CMD ["node", "server/index.js"]
