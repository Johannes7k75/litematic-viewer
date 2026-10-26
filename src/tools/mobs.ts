// Static entity models for spawner previews. Parts use Minecraft's entity-model coordinates
// (pixels, y down); textures are cut into the same padded atlas as the blocks and chests.

import { FACE_CORNERS } from '../client/mesher/blocks.ts';
import type { Image } from '../server/png.ts';
import { DIRECTIONS, type Direction, type ElementDef, type ModelDef, type Vec3 } from '../shared/types.ts';
import { cubeUVs, faceTile } from './chests.ts';

interface Part {
  from: Vec3;
  size: Vec3;
  uv: [number, number];
  rot?: { axis: 'x' | 'y' | 'z'; angle: number; origin: Vec3 };
}
const box = (from: Vec3, size: Vec3, uv: [number, number], rot?: Part['rot']): Part => ({ from, size, uv, rot });

function humanoid(skeleton = false, zombie = false): Part[] {
  const w = skeleton ? 2 : 4;
  return [
    box([-4, -8, -4], [8, 8, 8], [0, 0]),
    box([-4, 0, -2], [8, 12, 4], [16, 16]),
    ...[-1, 1].map((side) => box([side < 0 ? -6 - w / 2 : 6 - w / 2, 0, -w / 2], [w, 12, w], [40, 16],
      zombie ? { axis: 'x', angle: -90, origin: [side * 6, 2, 0] } : undefined)),
    ...[-1, 1].map((side) => box([side * 2 - w / 2, 12, -w / 2], [w, 12, w], [0, 16])),
  ];
}

function spider(): Part[] {
  return [
    box([-4, 11, -11], [8, 8, 8], [32, 4]),
    box([-3, 12, -3], [6, 6, 6], [0, 0]),
    box([-5, 11, 3], [10, 8, 12], [0, 12]),
    ...[-1, 1].flatMap((side) => [-45, -22.5, 22.5, 45].map((angle, i) =>
      box([side < 0 ? -20 : 4, 14, i - 2], [16, 2, 2], [18, 0],
        { axis: 'y', angle: side * angle, origin: [side * 4, 15, i - 1] }))),
  ];
}

function blaze(): Part[] {
  const parts = [box([-4, -4, -4], [8, 8, 8], [0, 0])];
  for (let ring = 0; ring < 3; ring++) {
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2 + [0, Math.PI / 4, 0.4712][ring];
      const r = [9, 7, 5][ring];
      parts.push(box([Math.cos(angle) * r, [-2, 2, 11][ring], Math.sin(angle) * r], [2, 8, 2], [0, 16]));
    }
  }
  return parts;
}

function silverfish(): Part[] {
  const sizes: Vec3[] = [[3, 2, 2], [4, 3, 2], [6, 4, 3], [3, 3, 3], [2, 2, 3], [2, 1, 2], [1, 1, 2]];
  const offsets: [number, number][] = [[0, 0], [0, 4], [0, 9], [0, 16], [0, 22], [11, 0], [13, 4]];
  let z = -3.5;
  return sizes.map(([w, h, d], i) => {
    const part = box([-w / 2, 24 - h, z - d / 2], [w, h, d], offsets[i]);
    z += (d + (sizes[i + 1]?.[2] ?? 0)) / 2;
    return part;
  });
}

function pig(): Part[] {
  return [
    box([-4, 8, -14], [8, 8, 8], [0, 0]),
    box([-2, 12, -15], [4, 3, 1], [16, 16]),
    box([-5, 1, -5], [10, 16, 8], [28, 8], { axis: 'x', angle: 90, origin: [0, 11, 2] }),
    ...[-1, 1].flatMap((side) => [-5, 5].map((z) => box([side * 3 - 2, 16, z - 2], [4, 6, 4], [0, 16]))),
  ];
}

const CREEPER = [
  box([-4, 0, -4], [8, 8, 8], [0, 0]), box([-4, 8, -2], [8, 12, 4], [16, 16]),
  ...[-1, 1].flatMap((x) => [-1, 1].map((z) => box([x * 2 - 2, 18, z * 4 - 2], [4, 6, 4], [0, 16]))),
];

