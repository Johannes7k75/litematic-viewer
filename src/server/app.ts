// HTTP routes: the ViewerService RPC API (/rpc), thumbnails, the built client and block assets.

import { Hono } from 'hono';
import { existsSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { createViewerRouter, mountConnect } from './rpc.ts';
import { SchematicIndex } from './schematics.ts';

export interface AppOptions {
  /** Folder with .litematic files (searched recursively). */
  schematicsDir: string;
  /** Built client (index.html, main.js, ...). */
  clientDir: string;
  /** atlas.png and blocks.json. */
  assetsDir: string;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.map': 'application/json',
};

/** Serve `rel` from `base`, refusing anything that resolves outside it. */
function fileResponse(base: string, rel: string): Response | null {
  const full = join(base, normalize('/' + rel));
  if (!full.startsWith(base + sep) || !existsSync(full) || !statSync(full).isFile()) return null;
  return new Response(Bun.file(full), {
    headers: { 'Content-Type': TYPES[extname(full)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' },
  });
}

export function createApp(opts: AppOptions): Hono {
  const index = new SchematicIndex(opts.schematicsDir);
  const app = new Hono();

  mountConnect(app, createViewerRouter(index));

  // A plain URL rather than an RPC, so the browser can use it as <img src>.
  app.get('/api/preview', (c) => {
    const rel = index.resolve(c.req.query('p'));
    const png = rel && index.previewPng(rel);
    if (!png) return c.text('no preview', 404);
    return c.body(png as Uint8Array<ArrayBuffer>, 200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600' });
  });

  app.get('/assets/*', (c) => fileResponse(opts.assetsDir, c.req.path.slice('/assets/'.length)) ?? c.notFound());

  app.get('*', (c) => {
    const rel = c.req.path === '/' ? 'index.html' : decodeURIComponent(c.req.path.slice(1));
    return fileResponse(opts.clientDir, rel) ?? c.notFound();
  });

  return app;
}
