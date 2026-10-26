# Litematic Viewer

Local 3D viewer for Litematica `.litematic` schematics, rendered with the real block
textures and models from your installed Minecraft client jar.

TypeScript on [Bun](https://bun.sh): a [Hono](https://hono.dev) server and a
[SolidJS](https://www.solidjs.com) + [three.js](https://threejs.org) client.

## Run

    bun install
    bun start                    # views ./schematics
    bun start /some/folder       # or any folder (searched recursively)

It opens http://127.0.0.1:8765/ (localhost only). Options: `--port 8765`, `--no-browser`.
On first start the block assets are built from the newest Minecraft jar found in
Prism Launcher (native or Flatpak) or `~/.minecraft`; the client is rebuilt on every start.

## Gather all your schematics (optional)

    bun run collect /run/media/jonas/Games /run/media/jonas/Windows/Users/Jonas

Copies every `.litematic` into `./schematics/<instance>/…`, skipping identical copies and the
Windows recycle bin.

## Features

- File list with Litematica preview thumbnails, search, and duplicate hiding
- Textured 3D render: stairs, slabs, redstone, rails, glass, water, chests (single, double,
  trapped, ender, copper), …
- Layer slicing (range or single layer, PageUp / PageDown)
- Hover a block for its name, block state and coordinates
- Material list with stack / shulker box counts and CSV copy
- Drag and drop a `.litematic` onto the view to open it
- Keys: `R` reset camera, `M` toggle materials

## API

The browser talks to the server through `litematic.v1.ViewerService`, defined in
[`proto/litematic/v1/viewer.proto`](proto/litematic/v1/viewer.proto) and served with
[ConnectRPC](https://connectrpc.com) under `/rpc` (binary protobuf, gzip for large replies).
TypeScript for both sides is generated into `src/gen/` by [protobuf-es](https://github.com/bufbuild/protobuf-es).

| RPC              | What it does                                         |
| ---------------- | ---------------------------------------------------- |
| `ListSchematics` | All schematics in the served folder, with metadata   |
| `GetSchematic`   | Parse one of them into a block grid                  |
| `ParseSchematic` | Parse an uploaded file (drag and drop)               |

It is plain HTTP, so it can be called with curl too (JSON instead of protobuf):

    curl -H 'Content-Type: application/json' -d '{"path":"farms/Blaze Farm.litematic"}' \
      http://127.0.0.1:8765/rpc/litematic.v1.ViewerService/GetSchematic

Thumbnails stay a plain URL (`/api/preview?p=<path>`) so they work as `<img src>`.
After editing the `.proto`, run `make generate`. It runs [buf](https://buf.build) and
protoc-gen-es in Docker (`docker/protogen.Dockerfile`, versions pinned in the `Makefile`), so
nothing extra needs installing. The generated files are committed; `make proto-check` (also run
by `bun test` when Docker is available) fails if they are stale.

## Make

    make                                  # list all targets
    make start DIR=~/schematics           # build and serve, opens the browser
    make dev                              # rebuild client on change, restart server on change
    make build                            # bundle the client (and block assets if missing)
    make generate                         # lint proto/ and regenerate src/gen/ (Docker)
    make proto-check                      # is src/gen/ up to date? (Docker)
    make check                            # lint, type-check and test

Variables: `DIR` (schematics folder, default `./schematics`), `PORT` (default 8765),
`ARGS` (extra server flags, e.g. `ARGS=--no-browser`), `JAR` (for `make assets`).
In `make dev`, reload the page after a client rebuild.

## Scripts

| Command                  | What it does                                            |
| ------------------------ | ------------------------------------------------------- |
| `bun start [dir]`        | Build the client and serve `dir`                        |
| `bun run dev`            | Like start, with client rebuild and server restart on changes |
| `bun run build`          | Bundle the client into `dist/`                          |
| `bun run build:assets [jar]` | Rebuild `assets/` from a Minecraft jar (newest by default) |
| `bun run generate`       | Same as `make generate` (Docker)                        |
| `bun run lint:proto`     | Same as `make lint`: `buf lint` in Docker               |
| `bun run collect …`      | Copy schematics into `./schematics`                     |
| `bun test`               | Run the tests                                           |
| `bun run typecheck`      | Type-check everything                                   |

## Layout

    proto/          API schema (litematic.v1.ViewerService)
    docker/         Image for protobuf code generation (buf + protoc-gen-es)
    src/gen/        Generated protobuf/Connect TypeScript (do not edit)
    src/shared/     Shared types; conversion between the wire Schematic and the in-memory grid
    src/server/     Hono app, Connect service (rpc.ts), .litematic parsing (prismarine-nbt),
                    schematic index, PNG helpers (fast-png)
    src/client/     Solid components (.tsx), three.js viewer, mesher (runs in a Web Worker)
    src/tools/      Asset builder (fflate + fast-png), chest models, client build, collect;
                    block names, tints and shapes from minecraft-data (build time only)
    tests/          bun test suites

Blocks that Minecraft draws with entity renderers and that have no block model (heads,
shulker boxes, decorated pots, banners) appear as textured boxes shaped like their collision
boxes. Chests are rebuilt from the chest entity model.

Mob spawners show a static textured miniature of their saved mob. Previews cover zombies,
husk, drowned, skeletons, stray, wither skeleton, bogged, spiders, cave spiders, blazes,
silverfish, magma cubes, slimes, pigs and creepers. Empty spawners and unsupported entities
show the cage only. Mob previews follow the selected layer range.
