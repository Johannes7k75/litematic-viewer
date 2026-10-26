// Test fixtures: write small .litematic files with prismarine-nbt.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import nbt from 'prismarine-nbt';

export interface FixtureBlock {
  x: number;
  y: number;
  z: number;
  name: string;
  props?: Record<string, string>;
}

const int = (value: number) => ({ type: 'int', value });
const str = (value: string) => ({ type: 'string', value });
/** prismarine-nbt stores longs as signed 32-bit [high, low]. */
const long = (value: number) => ({ type: 'long', value: [Math.floor(value / 4294967296), value | 0] });
const xyz = (x: number, y: number, z: number) => ({ type: 'compound', value: { x: int(x), y: int(y), z: int(z) } });

/** Turn a small simplified compound back into NBT tags for block-entity fixtures. */
function tag(value: unknown): { type: string; value: unknown } {
  if (typeof value === 'string') return str(value);
  if (typeof value === 'number') return int(value);
  if (Array.isArray(value)) return { type: 'list', value: { type: 'compound', value: value.map((v) => tag(v).value) } };
  return { type: 'compound', value: Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, tag(v)])) };
}

/** Pack palette indices the way Litematica does (tightly, spanning longs). */
export function packBlockStates(indices: number[], bits: number): [number, number][] {
  const longs = new BigUint64Array(Math.ceil((indices.length * bits) / 64));
  indices.forEach((v, i) => {
    for (let b = 0; b < bits; b++) {
      if ((v >> b) & 1) {
        const k = BigInt(i * bits + b);
        longs[Number(k >> 6n)] |= 1n << (k & 63n);
      }
    }
  });
  return [...longs].map((l) => [Number(BigInt.asIntN(32, l >> 32n)), Number(BigInt.asIntN(32, l & 0xffffffffn))]);
}

/** A gzip'd single-region .litematic containing `blocks`. */
export function makeLitematic(
  size: [number, number, number],
  blocks: FixtureBlock[],
  opts: { name?: string; author?: string; preview?: number[]; tileEntities?: Record<string, unknown>[] } = {},
): Uint8Array<ArrayBuffer> {
  const [W, H, D] = size;
  const palette: { name: string; props?: Record<string, string> }[] = [{ name: 'minecraft:air' }];
  const grid = new Array<number>(W * H * D).fill(0);
  for (const b of blocks) {
    const key = JSON.stringify([b.name, b.props ?? {}]);
    let i = palette.findIndex((p) => JSON.stringify([p.name, p.props ?? {}]) === key);
    if (i < 0) i = palette.push({ name: b.name, props: b.props }) - 1;
    grid[(b.y * D + b.z) * W + b.x] = i;
  }
  const bits = Math.max(2, 32 - Math.clz32(palette.length - 1));
  const meta: Record<string, unknown> = {
    Name: str(opts.name ?? 'Test'),
    Author: str(opts.author ?? 'tests'),
    Description: str(''),
    EnclosingSize: xyz(W, H, D),
    TotalBlocks: int(blocks.length),
    TotalVolume: int(W * H * D),
    RegionCount: int(1),
    TimeCreated: long(1700000000000),
    TimeModified: long(1700000000000),
  };
  if (opts.preview) meta.PreviewImageData = { type: 'intArray', value: opts.preview };
  const root = {
    type: 'compound',
    name: '',
    value: {
      Version: int(6),
      MinecraftDataVersion: int(3953),
      Metadata: { type: 'compound', value: meta },
      Regions: {
        type: 'compound',
        value: {
          main: {
            type: 'compound',
            value: {
              Position: xyz(0, 0, 0),
              Size: xyz(W, H, D),
              BlockStatePalette: {
                type: 'list',
                value: {
                  type: 'compound',
                  value: palette.map((p) => ({
                    Name: str(p.name),
                    ...(p.props
                      ? { Properties: { type: 'compound', value: Object.fromEntries(Object.entries(p.props).map(([k, v]) => [k, str(v)])) } }
                      : {}),
                  })),
                },
              },
              BlockStates: { type: 'longArray', value: packBlockStates(grid, bits) },
              TileEntities: tag(opts.tileEntities ?? []),
              Entities: { type: 'list', value: { type: 'compound', value: [] } },
            },
          },
        },
      },
    },
  };
  return new Uint8Array(gzipSync(nbt.writeUncompressed(root as unknown as nbt.NBT, 'big')));
}

export const tempDir = (prefix = 'lv-test-') => mkdtempSync(join(tmpdir(), prefix));
