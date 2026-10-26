// Needs assets/blocks.json (bun run build:assets); skipped otherwise.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Atlas } from '../src/client/mesher/blocks.ts';
import { Mesher } from '../src/client/mesher/mesh.ts';
import { parseLitematic } from '../src/server/litematic.ts';
import { fromProto, toProto } from '../src/shared/schematic-proto.ts';
import type { BlockAssets, MeshPart } from '../src/shared/types.ts';
import { makeLitematic, type FixtureBlock } from './helpers.ts';

const ASSETS = join(import.meta.dir, '..', 'assets', 'blocks.json');
const haveAssets = existsSync(ASSETS);
const atlas = haveAssets ? new Atlas(JSON.parse(readFileSync(ASSETS, 'utf8')) as BlockAssets) : null;

function mesh(size: [number, number, number], blocks: FixtureBlock[]) {
  const s = parseLitematic(makeLitematic(size, blocks));
  return new Mesher(atlas!, s).build(0, s.dims[1] - 1);
}

const quads = (p: MeshPart) => p.idx.length / 6;

/** Bounding box of every vertex in a mesh part. */
function bounds(p: MeshPart) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.pos.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], p.pos[i + a]);
      max[a] = Math.max(max[a], p.pos[i + a]);
    }
  }
  return { min, max };
}

const chest = (x: number, z: number, facing: string, type: string): FixtureBlock =>
  ({ x, y: 0, z, name: 'minecraft:chest', props: { facing, type, waterlogged: 'false' } });

describe.skipIf(!haveAssets)('mesher', () => {
  test('hides faces between opaque cubes', () => {
    expect(quads(mesh([1, 1, 1], [{ x: 0, y: 0, z: 0, name: 'minecraft:stone' }]).solid)).toBe(6);
    expect(quads(mesh([2, 1, 1], [
      { x: 0, y: 0, z: 0, name: 'minecraft:stone' },
      { x: 1, y: 0, z: 0, name: 'minecraft:stone' },
    ]).solid)).toBe(10);
  });

  test('glass hides faces between glass blocks but not towards stone', () => {
    const m = mesh([3, 1, 1], [
      { x: 0, y: 0, z: 0, name: 'minecraft:glass' },
      { x: 1, y: 0, z: 0, name: 'minecraft:glass' },
      { x: 2, y: 0, z: 0, name: 'minecraft:stone' },
    ]);
    // Glass pair: 10 faces minus the one against stone; stone shows 5 (its side towards glass stays).
    expect(quads(m.solid) + quads(m.trans)).toBe(9 + 6);
  });

  test('single chest is a 14x14 body with a latch on the front', () => {
    const south = bounds(mesh([1, 1, 1], [chest(0, 0, 'south', 'single')]).solid);
    expect(south.min.map((v) => v * 16)).toEqual([1, 0, 1]);
    expect(south.max.map((v) => +(v * 16).toFixed(3))).toEqual([15, 14, 16]); // latch reaches z = 16
    const north = bounds(mesh([1, 1, 1], [chest(0, 0, 'north', 'single')]).solid);
    expect(+(north.min[2] * 16).toFixed(3)).toBe(0); // latch now on the -z side
  });

  test('double chest halves join without a gap', () => {
    // Facing north, the left half's partner is east (+x).
    const m = bounds(mesh([2, 1, 1], [chest(0, 0, 'north', 'left'), chest(1, 0, 'north', 'right')]).solid);
    expect(+(m.min[0] * 16).toFixed(3)).toBe(1);
    expect(+(m.max[0] * 16).toFixed(3)).toBe(31);
  });

  test('layer range treats other layers as air', () => {
    const s = parseLitematic(makeLitematic([1, 2, 1], [
      { x: 0, y: 0, z: 0, name: 'minecraft:stone' },
      { x: 0, y: 1, z: 0, name: 'minecraft:stone' },
    ]));
    const top = new Mesher(atlas!, s).build(1, 1);
    expect(quads(top.solid)).toBe(6); // bottom face exposed once layer 0 is hidden
  });

  test('spawner previews survive parsing and transport, differ per mob and respect layers', () => {
    const blocks: FixtureBlock[] = [{ x: 0, y: 1, z: 0, name: 'minecraft:spawner' }];
    const empty = mesh([1, 2, 1], blocks);
    const previews = new Map<string, number>();
    for (const mob of ['zombie', 'skeleton', 'spider', 'cave_spider', 'silverfish', 'blaze', 'magma_cube', 'pig']) {
      const schematic = fromProto(toProto(parseLitematic(makeLitematic([1, 2, 1], blocks, {
        tileEntities: [{ x: 0, y: 1, z: 0, SpawnData: { entity: { id: `minecraft:${mob}` } } }],
      }))));
      const mesher = new Mesher(atlas!, schematic);
      const full = mesher.build(0, 1);
      expect(full.solid.idx.length, mob).toBeGreaterThan(empty.solid.idx.length);
      expect(mesher.build(0, 0).solid.idx.length).toBe(0);
      const preview = full.solid.pos.subarray(empty.solid.pos.length);
      for (let i = 0; i < preview.length; i += 3) {
        expect(preview[i]).toBeGreaterThan(0);
        expect(preview[i]).toBeLessThan(1);
        expect(preview[i + 1]).toBeGreaterThan(1);
        expect(preview[i + 1]).toBeLessThan(2);
        expect(preview[i + 2]).toBeGreaterThan(0);
        expect(preview[i + 2]).toBeLessThan(1);
      }
      previews.set(mob, full.solid.idx.length);
    }
    expect(previews.get('blaze')).not.toBe(previews.get('zombie'));
  });

  test('unknown entity namespaces do not silently render a different Minecraft mob', () => {
    const s = parseLitematic(makeLitematic([1, 1, 1], [{ x: 0, y: 0, z: 0, name: 'minecraft:spawner' }], {
      tileEntities: [{ x: 0, y: 0, z: 0, SpawnData: { entity: { id: 'custom:zombie' } } }],
    }));
    const unknown = new Mesher(atlas!, s).build(0, 0);
    const empty = new Mesher(atlas!, { ...s, spawners: [] }).build(0, 0);
    expect(unknown).toEqual(empty);
  });
});
