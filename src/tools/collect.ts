// Copies every .litematic under the given folders into ./schematics.
//
// Identical files (same content) are copied once. Files go into a subfolder named after the
// launcher instance they came from, so same-named files from different instances don't clash.
// The Windows recycle bin is skipped.
//
// Usage: bun run collect SOURCE_DIR [SOURCE_DIR ...] [--dest schematics]

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync } from 'node:fs';
import { basename, dirname, extname, join, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { PROJECT_DIR } from './build-assets.ts';

const md5 = (file: string) => createHash('md5').update(readFileSync(file)).digest('hex');

export function instanceLabel(file: string): string {
  const parts = file.split(sep), i = parts.indexOf('instances');
  if (i >= 0 && i + 1 < parts.length) return parts[i + 1];
  return basename(dirname(file)) || 'misc';
}

export function relInsideSchematics(file: string): string {
  const parts = file.split(sep), i = parts.lastIndexOf('schematics');
  return i >= 0 ? join(...parts.slice(i + 1)) : basename(file);
}

function* walk(dir: string): Generator<string> {
  let entries;
  try {
    // Sorted so that the copy kept among duplicates doesn't depend on filesystem order.
    entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch {
    return; // unreadable folder
  }
  for (const ent of entries) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name.toUpperCase() !== '$RECYCLE.BIN') yield* walk(p);
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.litematic')) {
      yield p;
    }
  }
}

export function collect(sources: string[], dest: string): { copied: number; skipped: number } {
  const seen = new Set<string>();
  if (existsSync(dest)) for (const f of walk(dest)) seen.add(md5(f));

  let copied = 0, skipped = 0;
  for (const src of sources) {
    for (const file of walk(src)) {
      const digest = md5(file);
      if (seen.has(digest)) {
        skipped++;
        continue;
      }
      seen.add(digest);
      let target = join(dest, instanceLabel(file), relInsideSchematics(file));
      const ext = extname(target), base = target.slice(0, -ext.length);
      for (let n = 2; existsSync(target); n++) target = `${base} (${n})${ext}`;
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(file, target);
      const st = statSync(file);
      utimesSync(target, st.atime, st.mtime);
      copied++;
    }
  }
  return { copied, skipped };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: { dest: { type: 'string', default: join(PROJECT_DIR, 'schematics') } },
  });
  if (!positionals.length) {
    console.log('Usage: bun run collect SOURCE_DIR [SOURCE_DIR ...] [--dest schematics]');
    process.exit(1);
  }
  const { copied, skipped } = collect(positionals, values.dest);
  console.log(`Copied ${copied} files, skipped ${skipped} duplicates -> ${values.dest}`);
}
