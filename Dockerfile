# Litematic Viewer in a container. Mount your .litematic files at /schematics
# (see docker-compose.yml).

ARG BUN_IMAGE=oven/bun:1.4.3-slim

# Build the client bundle and the block assets (from the minecraft-assets package).
FROM ${BUN_IMAGE} AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN bun src/tools/build-assets.ts && bun run build

# Serve them with only the runtime dependencies.
FROM ${BUN_IMAGE}
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets

USER bun
EXPOSE 8765
ENTRYPOINT ["bun", "src/server/index.ts", "--prebuilt"]
CMD ["/schematics", "--host", "0.0.0.0", "--port", "8765", "--no-browser"]
