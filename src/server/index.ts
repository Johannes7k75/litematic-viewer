// Local Litematica schematic viewer.
//
// Usage: bun start [schematics_dir] [--port 8765] [--no-browser] [--dev]
//
// --dev rebuilds the browser bundle whenever client code changes (reload the page to see it)
// and never opens a browser. Run it under `bun --watch` (see `make dev`) so that server
// changes restart the process too.

import { existsSync, statSync, watch } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { ASSETS_DIR, assetsOutdated, buildAssets, PROJECT_DIR } from '../tools/build-assets.ts';
import { buildClient, CLIENT_OUT } from '../tools/build-client.ts';
import { createApp } from './app.ts';

const USAGE = 'Usage: bun start [schematics_dir] [--port 8765] [--no-browser] [--dev]';

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    port: { type: 'string', default: '8765' },
    'no-browser': { type: 'boolean', default: false },
    dev: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const schematicsDir = positionals[0] ?? join(PROJECT_DIR, 'schematics');
if (!existsSync(schematicsDir) || !statSync(schematicsDir).isDirectory()) {
  console.error(`Folder not found: ${schematicsDir}`);
  process.exit(1);
}

if (assetsOutdated()) {
  console.log('Building block assets from your Minecraft jar (missing or outdated)...');
  buildAssets();
}
await buildClient();

const port = Number(values.port);
const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  fetch: createApp({ schematicsDir, clientDir: CLIENT_OUT, assetsDir: ASSETS_DIR }).fetch,
});

const url = `http://127.0.0.1:${server.port}/`;
console.log(`Serving ${schematicsDir}\nOpen ${url}  (Ctrl+C to stop)`);
if (values.dev) watchClient();
else if (!values['no-browser']) {
  try {
    Bun.spawn(['xdg-open', url], { stdout: 'ignore', stderr: 'ignore' });
  } catch {
    // No desktop opener; the URL is printed above.
  }
}

/** Rebuild the client bundle when browser code changes; a failed build keeps the last good one. */
function watchClient(): void {
  const dirs = ['src/client', 'src/shared', 'src/gen'].map((d) => join(PROJECT_DIR, d));
  let timer: Timer | undefined;
  let building = false, again = false;
  const rebuild = async () => {
    if (building) {
      again = true;
      return;
    }

    building = true;
    const t = performance.now();
    try {
      await buildClient();
      console.log(`[dev] client rebuilt in ${Math.round(performance.now() - t)} ms (reload the page)`);
    } catch (e) {
      console.error(`[dev] client build failed:\n${(e as Error).message}`);
    } finally {
      building = false;
      if (again) {
        again = false;
        rebuild();
      }
    }
  };
  for (const dir of dirs) {
    watch(dir, { recursive: true }, (_event, file) => {
      if (!file) return;
      console.log(`[dev] changed ${relative(PROJECT_DIR, join(dir, String(file)))}`);
      clearTimeout(timer);
      timer = setTimeout(rebuild, 100);
    });
  }
  console.log(`[dev] watching ${dirs.map((d) => relative(PROJECT_DIR, d)).join(', ')}`);
}
