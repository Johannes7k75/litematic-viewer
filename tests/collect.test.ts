import { expect, test } from 'bun:test';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { collect } from '../src/tools/collect.ts';
import { tempDir } from './helpers.ts';

function put(path: string, content: string) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

const listFiles = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)))
    .sort();

test('copies unique schematics into per-instance folders', () => {
  const src = tempDir(), dest = tempDir();
  put(join(src, 'instances/1.20/.minecraft/schematics/farms/Blaze.litematic'), 'A');
  put(join(src, 'instances/1.21/.minecraft/schematics/old/Blaze.litematic'), 'A'); // duplicate content
  put(join(src, 'instances/1.21/.minecraft/schematics/Iron.litematic'), 'B');
  put(join(src, 'backup/Iron.litematic'), 'C');
  put(join(src, '$RECYCLE.BIN/x/Deleted.litematic'), 'D');
  put(join(src, 'instances/1.20/.minecraft/schematics/notes.txt'), 'E');

  expect(collect([src], dest)).toEqual({ copied: 3, skipped: 1 });
  expect(listFiles(dest)).toEqual(['1.20/farms/Blaze.litematic', '1.21/Iron.litematic', 'backup/Iron.litematic']);

  // Running again copies nothing new.
  expect(collect([src], dest)).toEqual({ copied: 0, skipped: 4 });
});
