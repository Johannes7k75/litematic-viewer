# Litematic Viewer in a container. See docker-compose.yml for the volumes it expects:
# /schematics (your .litematic files) and /minecraft (Minecraft version folders with client jars).

FROM oven/bun:1.4.3-slim
WORKDIR /app

# Dev dependencies are needed at runtime: the client is bundled and the block assets are built
# (with minecraft-data) when the server starts.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY proto ./proto
COPY src ./src
# assets/ is a volume so the atlas is built once from your jar and survives restarts.
RUN mkdir -p assets schematics && chown -R bun:bun /app

USER bun
ENV MINECRAFT_DIR=/minecraft
EXPOSE 8765
VOLUME ["/app/assets"]
ENTRYPOINT ["bun", "src/server/index.ts"]
CMD ["/schematics", "--host", "0.0.0.0", "--port", "8765", "--no-browser"]
