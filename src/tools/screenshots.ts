// Captures the README screenshots into docs/screenshots/. Starts its own viewer on a temporary
// folder holding only the chosen schematics, so the file list shows nothing else.
//
// Usage: bun run screenshots [name...]
//   SCHEMATICS  comma-separated .litematic files (relative to ./schematics or absolute); the
//               first one is opened (default: the cathedral and the blaze farm)
//   PORT        port for the temporary viewer (default: 8799)
//   CHROME_BIN  Chrome or Chromium binary (default: /usr/bin/chromium)

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import puppeteer, { type Page } from 'puppeteer-core';

const PROJECT_DIR = join(import.meta.dir, '..', '..');

function resolveSchematicFiles(): string[] {
  if (process.env.SCHEMATICS) {
    return process.env.SCHEMATICS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const schematicsDir = resolve(PROJECT_DIR, 'schematics');
  const found: string[] = [];
  const walk = (d: string) => {
    try {
      for (const ent of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (ent.isFile() && ent.name.toLowerCase().endsWith('.litematic')) {
          found.push(p);
        }
      }
    } catch {
      // unreadable
    }
  };
  walk(schematicsDir);
  return found;
}

const FILES = resolveSchematicFiles();
if (FILES.length === 0) {
  console.error('No .litematic schematics found to take screenshots of.');
  console.error('Place .litematic files in schematics/ or specify SCHEMATICS=path/to/schematic.litematic');
  process.exit(1);
}

const PORT = process.env.PORT ?? '8799';
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_BIN ?? '/usr/bin/chromium';
const OUT = join(PROJECT_DIR, 'docs', 'screenshots');
const WIDTH = 1600, HEIGHT = 900;
const SCHEMATIC = basename(FILES[0]);

const only = process.argv.slice(2);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait for a few rendered frames, so the canvas shows the finished mesh. */
async function settle(page: Page, ms = 1000): Promise<void> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await sleep(ms);
}

/** Load the viewer fresh (default settings) with the schematic open. */
async function open(page: Page): Promise<void> {
  await page.goto('about:blank');
  await page.goto(`${BASE}/#p=${encodeURIComponent(SCHEMATIC)}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.topbar', { timeout: 120_000 });
  await settle(page);
}

/** Zoom the camera by wheel steps over the stage (negative: closer). */
async function zoom(page: Page, steps: number): Promise<void> {
  const box = (await (await page.$('.stage canvas'))!.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < Math.abs(steps); i++) await page.mouse.wheel({ deltaY: Math.sign(steps) * 100 });
  await page.mouse.move(box.x + 5, box.y + 5); // no hover tooltip
  await settle(page, 500);
}

/** Replace the served folder's temporary path. */
async function scrubPaths(page: Page): Promise<void> {
  await page.$eval('.files footer', (el) => (el.textContent = 'schematics'));
}

/** Set a range input the way a drag would (Solid listens for `input`). */
async function setRange(page: Page, selector: string, fraction: number): Promise<void> {
  await page.$eval(selector, (el, f) => {
    const input = el as HTMLInputElement;
    input.value = String(Math.round(+input.max * f));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, fraction);
}

/** One function per screenshot; each leaves the page in the state to capture. */
const shots: Record<string, (page: Page) => Promise<void>> = {
  async viewer(page) {
    await open(page);
    await page.keyboard.press('m');
    await page.keyboard.press('l');
    await settle(page, 2000);
  },
  async materials(page) {
    await open(page);
  },
  async layers(page) {
    await open(page);
    await page.keyboard.press('m');
    await setRange(page, '.layers input[type=range]', 0.2);
    await zoom(page, -3);
    await settle(page, 1500);
  },
  async hover(page) {
    await open(page);
    await page.keyboard.press('m');
    // Walk across the middle of the stage until the pointer is over a block.
    const box = (await (await page.$('.stage canvas'))!.boundingBox())!;
    for (let i = 0; i < 20; i++) {
      await page.mouse.move(box.x + box.width * (0.45 + i * 0.01), box.y + box.height * (0.55 - i * 0.01));
      await sleep(150);
      if (await page.$('.tooltip')) break;
    }
    await page.waitForSelector('.tooltip', { timeout: 2000 });
    await settle(page, 300);
  },
};

/** Serve a temporary copy of FILES and wait until the viewer answers. */
async function startViewer(dir: string) {
  for (const f of FILES) {
    const src = existsSync(f) ? f : resolve(PROJECT_DIR, 'schematics', f);
    if (!existsSync(src)) {
      console.error(`Schematic file not found: ${f}`);
      console.error('Specify existing files with SCHEMATICS=path/to/schematic.litematic');
      process.exit(1);
    }
    copyFileSync(src, join(dir, basename(f)));
  }
  const server = Bun.spawn(['bun', join(PROJECT_DIR, 'src', 'server', 'index.ts'), dir, '--port', PORT, '--no-browser'], {
    stdout: 'ignore', stderr: 'inherit',
  });
  for (let i = 0; i < 240; i++) {
    if (await fetch(BASE).then((r) => r.ok, () => false)) return server;
    if (server.exitCode !== null) break;
    await sleep(500);
  }
  server.kill();
  throw new Error(`viewer did not start on ${BASE}`);
}

const dir = mkdtempSync(join(tmpdir(), 'litematic-screenshots-'));
const server = await startViewer(dir);
const browser = await puppeteer.launch({
  executablePath: CHROME,
  // WebGL without a GPU: SwiftShader works headless everywhere.
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--window-size=${WIDTH},${HEIGHT}`],
  defaultViewport: { width: WIDTH, height: HEIGHT },
});
const page = await browser.newPage();
// The viewer remembers lighting and panels in localStorage; start every shot from the defaults.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.clear();
  } catch {
    // about:blank has no storage
  }
});
mkdirSync(OUT, { recursive: true });

let failed = 0;
for (const [name, run] of Object.entries(shots)) {
  if (only.length && !only.includes(name)) continue;
  try {
    await run(page);
    await scrubPaths(page);
    const png = await page.screenshot({ type: 'png' });
    writeFileSync(join(OUT, `${name}.png`), png);
    console.log(`ok   ${name} (${Math.round(png.length / 1024)} KB)`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${name}: ${(err as Error).message}`);
  }
}
await browser.close();
server.kill();
rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
