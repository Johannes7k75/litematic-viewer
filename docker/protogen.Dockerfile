# Code generator for proto/ -> src/gen: buf plus the protobuf-es plugin, at pinned versions.
# Built and run by the Makefile (`make generate`, `make lint`, `make proto-check`), which
# passes the versions as build args.

ARG BUF_VERSION=1.75.0
ARG NODE_IMAGE=node:22.23.3-alpine

FROM bufbuild/buf:${BUF_VERSION} AS buf

FROM ${NODE_IMAGE}
ARG PROTOC_GEN_ES_VERSION=2.16.0
RUN npm install --global --no-fund --no-audit "@bufbuild/protoc-gen-es@${PROTOC_GEN_ES_VERSION}" \
 && npm cache clean --force
COPY --from=buf /usr/local/bin/buf /usr/local/bin/buf

# The Makefile runs this as the host user, so keep buf's cache somewhere writable.
ENV BUF_CACHE_DIR=/tmp/buf-cache
WORKDIR /workspace
ENTRYPOINT ["buf"]
