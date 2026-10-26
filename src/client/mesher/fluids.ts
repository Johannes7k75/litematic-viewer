// Water and lava geometry, following Minecraft's LiquidBlockRenderer: per-level surface
// heights, corners averaged with the neighbours (sloped surfaces), the flowing texture on the
// sides and, rotated along the flow, on sloped tops; faces also visible from inside water.

import type { Vec3 } from '../../shared/types.ts';
import type { Atlas, BlockInfo, Quad } from './blocks.ts';

type Fluid = 'water' | 'lava';

export interface FluidContext {
  atlas: Atlas;
  infos: (BlockInfo | null)[];
  /** Palette id at a position (0 = air, also outside the grid or the visible layers). */
  at(x: number, y: number, z: number): number;
}

export function fluidOf(info: BlockInfo | null): Fluid | null {
  return info?.lava ? 'lava' : info?.water ? 'water' : null;
}

/** FluidState.getOwnHeight: amount / 9, where sources and falling fluid have amount 8. */
function ownHeight(info: BlockInfo): number {
  const level = info.fluidLevel;
  return (level === 0 || level >= 8 ? 8 : 8 - level) / 9;
}

/** Can this block hold up / hide fluid? Anything that isn't air or the same fluid. */
const isSolid = (info: BlockInfo | null) => !!info && !info.water && !info.lava;

/** LiquidBlockRenderer.getHeight: 1 under the same fluid, own height, 0 for open space, -1 for solids. */
function heightAt(ctx: FluidContext, fluid: Fluid, x: number, y: number, z: number): number {
  const info = ctx.infos[ctx.at(x, y, z)];
  if (info && fluidOf(info) === fluid) {
    return fluidOf(ctx.infos[ctx.at(x, y + 1, z)]) === fluid ? 1 : ownHeight(info);
  }
  return isSolid(info) ? -1 : 0;
}

/** LiquidBlockRenderer.calculateAverageHeight: heights near full count ten times as much. */
function cornerHeight(ctx: FluidContext, fluid: Fluid, self: number, a: number, b: number, dx: number, y: number, dz: number): number {
  if (a >= 1 || b >= 1) return 1;
  let sum = 0, weight = 0;
  const add = (h: number) => {
    if (h >= 0.8) { sum += h * 10; weight += 10; }
    else if (h >= 0) { sum += h; weight += 1; }
  };
  if (a > 0 || b > 0) {
    const diagonal = heightAt(ctx, fluid, dx, y, dz);
    if (diagonal >= 1) return 1;
    add(diagonal);
  }
  add(self);
  add(a);
  add(b);
  return weight ? sum / weight : 0;
}

/** FlowingFluid.getFlow (horizontal part): from higher towards lower neighbours. */
function flowVector(ctx: FluidContext, fluid: Fluid, info: BlockInfo, x: number, y: number, z: number): [number, number] {
  const own = ownHeight(info);
  let fx = 0, fz = 0;
  for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const n = ctx.infos[ctx.at(x + dx, y, z + dz)];
    let diff = 0;
    if (n && fluidOf(n) === fluid) diff = own - ownHeight(n);
    else if (!isSolid(n)) {
      // Open neighbour: flows towards fluid falling below it.
      const below = ctx.infos[ctx.at(x + dx, y - 1, z + dz)];
      if (below && fluidOf(below) === fluid) diff = own - (ownHeight(below) - 8 / 9);
    }
    fx += dx * diff;
    fz += dz * diff;
  }
  const len = Math.hypot(fx, fz);
  return len > 1e-6 ? [fx / len, fz / len] : [0, 0];
}

function quad(ctx: FluidContext, tile: number, corners: Vec3[], uvs: [number, number][], normal: Vec3, trans: boolean): Quad {
  const pos = new Float32Array(12), tex = new Float32Array(8);
  for (let i = 0; i < 4; i++) {
    pos.set(corners[i], i * 3);
    tex.set(ctx.atlas.uv(tile, uvs[i][0], uvs[i][1]), i * 2);
  }
  return { pos, tex, cull: -1, normal, lit: true, tint: true, trans };
}

/** The same face seen from the other side (fluid surfaces are visible from inside the fluid). */
function reversed(q: Quad): Quad {
  const order = [3, 2, 1, 0];
  const pos = new Float32Array(12), tex = new Float32Array(8);
  order.forEach((src, i) => {
    pos.set(q.pos.subarray(src * 3, src * 3 + 3), i * 3);
    tex.set(q.tex.subarray(src * 2, src * 2 + 2), i * 2);
  });
  return { ...q, pos, tex, normal: [-q.normal[0], -q.normal[1], -q.normal[2]] };
}

