// Builds vertex buffers for a block grid, hiding faces covered by neighbours.

import type { MeshData, MeshPart } from '../../shared/types.ts';
import { Atlas, blockInfo, DIR_VECTORS, elementQuads, tintFor, type BlockInfo, type Quad } from './blocks.ts';
import { fluidQuads, type FluidContext } from './fluids.ts';
import type { BlockGrid } from '../../shared/types.ts';

type TypedArray = Float32Array | Int8Array | Uint8Array | Uint32Array;

const WHITE: readonly number[] = [1, 1, 1];

class GrowBuf<T extends TypedArray> {
  n = 0;
  constructor(private a: T, private readonly make: (n: number) => T) {}
  reserve(k: number): T {
    if (this.n + k > this.a.length) {
      const b = this.make(Math.max(this.a.length * 2, this.n + k));
      b.set(this.a);
      this.a = b;
    }
    return this.a;
  }
  out(): T {
    return this.a.slice(0, this.n) as T;
  }
}

class MeshBuilder {
  private pos = new GrowBuf(new Float32Array(1 << 16), (n) => new Float32Array(n));
  private uv = new GrowBuf(new Float32Array(1 << 15), (n) => new Float32Array(n));
  private col = new GrowBuf(new Uint8Array(1 << 16), (n) => new Uint8Array(n));
  private nrm = new GrowBuf(new Int8Array(1 << 16), (n) => new Int8Array(n));
  private idx = new GrowBuf(new Uint32Array(1 << 15), (n) => new Uint32Array(n));
  private verts = 0;

  /** Appends a quad; `tint` is rgb in 0..1. */
  quad(q: Quad, x: number, y: number, z: number, tint: readonly number[], lit: boolean): void {
    const p = this.pos.reserve(12);
    for (let i = 0; i < 12; i += 3) {
      p[this.pos.n++] = q.pos[i] + x;
      p[this.pos.n++] = q.pos[i + 1] + y;
      p[this.pos.n++] = q.pos[i + 2] + z;
    }
    this.uv.reserve(8).set(q.tex, this.uv.n);
    this.uv.n += 8;
    const [r, g, b] = tint.map((t) => Math.round(t * 255));
    const a = lit ? 255 : 128;
    const c = this.col.reserve(16);
    for (let i = 0; i < 4; i++) {
      c[this.col.n++] = r; c[this.col.n++] = g; c[this.col.n++] = b; c[this.col.n++] = a;
    }
    const n = this.nrm.reserve(12);
    for (let i = 0; i < 4; i++) {
      n[this.nrm.n++] = Math.round(q.normal[0] * 127);
      n[this.nrm.n++] = Math.round(q.normal[1] * 127);
      n[this.nrm.n++] = Math.round(q.normal[2] * 127);
    }
    const v = this.verts;
    this.idx.reserve(6).set([v, v + 1, v + 2, v, v + 2, v + 3], this.idx.n);
    this.idx.n += 6;
    this.verts += 4;
  }

  result(): MeshPart {
    return { pos: this.pos.out(), uv: this.uv.out(), col: this.col.out(), nrm: this.nrm.out(), idx: this.idx.out() };
  }
}

export class Mesher {
  readonly infos: (BlockInfo | null)[];
  private readonly spawners: { pos: [number, number, number]; quads: Quad[] }[] = [];

  constructor(private readonly atlas: Atlas, readonly schematic: BlockGrid) {
    this.infos = schematic.palette.map((st, i) => (i === 0 ? null : blockInfo(atlas, st)));
    const cache = new Map<string, Quad[]>();
    const [sx, , sz] = schematic.dims;
    for (const { pos, entity } of schematic.spawners ?? []) {
      const [x, y, z] = pos;
      if (!pos.every((v, i) => Number.isInteger(v) && v >= 0 && v < schematic.dims[i])) continue;
      if (this.infos[schematic.grid[(y * sz + z) * sx + x]]?.name !== 'spawner') continue;
      // Legacy saves used unnamespaced CamelCase IDs. Keep custom namespaces distinct.
      const mob = entity.replace(/^minecraft:/, '').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
      const name = mob === 'lavaslime' || mob === 'lava_slime' ? 'magma_cube' : mob;
      let quads = cache.get(name);
      if (!quads) {
        quads = [];
        for (const el of atlas.assets.models[`viewer/mob/${name}`]?.e ?? []) elementQuads(atlas, el, 0, 150, quads);
        cache.set(name, quads);
      }
      this.spawners.push({ pos, quads });
    }
  }

  /** Mesh the layers yMin..yMax (inclusive); blocks outside count as air. */
  build(yMin: number, yMax: number): MeshData {
    const { dims: [SX, , SZ], grid } = this.schematic;
    const infos = this.infos;
    const solid = new MeshBuilder(), trans = new MeshBuilder();
    const at = (x: number, y: number, z: number) =>
      x < 0 || z < 0 || x >= SX || z >= SZ || y < yMin || y > yMax ? 0 : grid[(y * SZ + z) * SX + x];
    const waterTint = tintFor(this.atlas.assets, 'water', {});
    const fluids: FluidContext = { atlas: this.atlas, infos, at };

    for (let y = yMin; y <= yMax; y++) {
      for (let z = 0; z < SZ; z++) {
        for (let x = 0; x < SX; x++) {
          const id = grid[(y * SZ + z) * SX + x];
          if (!id) continue;
          const info = infos[id]!;
          for (const q of info.quads) {
            if (q.cull >= 0) {
              const d = DIR_VECTORS[q.cull];
              const n = at(x + d[0], y + d[1], z + d[2]);
              const ni = infos[n];
              if (ni && (ni.full || (info.fullCube && ni.fullCube && ni.name === info.name))) continue;
            }
            (q.trans ? trans : solid).quad(q, x, y, z, q.tint ? info.tint : WHITE, q.lit);
          }
          if (info.water || info.lava) {
            const tint = info.lava ? WHITE : waterTint;
            for (const q of fluidQuads(fluids, info, x, y, z)) (q.trans ? trans : solid).quad(q, x, y, z, tint, q.lit);
          }
        }
      }
    }
    for (const { pos: [x, y, z], quads } of this.spawners) {
      if (y < yMin || y > yMax) continue;
      for (const q of quads) (q.trans ? trans : solid).quad(q, x, y, z, WHITE, q.lit);
    }
    return { solid: solid.result(), trans: trans.result() };
  }
}

export function meshTransferables(m: MeshData): ArrayBuffer[] {
  return [m.solid, m.trans].flatMap((p) => [p.pos.buffer, p.uv.buffer, p.col.buffer, p.nrm.buffer, p.idx.buffer]) as ArrayBuffer[];
}
