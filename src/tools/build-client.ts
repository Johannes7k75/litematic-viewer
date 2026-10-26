// Bundles the browser client into dist/.

import { transformAsync } from '@babel/core';
import typescriptPreset from '@babel/preset-typescript';
import solidPreset from 'babel-preset-solid';
import type { BunPlugin } from 'bun';
import { builtinModules } from 'node:module';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';

const PROJECT_DIR = join(import.meta.dir, '..', '..');
const CLIENT_SRC = join(PROJECT_DIR, 'src', 'client');
export const CLIENT_OUT = join(PROJECT_DIR, 'dist');

const NODE_BUILTIN = new RegExp(`^(node:.*|${builtinModules.map((m) => m.replace(/[/]/g, '\\/')).join('|')})$`);

/**
 * Fail the build if browser code reaches a Node built-in. Bun would otherwise substitute
 * partial polyfills that can break at runtime in the browser (e.g. stream needing `process`).
 */
export const noNodeBuiltins: BunPlugin = {
  name: 'no-node-builtins',
  setup(build) {
    build.onResolve({ filter: NODE_BUILTIN }, (args) => {
      throw new Error(`Browser bundle imports Node built-in "${args.path}" from ${relative(PROJECT_DIR, args.importer)}`);
    });
  },
};

/** Compile .tsx with Solid's official JSX compiler (Bun's own JSX transform targets React). */
export const solidJsx: BunPlugin = {
  name: 'solid-jsx',
  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, async ({ path }) => {
      const result = await transformAsync(await Bun.file(path).text(), {
        filename: path,
        babelrc: false,
        configFile: false,
        sourceMaps: 'inline',
        // Presets run last to first: strip types, then compile Solid JSX.
        presets: [[solidPreset, { generate: 'dom' }], [typescriptPreset, { isTSX: true, allExtensions: true }]],
      });
      if (!result?.code) throw new Error(`Babel produced no output for ${relative(PROJECT_DIR, path)}`);
      return { contents: result.code, loader: 'js' };
    });
  },
};

export async function buildClient(outDir = CLIENT_OUT): Promise<void> {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const result = await Bun.build({
    entrypoints: [join(CLIENT_SRC, 'main.tsx'), join(CLIENT_SRC, 'worker.ts')],
    outdir: outDir,
    target: 'browser',
    naming: '[name].[ext]',
    minify: true,
    sourcemap: 'linked',
    // Production builds of dependencies (Bun picks "development" exports unless NODE_ENV says otherwise).
    conditions: ['production'],
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [noNodeBuiltins, solidJsx],
    throw: false,
  });
  if (!result.success) {
    throw new AggregateError(result.logs, `Client build failed:\n${result.logs.map((l) => String(l.message ?? l)).join('\n')}`);
  }
  for (const f of ['index.html', 'style.css']) copyFileSync(join(CLIENT_SRC, f), join(outDir, f));
}

if (import.meta.main) {
  await buildClient();
  console.log(`Built client -> ${CLIENT_OUT}`);
}
