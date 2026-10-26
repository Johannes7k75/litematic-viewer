// Turns a .litematic file into one dense block grid plus metadata.

import type { BlockGrid, BlockState, ParsedSchematic, SpawnerMob, Vec3 } from '../shared/types.ts';
import { asCompound, asList, asNumber, asString, longArrayWords, parseNbt, type NbtCompound } from './nbt.ts';

/** Blocks that render as nothing. */
export const AIR = new Set(['air', 'cave_air', 'void_air', 'structure_void', 'barrier', 'light', 'moving_piston']);

const MAX_VOLUME = 200e6;

export interface Schematic extends BlockGrid {
  regions: string[];
}

/** Parse a (gzip'd) .litematic file. */
export function parseLitematic(bytes: Uint8Array): ParsedSchematic {
  const nbt = parseNbt(bytes);
  const s = loadSchematic(nbt);
  const meta = asCompound(nbt.Metadata);
  return {
    ...s,
    meta: {
      name: asString(meta.Name),
      author: asString(meta.Author),
      description: asString(meta.Description),
      totalBlocks: asNumber(meta.TotalBlocks),
      mcVersion: asNumber(nbt.MinecraftDataVersion),
    },
    materials: materialList(s.grid, s.palette),
  };
}

export function stateKey(name: string, props: Record<string, string>): string {
  const keys = Object.keys(props).sort();
  return keys.length ? `${name}[${keys.map((k) => `${k}=${props[k]}`).join(',')}]` : name;
}

const vec = (c: NbtCompound): Vec3 => [asNumber(c.x), asNumber(c.y), asNumber(c.z)];

/** Modern SpawnData wraps the entity; pre-1.18 saves put its fields directly in SpawnData. */
export function spawnerEntity(tile: NbtCompound): string {
  const data = asCompound(tile.SpawnData);
  return asString(asCompound(data.entity).id) || asString(data.id) || asString(tile.EntityId);
}

export function loadSchematic(nbt: NbtCompound): Schematic {
  const regions = Object.entries(asCompound(nbt.Regions)).map(([name, v]) => {
    const r = asCompound(v);
    const pos = vec(asCompound(r.Position));
    const size = vec(asCompound(r.Size));
    // Negative sizes extend from the position towards smaller coordinates.
    const min = pos.map((p, i) => p + (size[i] < 0 ? size[i] + 1 : 0)) as Vec3;
    return { name, r, min, size: size.map(Math.abs) as Vec3 };
  });
  if (!regions.length) throw new Error('No regions in schematic');

  const lo = [0, 1, 2].map((i) => Math.min(...regions.map((b) => b.min[i])));
  const hi = [0, 1, 2].map((i) => Math.max(...regions.map((b) => b.min[i] + b.size[i])));
  const dims = [0, 1, 2].map((i) => hi[i] - lo[i]) as Vec3;
  const [SX, , SZ] = dims;
  if (dims[0] * dims[1] * dims[2] > MAX_VOLUME) throw new Error(`Schematic too large (${dims.join('x')})`);

  const grid = new Uint16Array(dims[0] * dims[1] * dims[2]);
  const palette: BlockState[] = [{ name: 'air', props: {} }];
  const keyToId = new Map([['air', 0]]);
  const spawners = new Map<number, SpawnerMob>();

  for (const b of regions) {
    const pal = asList(b.r.BlockStatePalette).map((v) => {
      const e = asCompound(v);
      const name = asString(e.Name, 'minecraft:air').replace(/^minecraft:/, '');
      if (AIR.has(name)) return 0;
      const props = Object.fromEntries(Object.entries(asCompound(e.Properties)).map(([k, pv]) => [k, asString(pv)]));
      const key = stateKey(name, props);
      let id = keyToId.get(key);
      if (id === undefined) {
        id = palette.length;
        keyToId.set(key, id);
        palette.push({ name, props });
      }
      return id;
    });
    const words = longArrayWords(b.r.BlockStates);
    if (!words || pal.length === 0) continue;
    if (palette.length > 65535) throw new Error('Too many distinct block states');

    // Litematica packs entries tightly; an entry may span two longs.
    const bits = Math.max(2, 32 - Math.clz32(pal.length - 1));
    const mask = (1 << bits) - 1;
    const [sx, sy, sz] = b.size;
    const [ox, oy, oz] = [0, 1, 2].map((i) => b.min[i] - lo[i]);
    let i = 0;
    for (let y = 0; y < sy; y++) {
      for (let z = 0; z < sz; z++) {
        for (let x = 0; x < sx; x++, i++) {
          const k = i * bits, w = k >>> 5, o = k & 31;
          let v = words[w] >>> o;
          if (o + bits > 32) v |= words[w + 1] << (32 - o);
          const id = pal[v & mask];
          if (id) {
            const index = ((y + oy) * SZ + (z + oz)) * SX + (x + ox);
            grid[index] = id;
            spawners.delete(index); // A later region may replace this spawner or its data.
          }
        }
      }
    }
    for (const value of asList(b.r.TileEntities)) {
      const tile = asCompound(value);
      const local = [tile.x, tile.y, tile.z].map((v) => asNumber(v, NaN)) as Vec3;
      if (!local.every((v, i) => Number.isInteger(v) && v >= 0 && v < b.size[i])) continue;
      const [x, y, z] = local.map((v, i) => v + [ox, oy, oz][i]) as Vec3;
      const index = (y * SZ + z) * SX + x;
      if (palette[grid[index]].name !== 'spawner') continue;
      const entity = spawnerEntity(tile);
      if (entity) spawners.set(index, { pos: [x, y, z], entity });
    }
  }
  return { dims, grid, palette, spawners: [...spawners.values()], regions: regions.map((b) => b.name) };
}

/** Item counts per block name, most common first (counts items, not block states). */
export function materialList(grid: Uint16Array, palette: BlockState[]): [string, number][] {
  const counts = new Uint32Array(palette.length);
  for (let i = 0; i < grid.length; i++) counts[grid[i]]++;
  const totals = new Map<string, number>();
  for (let id = 1; id < palette.length; id++) {
    if (!counts[id]) continue;
    const { name, props } = palette[id];
    // The second half of doors, beds and tall plants is not a separate item.
    if (props.half === 'upper' || props.part === 'head' || name === 'piston_head') continue;
    const n = props.type === 'double' && name.endsWith('_slab') ? counts[id] * 2 : counts[id];
    totals.set(name, (totals.get(name) ?? 0) + n);
  }
  return [...totals].sort((a, b) => b[1] - a[1]);
}
