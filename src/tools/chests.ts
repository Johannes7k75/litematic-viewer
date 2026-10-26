// Chests are drawn by an entity renderer in-game, so the jar has no block model for them.
// This rebuilds their shape from Minecraft's ChestRenderer and cuts the entity texture
// into per-face tiles laid out for the viewer's default face UVs.

import { FACE_CORNERS } from '../client/mesher/blocks.ts';
import type { Image } from '../server/png.ts';
import { DIRECTIONS, type BlockstateDef, type Direction, type FaceDef, type ModelDef, type ModelRef, type UV, type Vec3 } from '../shared/types.ts';

const TILE = 16;

/** Entity texture per chest block (waxed copper chests look like unwaxed ones). */
const CHEST_TEXTURES: Record<string, string> = {
  chest: 'normal',
  trapped_chest: 'trapped',
  ender_chest: 'ender',
  copper_chest: 'copper',
  exposed_copper_chest: 'copper_exposed',
  weathered_copper_chest: 'copper_weathered',
  oxidized_copper_chest: 'copper_oxidized',
};
for (const [k, v] of Object.entries(CHEST_TEXTURES)) if (k.includes('copper')) CHEST_TEXTURES[`waxed_${k}`] = v;

type ChestType = 'single' | 'left' | 'right';
type Box = [from: Vec3, size: Vec3, texOffset: [number, number]];

/** Body, lid and latch per chest type, front facing +z (south). */
const SHAPES: Record<ChestType, Box[]> = {
  single: [[[1, 0, 1], [14, 10, 14], [0, 19]], [[1, 9, 1], [14, 5, 14], [0, 0]], [[7, 7, 15], [2, 4, 1], [0, 0]]],
  left: [[[0, 0, 1], [15, 10, 14], [0, 19]], [[0, 9, 1], [15, 5, 14], [0, 0]], [[0, 7, 15], [1, 4, 1], [0, 0]]],
  right: [[[1, 0, 1], [15, 10, 14], [0, 19]], [[1, 9, 1], [15, 5, 14], [0, 0]], [[15, 7, 15], [1, 4, 1], [0, 0]]],
};

const FACING_Y: Record<string, number> = { south: 0, west: 90, north: 180, east: 270 };

interface UVVertex {
  pos: Vec3;
  uv: [number, number];
}

/** Per-vertex texture coords of an entity-model cube, as Minecraft's ModelPart.Cube assigns them. */
export function cubeUVs([x0, y0, z0]: Vec3, [dx, dy, dz]: Vec3, [u, v]: [number, number]): Record<Direction, UVVertex[]> {
  const [x1, y1, z1] = [x0 + dx, y0 + dy, z0 + dz];
  const P: Vec3[] = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f4 = u, f5 = u + dz, f6 = f5 + dx, f7 = f6 + dx, f8 = f6 + dz, f9 = f8 + dx;
  const f10 = v, f11 = v + dz, f12 = f11 + dy;
  const faces: Record<Direction, [number[], number, number, number, number]> = {
    down: [[5, 4, 0, 1], f5, f10, f6, f11],
    up: [[2, 3, 7, 6], f6, f11, f7, f10],
    west: [[0, 4, 7, 3], f4, f11, f5, f12],
    north: [[1, 0, 3, 2], f5, f11, f6, f12],
    east: [[5, 1, 2, 6], f6, f11, f8, f12],
    south: [[4, 5, 6, 7], f8, f11, f9, f12],
  };
  const out = {} as Record<Direction, UVVertex[]>;
  for (const dir of DIRECTIONS) {
    const [vi, u1, v1, u2, v2] = faces[dir];
    const uvs: [number, number][] = [[u2, v1], [u1, v1], [u1, v2], [u2, v2]];
    out[dir] = vi.map((i, k) => ({ pos: P[i], uv: uvs[k] }));
  }
  return out;
}

/** Cut one face out of an entity texture into a tile, oriented for the viewer's TL/BL/BR/TR corners. */
export function faceTile(img: Image, verts: UVVertex[], corners: Vec3[]): { tile: Uint8Array; uv: UV } {
  const uvAt = (c: Vec3) => {
    const v = verts.find((vt) => vt.pos.every((x, i) => x === c[i]));
    if (!v) throw new Error('chest face corner mismatch');
    return v.uv;
  };
  const [tl, bl, , tr] = corners.map(uvAt);
  const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const w = dist(corners[0], corners[3]), h = dist(corners[0], corners[1]);
  const tile = new Uint8Array(TILE * TILE * 4);
  // The face fills the top-left w x h texels; the rest repeats its edge so edges don't bleed.
  for (let jj = 0; jj < TILE; jj++) {
    for (let ii = 0; ii < TILE; ii++) {
      const i = Math.min(ii, w - 1), j = Math.min(jj, h - 1);
      const s = (i + 0.5) / w, t = (j + 0.5) / h;
      const u = Math.floor(tl[0] + (tr[0] - tl[0]) * s + (bl[0] - tl[0]) * t);
      const v = Math.floor(tl[1] + (tr[1] - tl[1]) * s + (bl[1] - tl[1]) * t);
      tile.set(img.data.subarray((v * img.width + u) * 4, (v * img.width + u) * 4 + 4), (jj * TILE + ii) * 4);
    }
  }
  return { tile, uv: [0, 0, w, h] };
}

/**
 * Adds chest models and replaces chest blockstates so chests render with their real shape.
 * `loadTexture` returns the decoded entity texture (e.g. "normal_left") or null.
 */
export function addChests(
  blockstates: Record<string, BlockstateDef>,
  models: Record<string, ModelDef>,
  loadTexture: (name: string) => Image | null,
  addTile: (key: string, tile: Uint8Array) => number,
): void {
  const built = new Map<string, boolean>();
  for (const [block, tex] of Object.entries(CHEST_TEXTURES)) {
    if (!blockstates[block]) continue;
    const types: ChestType[] = block === 'ender_chest' ? ['single'] : ['single', 'left', 'right'];
    const variants: Record<string, ModelRef> = {};
    for (const type of types) {
      const name = `viewer/chest/${tex}/${type}`;
      if (!built.has(name)) {
        const img = loadTexture(type === 'single' ? tex : `${tex}_${type}`);
        built.set(name, !!img);
        if (img) models[name] = chestModel(name, type, img, addTile);
      }
      if (!built.get(name)) continue;
      for (const [facing, y] of Object.entries(FACING_Y)) {
        variants[block === 'ender_chest' ? `facing=${facing}` : `facing=${facing},type=${type}`] = { model: name, y };
      }
    }
    if (Object.keys(variants).length) blockstates[block] = { variants };
  }
}

function chestModel(name: string, type: ChestType, img: Image, addTile: (key: string, tile: Uint8Array) => number): ModelDef {
  const e = SHAPES[type].map(([from, size, off], part) => {
    const to = from.map((x, i) => x + size[i]) as Vec3;
    const uvs = cubeUVs(from, size, off);
    const faces: Partial<Record<Direction, FaceDef>> = {};
    for (const dir of DIRECTIONS) {
      const { tile, uv } = faceTile(img, uvs[dir], FACE_CORNERS[dir](from, to));
      faces[dir] = { t: addTile(`${name}#${part}.${dir}`, tile), uv };
      if (dir === 'down' && from[1] === 0) faces[dir].c = 'down';
    }
    return { f: from, t: to, faces };
  });
  return { e, p: e[0].faces.south!.t, full: 0 };
}
