# Litematic Viewer: common tasks. Run `make` or `make help` for the list.
#
# Variables (override on the command line, e.g. `make start DIR=~/schematics PORT=9000`):
#   DIR   folder with .litematic files, searched recursively (default: ./schematics)
#   PORT  HTTP port (default: 8765)
#   ARGS  extra server flags, e.g. ARGS=--no-browser
#   JAR   minecraft-assets version or client jar for `make assets` (default: newest version)
#   DOCKER  container CLI for the proto tools (default: docker)

BUN  ?= bun
PORT ?= 8765
DIR  ?=
ARGS ?=
JAR  ?=

SERVER_ARGS = $(if $(DIR),"$(DIR)") --port $(PORT) $(ARGS)

# Protobuf code generation runs in Docker (docker/protogen.Dockerfile), so no buf or
# protoc-gen-es install is needed. Changing a version here builds a new image.
DOCKER                ?= docker
BUF_VERSION           := 1.75.0
PROTOC_GEN_ES_VERSION := 2.16.0
NODE_IMAGE            := node:22.23.3-alpine
PROTOGEN_IMAGE        := litematic-viewer-protogen:buf$(BUF_VERSION)-es$(PROTOC_GEN_ES_VERSION)
# Run as the host user so generated files aren't owned by root.
BUF = $(DOCKER) run --rm --user "$$(id -u):$$(id -g)" -v "$(CURDIR)":/workspace $(PROTOGEN_IMAGE)

.DEFAULT_GOAL := help
.PHONY: help install start dev build generate proto-check protogen-image assets test typecheck lint check clean

help: ## Show this help
	@awk 'BEGIN { FS = ":.*## " } /^[a-z-]+:.*## / { printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

node_modules: package.json bun.lock
	$(BUN) install
	@touch node_modules

install: node_modules ## Install dependencies

start: node_modules ## Build the client and serve DIR, opening the browser
	$(BUN) src/server/index.ts $(SERVER_ARGS)

dev: node_modules ## Serve DIR; rebuild the client on changes, restart on server changes
	$(BUN) --watch src/server/index.ts $(SERVER_ARGS) --dev

build: node_modules ## Bundle the client into dist/ (and block assets if missing or outdated)
	$(BUN) src/tools/build-assets.ts --if-needed $(JAR)
	$(BUN) run build

generate: protogen-image ## Lint proto/ and regenerate src/gen/ (in Docker)
	$(BUF) lint
	$(BUF) generate

proto-check: protogen-image ## Fail if src/gen/ is out of date with proto/ (in Docker)
	@tmp=$$(mktemp -d) && trap 'rm -rf "$$tmp"' EXIT && \
	$(DOCKER) run --rm --user "$$(id -u):$$(id -g)" -v "$(CURDIR)":/workspace -v "$$tmp":/out $(PROTOGEN_IMAGE) \
	  generate --output /out && \
	diff -r "$$tmp/src/gen" src/gen && echo "src/gen is up to date"

protogen-image: ## Build the Docker image with buf + protoc-gen-es (once per version)
	@$(DOCKER) image inspect $(PROTOGEN_IMAGE) >/dev/null 2>&1 || \
	$(DOCKER) build -t $(PROTOGEN_IMAGE) -f docker/protogen.Dockerfile \
	  --build-arg BUF_VERSION=$(BUF_VERSION) \
	  --build-arg PROTOC_GEN_ES_VERSION=$(PROTOC_GEN_ES_VERSION) \
	  --build-arg NODE_IMAGE=$(NODE_IMAGE) \
	  docker

assets: node_modules ## Rebuild assets/ (JAR=<version> or JAR=<client.jar> to pick the source)
	$(BUN) src/tools/build-assets.ts $(JAR)

test: node_modules ## Run the tests
	$(BUN) test

typecheck: node_modules ## Type-check everything
	$(BUN) run typecheck

lint: protogen-image ## Lint the .proto files (in Docker)
	$(BUF) lint

check: lint typecheck test ## Lint, type-check and test

clean: ## Remove the built client (dist/)
	rm -rf dist
