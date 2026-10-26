import { expect, test } from 'bun:test';
import { fromBinary, toBinary } from '@bufbuild/protobuf';
import { join } from 'node:path';
import { SchematicSchema } from '../src/gen/litematic/v1/viewer_pb.ts';
import { fromProto, toProto } from '../src/shared/schematic-proto.ts';
import type { ParsedSchematic } from '../src/shared/types.ts';

const PROJECT = join(import.meta.dir, '..');

test('schematic survives the wire format', () => {
  const s: ParsedSchematic = {
    dims: [2, 3, 4],
    grid: Uint16Array.from({ length: 2 * 3 * 4 }, (_, i) => (i * 7919) & 0xffff),
    palette: [{ name: 'air', props: {} }, { name: 'oak_stairs', props: { facing: 'ünïcode', half: 'top' } }],
    regions: ['main', 'second'],
    meta: { name: 'Ünïcode', author: 'x', description: 'd', totalBlocks: 5, mcVersion: 3953 },
    materials: [['stone', 3], ['dirt', 1]],
    spawners: [{ pos: [1, 2, 3], entity: 'minecraft:blaze' }],
  };
  // Through bytes: decoded `grid` is then an unaligned view into the message buffer.
  const back = fromProto(fromBinary(SchematicSchema, toBinary(SchematicSchema, toProto(s))));
  expect(back).toEqual(s);
});

test('older messages without spawner data still decode', () => {
  const s = fromProto(toProto({ dims: [1, 1, 1], grid: new Uint16Array(1), palette: [], regions: [], meta: {}, materials: [] }));
  expect(s.spawners).toEqual([]);
});

test('rejects a grid that does not match the dimensions', () => {
  const m = toProto({ dims: [2, 2, 2], grid: new Uint16Array(8), palette: [], regions: [], meta: {}, materials: [] });
  m.grid = m.grid.subarray(0, 10);
  expect(() => fromProto(m)).toThrow('expected 16');
});

// Code generation runs in Docker (see Makefile); skip where Docker isn't available.
const haveDocker = Bun.spawnSync(['docker', 'info'], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0;

test.skipIf(!haveDocker)('generated code is up to date with proto/', () => {
  const check = Bun.spawnSync(['make', '--no-print-directory', 'proto-check'], { cwd: PROJECT, stdout: 'pipe', stderr: 'pipe' });
  const output = check.stdout.toString() + check.stderr.toString();
  expect(check.exitCode, `src/gen is stale; run make generate\n${output}`).toBe(0);
  expect(output).toContain('src/gen is up to date');
}, 300_000);
