# SudsQueue: one container, one SQLite file on a volume at /data.
FROM node:24-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/shared shared
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/src server/src
COPY --from=build /app/client/dist client/dist
COPY --from=build /app/config config
EXPOSE 8080
# Runs as root because Fly mounts the /data volume root-owned.
CMD ["node", "--import", "tsx", "server/src/index.ts"]
