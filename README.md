# Litematic Viewer

A local 3D viewer for [Litematica](https://github.com/maruohon/litematica) `.litematic`
schematics, rendered with the real block textures and models from your own Minecraft client jar.

Point it at a folder, open your browser, and browse every schematic you have, with no
Minecraft instance running.

Built with [Bun](https://bun.sh), [Hono](https://hono.dev), [ConnectRPC](https://connectrpc.com),
[SolidJS](https://www.solidjs.com) and [three.js](https://threejs.org).

## Features

- **Schematic browser**: every `.litematic` in a folder (searched recursively), with Litematica
  preview thumbnails, search and duplicate hiding
- **Textured 3D render** using vanilla block models: stairs, slabs, redstone, rails, glass,
  water and lava, chests (single, double, trapped, ender, copper) and more
- **Layer slicing**: show a range of layers or a single one (`PageUp` / `PageDown`)
- **Block inspector**: hover a block to see its name, block state and coordinates
- **Material list** with stack and shulker box counts, and CSV copy
- **Mob spawner previews**: a small textured model of the spawner's mob
- **Drag and drop** a `.litematic` onto the view to open it without copying it into the folder

| Key | Action             |
| --- | ------------------ |
| `R` | Reset camera       |
| `M` | Toggle materials   |
| `PageUp` / `PageDown` | Move the layer slice |

## Requirements

The viewer doesn't ship any Minecraft assets. On first start it builds a texture atlas from a
Minecraft **client jar** on your machine. It finds the newest jar automatically in:

- Prism Launcher: `~/.local/share/PrismLauncher/libraries/com/mojang/minecraft`
  (or the Flatpak equivalent)
- The vanilla launcher: `~/.minecraft/versions`
- Any folder you set in `MINECRAFT_DIR` (a folder of `<version>/<jar>` dirs)

You can also pass a jar directly with `bun run build:assets path/to/client.jar`.

## Quick start with Docker

You only need Docker with Compose.

```sh
git clone https://github.com/Johannes7k75/litematic-viewer.git
cd litematic-viewer
docker compose up -d
```

Open <http://127.0.0.1:8765/>. The first start takes a few seconds longer while the block
assets are built. They are kept in a Docker volume, so later starts are quick.

By default this serves `./schematics` and reads jars from `~/.minecraft/versions`. Change
either with environment variables or a `.env` file next to `docker-compose.yml`:

```sh
# .env
SCHEMATICS_DIR=/path/to/your/schematics
MINECRAFT_DIR=/home/you/.local/share/PrismLauncher/libraries/com/mojang/minecraft
PORT=8765
```

| Variable         | Default                   | Description                                           |
| ---------------- | ------------------------- | ----------------------------------------------------- |
| `SCHEMATICS_DIR` | `./schematics`            | Folder with `.litematic` files (mounted read-only)    |
| `MINECRAFT_DIR`  | `~/.minecraft/versions`   | Folder of Minecraft version dirs with client jars     |
| `PORT`           | `8765`                    | Host port; only published on `127.0.0.1`              |

After updating the code, run `docker compose up -d --build`. To rebuild the block assets (for
example after a Minecraft update), remove the volume: `docker compose down -v`.

## Running from source

Install [Bun](https://bun.sh) 1.4 or newer, then:

```sh
bun install
bun start                    # serve ./schematics
bun start /some/folder       # or any folder (searched recursively)
```

This opens <http://127.0.0.1:8765/> in your browser. The server only listens on localhost.

| Option          | Default     | Description                                      |
| --------------- | ----------- | ------------------------------------------------ |
| `--port`        | `8765`      | HTTP port                                        |
| `--host`        | `127.0.0.1` | Address to listen on                             |
| `--no-browser`  |             | Don't open a browser tab                         |
| `--dev`         |             | Rebuild the client on changes (see Development)  |

### Gathering your schematics

Schematics usually end up spread across many launcher instances. `collect` copies every
`.litematic` it finds into `./schematics/<instance>/…`, skipping identical copies and the
Windows recycle bin:

```sh
bun run collect ~/.local/share/PrismLauncher/instances /mnt/windows/Users/you
```

## How it works

```
proto/          API schema (litematic.v1.ViewerService)
docker/         Image for protobuf code generation (buf + protoc-gen-es)
src/gen/        Generated protobuf/Connect TypeScript (do not edit)
src/shared/     Shared types; conversion between the wire schematic and the in-memory grid
src/server/     Hono app, Connect service, .litematic parsing, schematic index, PNG helpers
src/client/     Solid components, three.js viewer, mesher (runs in a Web Worker)
src/tools/      Asset builder, chest and mob models, client build, collect
tests/          bun test suites
```

The asset builder extracts blockstates, models and textures from the client jar into
`assets/atlas.png` and `assets/blocks.json`. Block names, shapes and tints come from
[minecraft-data](https://github.com/PrismarineJS/minecraft-data) at build time. The browser
receives the parsed block grid over RPC and meshes it in a Web Worker.

### API

The browser talks to the server through `litematic.v1.ViewerService`, defined in
[`proto/litematic/v1/viewer.proto`](proto/litematic/v1/viewer.proto) and served with ConnectRPC
under `/rpc` (binary protobuf, gzip for large replies).

| RPC              | Description                                        |
| ---------------- | -------------------------------------------------- |
| `ListSchematics` | All schematics in the served folder, with metadata |
| `GetSchematic`   | Parse one of them into a block grid                |
| `ParseSchematic` | Parse an uploaded file (drag and drop)             |

It is plain HTTP, so you can call it with curl too (JSON instead of protobuf):

```sh
curl -H 'Content-Type: application/json' -d '{"path":"farms/Blaze Farm.litematic"}' \
  http://127.0.0.1:8765/rpc/litematic.v1.ViewerService/GetSchematic
```

Thumbnails are a plain URL (`/api/preview?p=<path>`) so they work as `<img src>`.

### Limitations

- Blocks that Minecraft draws with entity renderers and that have no block model (heads, shulker
  boxes, decorated pots, banners) are drawn as textured boxes in the shape of their collision
  box. Chests are rebuilt from the chest entity model.
- Spawner previews cover zombies, husks, drowned, skeletons, strays, wither skeletons, bogged,
  spiders, cave spiders, blazes, silverfish, magma cubes, slimes, pigs and creepers. Other mobs
  and empty spawners show the cage only.

## Development

```sh
make                              # list all targets
make dev                          # rebuild the client and restart the server on changes
make check                        # buf lint, type-check and tests (run before committing)
make start DIR=~/schematics       # build and serve a folder
make generate                     # lint proto/ and regenerate src/gen/ (Docker)
make proto-check                  # fail if src/gen/ is stale (Docker)
make assets JAR=path/to/client.jar  # rebuild assets/ from a specific jar
```

Make variables: `DIR` (schematics folder), `PORT` (default 8765), `ARGS` (extra server flags,
for example `ARGS=--no-browser`) and `JAR` (for `make assets`). In `make dev`, reload the page
after a client rebuild.

Equivalent `bun run` scripts exist for most targets: `start`, `dev`, `build`, `build:assets`,
`generate`, `collect`, `typecheck`, `test` and `lint:proto`.

After editing the `.proto`, run `make generate`. It runs [buf](https://buf.build) and
[protoc-gen-es](https://github.com/bufbuild/protobuf-es) in Docker with versions pinned in the
`Makefile`, so nothing extra needs installing. The generated files are committed, and
`bun test` runs `make proto-check` when Docker is available.

## Disclaimer

Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.
Minecraft assets are read from your own copy of the game and are never redistributed.
