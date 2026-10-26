// Conversion between the wire message (litematic.v1.Schematic) and the in-memory ParsedSchematic.

import { create } from '@bufbuild/protobuf';
import { SchematicSchema, type Schematic } from '../gen/litematic/v1/viewer_pb.ts';
import type { ParsedSchematic } from './types.ts';

export function toProto(s: ParsedSchematic): Schematic {
  const [x, y, z] = s.dims;
  const grid = new Uint8Array(s.grid.length * 2);
  const dv = new DataView(grid.buffer);
  for (let i = 0; i < s.grid.length; i++) dv.setUint16(i * 2, s.grid[i], true);
  return create(SchematicSchema, {
    dims: { x, y, z },
    grid,
    palette: s.palette,
    regions: s.regions,
    meta: s.meta,
    materials: s.materials.map(([name, count]) => ({ name, count })),
    spawners: s.spawners?.map(({ pos: [x, y, z], entity }) => ({ x, y, z, entity })),
  });
}

export function fromProto(m: Schematic): ParsedSchematic {
  const { x = 0, y = 0, z = 0 } = m.dims ?? {};
  const n = x * y * z;
  if (m.grid.length !== n * 2) throw new Error(`Grid has ${m.grid.length} bytes, expected ${n * 2} for ${x}×${y}×${z}`);
  // `grid` may be an unaligned view into the response buffer, so read it through a DataView.
  const dv = new DataView(m.grid.buffer, m.grid.byteOffset, m.grid.byteLength);
  const grid = new Uint16Array(n);
  for (let i = 0; i < n; i++) grid[i] = dv.getUint16(i * 2, true);
  const meta = m.meta;
  return {
    dims: [x, y, z],
    grid,
    palette: m.palette.map((b) => ({ name: b.name, props: { ...b.props } })),
    regions: [...m.regions],
    meta: {
      name: meta?.name ?? '',
      author: meta?.author ?? '',
      description: meta?.description ?? '',
      totalBlocks: meta?.totalBlocks ?? 0,
      mcVersion: meta?.mcVersion ?? 0,
    },
    materials: m.materials.map((mat) => [mat.name, mat.count]),
    spawners: m.spawners.map(({ x, y, z, entity }) => ({ pos: [x, y, z], entity })),
  };
}
