import { beforeAll, describe, expect, test } from 'bun:test';
import { create, toBinary } from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createViewerClient } from '../src/client/api.ts';
import { ParseSchematicRequestSchema } from '../src/gen/litematic/v1/viewer_pb.ts';
import { decodePng } from '../src/server/png.ts';
import { createApp } from '../src/server/app.ts';
import { MAX_REQUEST_BYTES } from '../src/server/rpc.ts';
import { fromProto } from '../src/shared/schematic-proto.ts';
import { makeLitematic, tempDir } from './helpers.ts';

let app: ReturnType<typeof createApp>;
let client: ReturnType<typeof createViewerClient>;

/** Expect `promise` to fail with a ConnectError carrying `code`. */
async function expectCode(promise: Promise<unknown>, code: Code): Promise<ConnectError> {
  try {
    await promise;
  } catch (e) {
    const err = ConnectError.from(e);
    expect(Code[err.code]).toBe(Code[code]);
    return err;
  }
  throw new Error(`expected ${Code[code]}, but the call succeeded`);
}

beforeAll(() => {
  const root = tempDir();
  const schematics = join(root, 'schematics');
  mkdirSync(join(schematics, 'farms'), { recursive: true });
  const preview = Array.from({ length: 4 * 4 }, (_, i) => (0xff << 24) | (i * 16));
  writeFileSync(join(schematics, 'farms', 'Blaze Farm.litematic'),
    makeLitematic([2, 1, 1], [{ x: 0, y: 0, z: 0, name: 'minecraft:stone' }], { name: 'Blaze Farm', author: 'me', preview }));
  writeFileSync(join(schematics, 'broken.litematic'), 'not nbt');
  writeFileSync(join(root, 'secret.txt'), 'outside the schematics folder');

  const clientDir = join(root, 'dist');
  mkdirSync(clientDir);
  writeFileSync(join(clientDir, 'index.html'), '<div id="app"></div>');
  const assets = join(root, 'assets');
  mkdirSync(assets);
  writeFileSync(join(assets, 'blocks.json'), '{}');

  app = createApp({ schematicsDir: schematics, clientDir, assetsDir: assets });
  // The real browser transport, wired to the app in-process.
  client = createViewerClient(createConnectTransport({
    baseUrl: 'http://localhost/rpc',
    useBinaryFormat: true,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      app.request(input instanceof Request ? input : String(input), init)) as typeof fetch,
  }));
});

describe('ViewerService', () => {
  test('lists schematics with metadata', async () => {
    const { files } = await client.listSchematics({});
    const farm = files.find((f) => f.path === 'farms/Blaze Farm.litematic')!;
    expect(farm).toMatchObject({ name: 'Blaze Farm', author: 'me', blocks: 1, preview: true });
    expect(farm.dims).toMatchObject({ x: 2, y: 1, z: 1 });
    expect(farm.md5).toMatch(/^[0-9a-f]{32}$/);
    expect(farm.error).toBeUndefined();
    expect(files.find((f) => f.path === 'broken.litematic')?.error).toBeTruthy();
  });

  test('parses schematics from the folder', async () => {
    const { schematic } = await client.getSchematic({ path: 'farms/Blaze Farm.litematic' });
    const s = fromProto(schematic!);
    expect(s.dims).toEqual([2, 1, 1]);
    expect(s.palette[s.grid[0]].name).toBe('stone');
    expect(s.grid[1]).toBe(0);
    expect(s.meta).toMatchObject({ name: 'Blaze Farm', author: 'me' });
    expect(s.materials).toEqual([['stone', 1]]);
  });

  test('parses uploads and rejects unreadable files', async () => {
    const data = makeLitematic([1, 1, 1], [{ x: 0, y: 0, z: 0, name: 'minecraft:dirt' }]);
    expect(fromProto((await client.parseSchematic({ data })).schematic!).materials).toEqual([['dirt', 1]]);

    const err = await expectCode(client.parseSchematic({ data: new TextEncoder().encode('garbage') }), Code.InvalidArgument);
    expect(err.rawMessage).toContain('Could not read schematic');
  });

  test('includes the saved mob in uploaded spawners', async () => {
    const data = makeLitematic([1, 1, 1], [{ x: 0, y: 0, z: 0, name: 'minecraft:spawner' }], {
      tileEntities: [{ x: 0, y: 0, z: 0, SpawnData: { entity: { id: 'minecraft:blaze' } } }],
    });
    const s = fromProto((await client.parseSchematic({ data })).schematic!);
    expect(s.spawners).toEqual([{ pos: [0, 0, 0], entity: 'minecraft:blaze' }]);
  });

  test('rejects uploads over the size limit', async () => {
    await expectCode(client.parseSchematic({ data: new Uint8Array(MAX_REQUEST_BYTES + 1) }), Code.ResourceExhausted);
  });

  test('refuses paths outside the schematics folder', async () => {
    for (const path of ['../secret.txt', '/etc/passwd', 'farms/../../secret.txt', 'missing.litematic']) {
      await expectCode(client.getSchematic({ path }), Code.NotFound);
      expect((await app.request(`/api/preview?p=${encodeURIComponent(path)}`)).status).toBe(404);
    }
    expect((await app.request('/%2e%2e/secret.txt')).status).toBe(404);
    expect((await app.request('/assets/..%2fsecret.txt')).status).toBe(404);
  });

  test('gzips large replies when the client accepts it', async () => {
    const data = makeLitematic([40, 40, 40], [{ x: 3, y: 4, z: 5, name: 'minecraft:stone' }]);
    // Raw Connect unary call, as a browser sends it (Accept-Encoding is added by the browser).
    const res = await app.request('/rpc/litematic.v1.ViewerService/ParseSchematic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/proto', 'Connect-Protocol-Version': '1', 'Accept-Encoding': 'gzip' },
      body: toBinary(ParseSchematicRequestSchema, create(ParseSchematicRequestSchema, { data })),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/proto');
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect((await res.arrayBuffer()).byteLength).toBeLessThan(2000); // 128 KB of mostly-air grid
  });
});

describe('http', () => {
  test('serves previews', async () => {
    const png = await app.request(`/api/preview?p=${encodeURIComponent('farms/Blaze Farm.litematic')}`);
    expect(png.headers.get('content-type')).toBe('image/png');
    const img = decodePng(new Uint8Array(await png.arrayBuffer()));
    expect([img.width, img.height]).toEqual([4, 4]);
    expect([...img.data.slice(4, 8)]).toEqual([0, 0, 16, 255]); // ARGB 0xff000010 -> RGBA
  });

  test('serves the client and assets', async () => {
    expect(await (await app.request('/')).text()).toContain('id="app"');
    expect((await app.request('/assets/blocks.json')).status).toBe(200);
  });
});
