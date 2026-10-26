// Resolves block states to textured quads using the models from blocks.json.

import {
  DIRECTIONS,
  type BlockAssets,
  type BlockState,
  type Condition,
  type Direction,
  type ElementDef,
  type FaceDef,
  type ModelRef,
  type Vec3,
} from '../../shared/types.ts';

const RENAMES: Record<string, string> = { grass: 'short_grass', grass_path: 'dirt_path', chain: 'iron_chain' };
const ALWAYS_WATER = new Set(['water', 'bubble_column', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass']);

export const DIR_VECTORS: readonly Vec3[] = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
const DIR_INDEX = Object.fromEntries(DIRECTIONS.map((d, i) => [d, i])) as Record<Direction, number>;

export interface Quad {
  /** 4 corners in block units (0..1), TL BL BR TR. */
  pos: Float32Array;
  /** 4 atlas UVs. */
  tex: Float32Array;
  /** Index into DIR_VECTORS of the neighbour that hides this face, or -1. */
  cull: number;
  /** Outward face normal, used by the shader for lighting. */
  normal: Vec3;
  /** False for models with `shade: false`, drawn without face lighting. */
  lit: boolean;
  tint: boolean;
  trans: boolean;
}

export interface BlockInfo {
  name: string;
  /** Opaque full cube: hides neighbouring faces. */
  full: boolean;
  /** Full-cube shape (opaque or not); same-block neighbours hide shared faces, like glass. */
  fullCube: boolean;
  quads: Quad[];
  tint: Vec3;
  water: boolean;
  lava: boolean;
  /** Fluid `level` state: 0 source (and waterlogged), 1..7 flowing, 8+ falling. */
  fluidLevel: number;
}

/** Atlas plus lookups derived from it once per load. */
export class Atlas {
  readonly translucent: Set<number>;
  readonly missingTile: number;
  constructor(readonly assets: BlockAssets) {
    this.translucent = new Set(assets.translucent);
    this.missingTile = assets.tiles.missing ?? 0;
  }
  /** Atlas UV for texel position (u, v) in 0..16 of a tile; the padding around tiles prevents bleeding. */
  uv(tile: number, u: number, v: number): [number, number] {
    const { cols, width, height, pad } = this.assets;
    const cell = 16 + 2 * pad;
    const px = (tile % cols) * cell + pad + Math.min(16, Math.max(0, u));
    const py = Math.floor(tile / cols) * cell + pad + Math.min(16, Math.max(0, v));
    return [px / width, 1 - py / height];
  }
}

// Corners per face as seen from outside: TL, BL, BR, TR. f = from, t = to.
// build-assets.ts relies on the same order when it cuts chest textures.
export const FACE_CORNERS: Record<Direction, (f: Vec3, t: Vec3) => Vec3[]> = {
  north: (f, t) => [[t[0], t[1], f[2]], [t[0], f[1], f[2]], [f[0], f[1], f[2]], [f[0], t[1], f[2]]],
  south: (f, t) => [[f[0], t[1], t[2]], [f[0], f[1], t[2]], [t[0], f[1], t[2]], [t[0], t[1], t[2]]],
  west: (f, t) => [[f[0], t[1], f[2]], [f[0], f[1], f[2]], [f[0], f[1], t[2]], [f[0], t[1], t[2]]],
  east: (f, t) => [[t[0], t[1], t[2]], [t[0], f[1], t[2]], [t[0], f[1], f[2]], [t[0], t[1], f[2]]],
  up: (f, t) => [[f[0], t[1], f[2]], [f[0], t[1], t[2]], [t[0], t[1], t[2]], [t[0], t[1], f[2]]],
  down: (f, t) => [[f[0], f[1], t[2]], [f[0], f[1], f[2]], [t[0], f[1], f[2]], [t[0], f[1], t[2]]],
};

const DEFAULT_UV: Record<Direction, (f: Vec3, t: Vec3) => [number, number, number, number]> = {
  down: (f, t) => [f[0], 16 - t[2], t[0], 16 - f[2]],
  up: (f, t) => [f[0], f[2], t[0], t[2]],
  north: (f, t) => [16 - t[0], 16 - t[1], 16 - f[0], 16 - f[1]],
  south: (f, t) => [f[0], 16 - t[1], t[0], 16 - f[1]],
  west: (f, t) => [f[2], 16 - t[1], t[2], 16 - f[1]],
  east: (f, t) => [16 - t[2], 16 - t[1], 16 - f[2], 16 - f[1]],
};

/** Right-handed rotation of v around `axis` through point c. */
function rotAxis(v: Vec3, axis: 'x' | 'y' | 'z', deg: number, c: Vec3): Vec3 {
  const a = (deg * Math.PI) / 180, s = Math.sin(a), co = Math.cos(a);
  const x = v[0] - c[0], y = v[1] - c[1], z = v[2] - c[2];
  if (axis === 'x') return [x + c[0], y * co - z * s + c[1], y * s + z * co + c[2]];
  if (axis === 'y') return [x * co + z * s + c[0], y + c[1], -x * s + z * co + c[2]];
  return [x * co - y * s + c[0], x * s + y * co + c[1], z + c[2]];
}

/** Blockstate x/y rotation: x first, then y, both clockwise (Minecraft's convention). */
function blockRot(v: Vec3, rx: number, ry: number, c: Vec3 = [8, 8, 8]): Vec3 {
  if (rx) v = rotAxis(v, 'x', -rx, c);
  if (ry) v = rotAxis(v, 'y', -ry, c);
  return v;
}

function nearestDir(v: Vec3): number {
  let best = 0, bestDot = -2;
  DIR_VECTORS.forEach((d, i) => {
    const dot = d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
    if (dot > bestDot) { bestDot = dot; best = i; }
  });
  return best;
}

export function elementQuads(atlas: Atlas, el: ElementDef, rx: number, ry: number, out: Quad[]): void {
  const { f, t } = el;
  for (const dname of DIRECTIONS) {
    const face: FaceDef | undefined = el.faces[dname];
    if (!face) continue;
    let corners = FACE_CORNERS[dname](f, t);
    const uv = face.uv ?? DEFAULT_UV[dname](f, t);
    let uvs: [number, number][] = [[uv[0], uv[1]], [uv[0], uv[3]], [uv[2], uv[3]], [uv[2], uv[1]]];
    const r = ((face.r ?? 0) / 90) & 3;
    if (r) uvs = uvs.map((_, i) => uvs[(i + r) & 3]);
    let normal = DIR_VECTORS[DIR_INDEX[dname]];

    if (el.rot) {
      const rot = el.rot;
      let axis = rot.axis, angle = rot.angle ?? 0;
      if (!axis) {
        axis = (['x', 'y', 'z'] as const).find((a) => rot[a]) ?? 'y';
        angle = rot[axis] ?? 0;
      }
      const o = rot.origin ?? [8, 8, 8];
      const ax = axis;
      corners = corners.map((c) => rotAxis(c, ax, angle, o));
      if (rot.rescale) {
        const sc = 1 / Math.cos((angle * Math.PI) / 180);
        corners = corners.map((c) => c.map((v, i) => ('xyz'[i] === ax ? v : (v - o[i]) * sc + o[i])) as Vec3);
      }
      normal = rotAxis(normal, ax, angle, [0, 0, 0]);
    }

    corners = corners.map((c) => blockRot(c, rx, ry));
    normal = blockRot(normal, rx, ry, [0, 0, 0]);
    const cull = face.c ? nearestDir(blockRot(DIR_VECTORS[DIR_INDEX[face.c]], rx, ry, [0, 0, 0])) : -1;

    const pos = new Float32Array(12), tex = new Float32Array(8);
    for (let i = 0; i < 4; i++) {
      pos.set(corners[i].map((v) => v / 16), i * 3);
      tex.set(atlas.uv(face.t, uvs[i][0], uvs[i][1]), i * 2);
    }
    out.push({ pos, tex, cull, normal, lit: !el.ns, tint: !!face.ti, trans: atlas.translucent.has(face.t) });
  }
}

export function matchesWhen(when: Condition | undefined, props: Record<string, string>): boolean {
  if (!when) return true;
  if ('OR' in when && Array.isArray(when.OR)) return when.OR.some((w) => matchesWhen(w, props));
  if ('AND' in when && Array.isArray(when.AND)) return when.AND.every((w) => matchesWhen(w, props));
  return Object.entries(when).every(([k, v]) => String(v).split('|').includes(String(props[k])));
}

/** Exact variant match, else the variant matching the most properties (older schematics may lack some). */
export function pickVariant<T>(variants: Record<string, T>, props: Record<string, string>): T | null {
  let best: T | null = null, bestScore = -1;
  for (const [key, val] of Object.entries(variants)) {
    const conds = key ? key.split(',').map((s) => s.split('=')) : [];
    const score = conds.filter(([k, v]) => String(props[k]) === v).length;
    if (score === conds.length) return val;
    if (score > bestScore) { best = val; bestScore = score; }
  }
  return best;
}

const rgb = (h: number): Vec3 => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

/**
 * Tint for faces with a tintindex. Colors come from minecraft-data and the colormap textures
 * (see tools/block-data.ts); which color a block uses mirrors Minecraft's BlockColors, which
 * isn't part of any data set.
 */
export function tintFor({ tints }: BlockAssets, name: string, props: Record<string, string>): Vec3 {
  if (name in tints.constant) return rgb(tints.constant[name]);
  if (name === 'redstone_wire') return rgb(tints.redstone[+props.power || 0] ?? tints.redstone[0]);
  if (name === 'water' || name === 'bubble_column' || name === 'water_cauldron') return rgb(tints.water);
  if (name.endsWith('_leaves') || name === 'vine') return rgb(tints.foliage);
  return rgb(tints.grass);
}

/** Blocks with neither a model nor a collision box (banners): a thin post so they stay visible. */
const MARKER: [Vec3, Vec3] = [[7, 0, 7], [9, 16, 9]];

const allFaces = (face: (d: Direction) => FaceDef) =>
  Object.fromEntries(DIRECTIONS.map((d) => [d, face(d)])) as Record<Direction, FaceDef>;

export function blockInfo(atlas: Atlas, state: BlockState): BlockInfo {
  const { assets } = atlas;
  let name = state.name;
  const props = state.props;
  let bs = assets.blockstates[name];
  if (!bs && RENAMES[name]) bs = assets.blockstates[(name = RENAMES[name])];

  const applies: ModelRef[] = [];
  const first = (a: ModelRef | ModelRef[]) => (Array.isArray(a) ? a[0] : a);
  if (bs?.variants) {
    const v = pickVariant(bs.variants, props);
    if (v) applies.push(first(v));
  } else if (bs?.multipart) {
    for (const part of bs.multipart) if (matchesWhen(part.when, props)) applies.push(first(part.apply));
  }

  const isFluid = name === 'water' || name === 'lava' || name === 'bubble_column';
  const quads: Quad[] = [];
  let full = applies.length > 0, fullCube = applies.length > 0;
  for (const a of applies) {
    const m = assets.models[a.model.replace(/^minecraft:/, '')];
    if (!m) { full = fullCube = false; continue; }
    if (!m.full) full = false;
    const e0 = m.e[0];
    if (!(m.e.length === 1 && e0.f.join() === '0,0,0' && e0.t.join() === '16,16,16')) fullCube = false;
    let elems = m.e;
    if (!elems.length && !isFluid) {
      // Drawn by an entity renderer in-game: use its collision boxes with the particle texture.
      const boxes = assets.shapes[name]?.length ? assets.shapes[name] : [[...MARKER[0], ...MARKER[1]]];
      elems = boxes.map((b) => ({
        f: [b[0], b[1], b[2]] as Vec3,
        t: [b[3], b[4], b[5]] as Vec3,
        faces: allFaces(() => ({ t: m.p })),
      }));
      full = fullCube = false;
    }
    for (const el of elems) elementQuads(atlas, el, a.x ?? 0, a.y ?? 0, quads);
  }
  if (!bs) {
    // Unknown block: its block/<name> texture if there is one, else the "missing" checkerboard.
    const tile = assets.tiles['block/' + name] ?? atlas.missingTile;
    elementQuads(atlas, { f: [0, 0, 0], t: [16, 16, 16], faces: allFaces((d) => ({ t: tile, c: d })) }, 0, 0, quads);
    full = fullCube = true;
  }
  if (isFluid) full = fullCube = false;
  return {
    name, full, fullCube, quads,
    tint: tintFor(assets, name, props),
    water: ALWAYS_WATER.has(name) || props.waterlogged === 'true',
    lava: name === 'lava',
    fluidLevel: name === 'water' || name === 'lava' ? +props.level || 0 : 0,
  };
}
