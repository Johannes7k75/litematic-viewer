// The browser bundle must not pull in Node built-ins: Bun would silently substitute partial
// polyfills (that is how prismarine-nbt once crashed the worker in Firefox).

import { expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildClient } from '../src/tools/build-client.ts';
import { tempDir } from './helpers.ts';

test('client builds without Node built-ins', async () => {
  const out = tempDir('lv-dist-');
  await buildClient(out);
  const worker = readFileSync(join(out, 'worker.js'), 'utf8');
  const main = readFileSync(join(out, 'main.js'), 'utf8');
  for (const code of [worker, main]) {
    expect(code).not.toContain('globalThis.process');
    expect(code).not.toContain('readable-stream');
  }
  expect(worker.length).toBeLessThan(100_000); // mesher only, no parser
}, 60_000);

test('build fails loudly when browser code imports a Node built-in', async () => {
  const dir = tempDir('lv-bad-');
  const entry = join(dir, 'bad.ts');
  writeFileSync(entry, "import { gzipSync } from 'zlib';\nconsole.log(gzipSync);\n");
  const { noNodeBuiltins } = await import('../src/tools/build-client.ts');
  const result = await Bun.build({ entrypoints: [entry], target: 'browser', plugins: [noNodeBuiltins], throw: false });
  expect(result.success).toBe(false);
  expect(result.logs.map((l) => String(l.message ?? l)).join('\n')).toContain('Node built-in "zlib"');
});
