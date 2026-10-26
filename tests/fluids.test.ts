// Fluid geometry (ported from Minecraft's LiquidBlockRenderer) and atlas padding.
// Needs assets/ (bun run build:assets); skipped otherwise.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Atlas } from '../src/client/mesher/blocks.ts';
import { Mesher } from '../src/client/mesher/mesh.ts';
import { decodePng } from '../src/server/png.ts';
import { parseLitematic } from '../src/server/litematic.ts';
import type { BlockAssets, MeshPart } from '../src/shared/types.ts';
import { makeLitematic, type FixtureBlock } from './helpers.ts';

const ASSETS = join(import.meta.dir, '..', 'assets');
const haveAssets = existsSync(join(ASSETS, 'blocks.json'));
const assets = haveAssets ? (JSON.parse(readFileSync(join(ASSETS, 'blocks.json'), 'utf8')) as BlockAssets) : null;

function mesh(size: [number, number, number], blocks: FixtureBlock[]) {
  return new Mesher(new Atlas(assets!), parseLitematic(makeLitematic(size, blocks))).build(0, size[1] - 1);
}

/** Highest vertex y over x/z within the block at (bx, bz). */
function topAt(p: MeshPart, bx: number, bz: number): number {
  let top = -Infinity;
  for (let i = 0; i < p.pos.length; i += 3) {
    const [x, y, z] = [p.pos[i], p.pos[i + 1], p.pos[i + 2]];
    if (x >= bx && x <= bx + 1 && z >= bz && z <= bz + 1) top = Math.max(top, y);
  }
  return top;
}

const water = (x: number, y: number, z: number, level = 0): FixtureBlock =>
  ({ x, y, z, name: 'minecraft:water', props: { level: String(level) } });
const stone = (x: number, y: number, z: number): FixtureBlock => ({ x, y, z, name: 'minecraft:stone' });

/** A 3x1 trough walled with stone, with the given water blocks inside at y = 1. */
function trough(cells: FixtureBlock[]) {
  const blocks: FixtureBlock[] = [...cells];
  for (let x = 0; x < 5; x++) for (let z = 0; z < 3; z++) {
    blocks.push(stone(x, 0, z));
    if (x === 0 || x === 4 || z !== 1) blocks.push(stone(x, 1, z));
  }
  return mesh([5, 2, 3], blocks);
}

describe.skipIf(!haveAssets)('fluids', () => {
  test('a source surface sits at 8/9 of the block', () => {
    const m = trough([water(1, 1, 1), water(2, 1, 1), water(3, 1, 1)]);
    expect(topAt(m.trans, 2, 1) - 1).toBeCloseTo(8 / 9, 2);
  });

  test('flowing water steps down with its level', () => {
    const m = trough([water(1, 1, 1, 0), water(2, 1, 1, 3), water(3, 1, 1, 6)]);
    const source = topAt(m.trans, 1, 1), mid = topAt(m.trans, 2, 1), end = topAt(m.trans, 3, 1);
    expect(source).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(end);
    expect(end - 1).toBeGreaterThan(0);
  });

  test('water under water fills the whole block and hides the shared face', () => {
    const blocks = [water(0, 0, 0), water(0, 1, 0)];
    const m = mesh([1, 2, 1], blocks);
    const ys = new Set<number>();
    for (let i = 1; i < m.trans.pos.length; i += 3) ys.add(Math.round(m.trans.pos[i] * 1000) / 1000);
    expect(ys.has(1)).toBe(true); // lower block's sides reach its top (y = 1)
    // Only the top surface of the upper block lies between 1 and 2; no face at y = 1 spans the block.
    const facesAtOne = countHorizontalFacesAt(m.trans, 1);
    expect(facesAtOne).toBe(0);
  });

  test('lava is opaque, water is translucent', () => {
    const lava = mesh([1, 1, 1], [{ x: 0, y: 0, z: 0, name: 'minecraft:lava', props: { level: '0' } }]);
    expect(lava.solid.idx.length).toBeGreaterThan(0);
    expect(lava.trans.idx.length).toBe(0);
    const w = mesh([1, 1, 1], [water(0, 0, 0)]);
    expect(w.trans.idx.length).toBeGreaterThan(0);
    expect(w.solid.idx.length).toBe(0);
  });

  test('atlas tiles are padded with their own edge pixels', () => {
    const img = decodePng(new Uint8Array(readFileSync(join(ASSETS, 'atlas.png'))));
    const { pad, cols, tile } = assets!;
    const cell = tile + 2 * pad;
    const at = (x: number, y: number) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
    for (const name of ['block/stone', 'block/oak_planks', 'block/water_still']) {
      const t = assets!.tiles[name];
      const ox = (t % cols) * cell, oy = Math.floor(t / cols) * cell;
      for (let i = 0; i < pad; i++) {
        expect(at(ox + i, oy + pad + 5)).toEqual(at(ox + pad, oy + pad + 5)); // left border = left edge
        expect(at(ox + pad + 7, oy + pad + tile + i)).toEqual(at(ox + pad + 7, oy + pad + tile - 1)); // bottom border
      }
    }
  });
});

/** Horizontal quads (all 4 corners at height y) in a mesh part. */
function countHorizontalFacesAt(p: MeshPart, y: number): number {
  let n = 0;
  for (let q = 0; q < p.pos.length; q += 12) {
    if ([1, 4, 7, 10].every((k) => Math.abs(p.pos[q + k] - y) < 0.01)) n++;
  }
  return n;
}
