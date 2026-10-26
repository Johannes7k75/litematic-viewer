// ConnectRPC implementation of litematic.v1.ViewerService, mounted into the Hono app.

import { create } from '@bufbuild/protobuf';
import { Code, ConnectError, createConnectRouter, type ConnectRouter } from '@connectrpc/connect';
import { createFetchHandler, type Compression } from '@connectrpc/connect/protocol';
import type { Hono } from 'hono';
import {
  GetSchematicResponseSchema,
  ListSchematicsResponseSchema,
  ParseSchematicResponseSchema,
  ViewerService,
  type Schematic,
} from '../gen/litematic/v1/viewer_pb.ts';
import { toProto } from '../shared/schematic-proto.ts';
import { parseLitematic } from './litematic.ts';
import type { SchematicIndex } from './schematics.ts';

/** Largest accepted request (drag-and-drop uploads). */
export const MAX_REQUEST_BYTES = 64 * 1024 * 1024;

/** gzip for Connect's compression negotiation; browsers request it via Accept-Encoding. */
export const gzip: Compression = {
  name: 'gzip',
  compress: async (bytes) => Bun.gzipSync(bytes as Uint8Array<ArrayBuffer>, { level: 1 }),
  decompress: async (bytes, readMaxBytes) => {
    const out = Bun.gunzipSync(bytes as Uint8Array<ArrayBuffer>);
    if (out.byteLength > readMaxBytes) {
      throw new ConnectError(`message larger than ${readMaxBytes} bytes`, Code.ResourceExhausted);
    }
    return out;
  },
};

function parse(bytes: Uint8Array): Schematic {
  try {
    return toProto(parseLitematic(bytes));
  } catch (e) {
    throw new ConnectError(`Could not read schematic: ${e instanceof Error ? e.message : String(e)}`, Code.InvalidArgument);
  }
}

export function createViewerRouter(index: SchematicIndex): ConnectRouter {
  const router = createConnectRouter({
    acceptCompression: [gzip],
    // Block grids are mostly air and shrink ~100x; tiny replies aren't worth compressing.
    compressMinBytes: 1024,
    readMaxBytes: MAX_REQUEST_BYTES,
  });
  router.service(ViewerService, {
    listSchematics: () => create(ListSchematicsResponseSchema, { root: index.root, files: index.list() }),
    getSchematic: ({ path }) => {
      const rel = index.resolve(path);
      if (!rel) throw new ConnectError(`No schematic at "${path}"`, Code.NotFound);
      return create(GetSchematicResponseSchema, { schematic: parse(index.read(rel)) });
    },
    parseSchematic: ({ data }) => create(ParseSchematicResponseSchema, { schematic: parse(data) }),
  });
  return router;
}

/** Route every Connect handler (GET and POST) under `prefix` through Hono. */
export function mountConnect(app: Hono, router: ConnectRouter, prefix = '/rpc'): void {
  for (const handler of router.handlers) {
    const fetchHandler = createFetchHandler(handler);
    app.on(['GET', 'POST'], prefix + handler.requestPath, (c) => fetchHandler(c.req.raw));
  }
}