/** Texture candidates include paths from both older and newer Minecraft versions. */
const MOBS: Record<string, { textures: string[]; parts: Part[] }> = {
  zombie: { textures: ['zombie/zombie'], parts: humanoid(false, true) },
  husk: { textures: ['zombie/husk'], parts: humanoid(false, true) },
  drowned: { textures: ['zombie/drowned'], parts: humanoid(false, true) },
  skeleton: { textures: ['skeleton/skeleton'], parts: humanoid(true) },
  stray: { textures: ['skeleton/stray'], parts: humanoid(true) },
  wither_skeleton: { textures: ['skeleton/wither_skeleton'], parts: humanoid(true) },
  bogged: { textures: ['skeleton/bogged'], parts: humanoid(true) },
  spider: { textures: ['spider/spider'], parts: spider() },
  cave_spider: { textures: ['spider/cave_spider'], parts: spider() },
  blaze: { textures: ['blaze/blaze', 'blaze'], parts: blaze() },
  silverfish: { textures: ['silverfish/silverfish', 'silverfish'], parts: silverfish() },
  magma_cube: { textures: ['slime/magmacube'], parts: [box([-4, 16, -4], [8, 8, 8], [0, 0])] },
  slime: { textures: ['slime/slime'], parts: [box([-3, 17, -3], [6, 6, 6], [0, 16])] },
  pig: { textures: ['pig/pig_temperate', 'pig/pig'], parts: pig() },
  creeper: { textures: ['creeper/creeper'], parts: CREEPER },
};

const flipY = ([x, y, z]: Vec3): Vec3 => [x, -y, z];

function rotated(p: Vec3, rot: ElementDef['rot']): Vec3 {
  if (!rot?.axis || !rot.origin) return p;
  const [x, y, z] = p.map((v, i) => v - rot.origin![i]);
  const a = (rot.angle ?? 0) * Math.PI / 180, s = Math.sin(a), c = Math.cos(a);
  const v = rot.axis === 'x' ? [x, y * c - z * s, y * s + z * c]
    : rot.axis === 'y' ? [x * c + z * s, y, -x * s + z * c] : [x * c - y * s, x * s + y * c, z];
  return v.map((n, i) => n + rot.origin![i]) as Vec3;
}

/** Bake each miniature directly into block-local model coordinates, safely inside the cage. */
export function addSpawnerMobs(
  models: Record<string, ModelDef>,
  loadTexture: (name: string) => Image | null,
  addTile: (key: string, tile: Uint8Array) => number,
): void {
  for (const [mob, { textures, parts }] of Object.entries(MOBS)) {
    let img: Image | null = null;
    for (const tex of textures) { img = loadTexture(tex); if (img) break; }
    if (!img) continue;
    const name = `viewer/mob/${mob}`;
    const elements: ElementDef[] = parts.map(({ from, size, uv, rot }, part) => {
      const rawTo = from.map((v, i) => v + size[i]) as Vec3;
      const f: Vec3 = [from[0], -rawTo[1], from[2]], t: Vec3 = [rawTo[0], -from[1], rawTo[2]];
      const uvs = cubeUVs(from, size, uv);
      const faces: ElementDef['faces'] = {};
      for (const dir of DIRECTIONS) {
        const rawDir: Direction = dir === 'up' ? 'down' : dir === 'down' ? 'up' : dir;
        const { tile, uv } = faceTile(img!, uvs[rawDir], FACE_CORNERS[dir](f, t).map(flipY));
        faces[dir] = { t: addTile(`${name}#${part}.${dir}`, tile), uv };
      }
      return { f, t, faces, ...(rot ? { rot: {
        axis: rot.axis, angle: rot.axis === 'y' ? rot.angle : -rot.angle, origin: flipY(rot.origin),
      } } : {}) };
    });
    // Fit the posed model, including enough horizontal space for its display turn.
    const points = elements.flatMap((el) => DIRECTIONS.flatMap((d) => FACE_CORNERS[d](el.f, el.t).map((p) => rotated(p, el.rot))));
    const lo = [0, 1, 2].map((i) => Math.min(...points.map((p) => p[i])));
    const hi = [0, 1, 2].map((i) => Math.max(...points.map((p) => p[i])));
    const center = lo.map((v, i) => (v + hi[i]) / 2);
    const scale = 11.2 / Math.max(hi[1] - lo[1], Math.hypot(hi[0] - lo[0], hi[2] - lo[2]));
    const fit = (p: Vec3): Vec3 => p.map((v, i) => 8 + (v - center[i]) * scale) as Vec3;
    for (const el of elements) {
      el.f = fit(el.f); el.t = fit(el.t);
      if (el.rot?.origin) el.rot.origin = fit(el.rot.origin);
    }
    models[name] = { e: elements, p: elements[0].faces.north!.t, full: 0 };
  }
}