/** Quads (block-local, 0..1) for the fluid in the block at x, y, z. */
export function fluidQuads(ctx: FluidContext, info: BlockInfo, x: number, y: number, z: number): Quad[] {
  const fluid = fluidOf(info)!;
  const { tiles } = ctx.atlas.assets;
  const still = tiles[`block/${fluid}_still`], flow = tiles[`block/${fluid}_flow`];
  const trans = fluid === 'water';
  const out: Quad[] = [];
  const push = (q: Quad, twoSided: boolean) => {
    out.push(q);
    if (twoSided) out.push(reversed(q));
  };

  const same = (dx: number, dy: number, dz: number) => fluidOf(ctx.infos[ctx.at(x + dx, y + dy, z + dz)]) === fluid;
  // Faces against opaque full blocks are hidden; glass and the like still show the fluid behind.
  const covered = (dx: number, dy: number, dz: number) => !!ctx.infos[ctx.at(x + dx, y + dy, z + dz)]?.full;

  const h = (dx: number, dz: number) => heightAt(ctx, fluid, x + dx, y, z + dz);
  const self = h(0, 0), hN = h(0, -1), hS = h(0, 1), hE = h(1, 0), hW = h(-1, 0);
  const sameAbove = same(0, 1, 0);
  let nw: number, ne: number, sw: number, se: number;
  if (self >= 1) nw = ne = sw = se = 1;
  else {
    ne = cornerHeight(ctx, fluid, self, hN, hE, x + 1, y, z - 1);
    nw = cornerHeight(ctx, fluid, self, hN, hW, x - 1, y, z - 1);
    se = cornerHeight(ctx, fluid, self, hS, hE, x + 1, y, z + 1);
    sw = cornerHeight(ctx, fluid, self, hS, hW, x - 1, y, z + 1);
  }

  // Top surface, slightly lowered like Minecraft does to avoid fighting with blocks above.
  if (!sameAbove && !covered(0, 1, 0)) {
    const e = 0.001;
    const corners: Vec3[] = [[0, nw - e, 0], [0, sw - e, 1], [1, se - e, 1], [1, ne - e, 0]];
    const [fx, fz] = flowVector(ctx, fluid, info, x, y, z);
    let tile = still, uvs: [number, number][] = [[0, 0], [0, 16], [16, 16], [16, 0]];
    if (fx || fz) {
      // Flowing texture turned along the flow (LiquidBlockRenderer's UV rotation).
      const angle = Math.atan2(fz, fx) - Math.PI / 2;
      const s = Math.sin(angle) * 0.25, c = Math.cos(angle) * 0.25;
      const uv = (du: number, dv: number): [number, number] => [8 + du * 16, 8 + dv * 16];
      tile = flow;
      uvs = [uv(-c - s, -c + s), uv(-c + s, c + s), uv(c + s, c - s), uv(c - s, -c - s)];
    }
    push(quad(ctx, tile, corners, uvs, [0, 1, 0], trans), trans);
  }

  // Bottom.
  if (!same(0, -1, 0) && !covered(0, -1, 0)) {
    const e = 0.001;
    push(quad(ctx, still, [[0, e, 1], [0, e, 0], [1, e, 0], [1, e, 1]], [[0, 16], [0, 0], [16, 0], [16, 16]], [0, -1, 0], trans), false);
  }

  // Sides: flowing texture, top edge following the corner heights. Corners TL, BL, BR, TR from outside.
  const sides: [number, number, Vec3, Vec3, Vec3, number, number][] = [
    // dx, dz, normal, top-left corner (x, z), top-right corner (x, z), height at TL, height at TR
    [0, -1, [0, 0, -1], [1, 0, 0], [0, 0, 0], ne, nw],
    [0, 1, [0, 0, 1], [0, 0, 1], [1, 0, 1], sw, se],
    [-1, 0, [-1, 0, 0], [0, 0, 0], [0, 0, 1], nw, sw],
    [1, 0, [1, 0, 0], [1, 0, 1], [1, 0, 0], se, ne],
  ];
  for (const [dx, dz, normal, tl, tr, hl, hr] of sides) {
    if (same(dx, 0, dz) || covered(dx, 0, dz)) continue;
    const corners: Vec3[] = [[tl[0], hl, tl[2]], [tl[0], 0, tl[2]], [tr[0], 0, tr[2]], [tr[0], hr, tr[2]]];
    const uvs: [number, number][] = [[0, (1 - hl) * 8], [0, 8], [8, 8], [8, (1 - hr) * 8]];
    push(quad(ctx, flow, corners, uvs, normal, trans), trans);
  }
  return out;
}
