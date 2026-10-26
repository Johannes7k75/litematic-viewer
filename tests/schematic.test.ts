import { describe, expect, test } from 'bun:test';
import { loadSchematic, materialList, parseLitematic } from '../src/server/litematic.ts';
import { asCompound, asNumber, parseNbt } from '../src/server/nbt.ts';
import { makeLitematic, type FixtureBlock } from './helpers.ts';

describe('loadSchematic', () => {
  test('unpacks block states that straddle two longs', () => {
    // 20 distinct blocks -> 5 bits per entry, so entries regularly cross 64-bit boundaries.
    const colors = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan',
      'purple', 'blue', 'brown', 'green', 'red', 'black'];
    const names = [...colors.map((c) => `minecraft:${c}_wool`), 'minecraft:stone', 'minecraft:dirt', 'minecraft:oak_planks', 'minecraft:glass'];
    const blocks: FixtureBlock[] = [];
    for (let i = 0; i < 7 * 3 * 5; i++) {
      const x = i % 7, z = Math.floor(i / 7) % 5, y = Math.floor(i / 35);
      if (i % 4 !== 3) blocks.push({ x, y, z, name: names[i % names.length] });
    }
    const s = loadSchematic(parseNbt(makeLitematic([7, 3, 5], blocks)));
    expect(s.dims).toEqual([7, 3, 5]);
    for (const b of blocks) {
      const id = s.grid[(b.y * 5 + b.z) * 7 + b.x];
      expect(s.palette[id].name).toBe(b.name.replace('minecraft:', ''));
    }
    const filled = s.grid.filter((v: number) => v !== 0).length;
    expect(filled).toBe(blocks.length);
  });

  test('keeps block properties and treats structure voids as air', () => {
    const s = loadSchematic(parseNbt(makeLitematic([2, 1, 1], [
      { x: 0, y: 0, z: 0, name: 'minecraft:oak_stairs', props: { facing: 'east', half: 'bottom', shape: 'straight', waterlogged: 'false' } },
      { x: 1, y: 0, z: 0, name: 'minecraft:structure_void' },
    ])));
    expect(s.palette[s.grid[0]]).toEqual({ name: 'oak_stairs', props: { facing: 'east', half: 'bottom', shape: 'straight', waterlogged: 'false' } });
    expect(s.grid[1]).toBe(0);
  });

  test('reads metadata longs', () => {
    const meta = asCompound(parseNbt(makeLitematic([1, 1, 1], [])).Metadata);
    expect(asNumber(meta.TimeCreated)).toBe(1700000000000);
  });

  test('keeps modern, older and legacy spawner mobs without inventing a mob for empty spawners', () => {
    const s = parseLitematic(makeLitematic([5, 1, 1], Array.from({ length: 5 }, (_, x) =>
      ({ x, y: 0, z: 0, name: 'minecraft:spawner' })), { tileEntities: [
      { x: 0, y: 0, z: 0, SpawnData: { entity: { id: 'minecraft:blaze' } } },
      { x: 1, y: 0, z: 0, SpawnData: { id: 'minecraft:cave_spider' } },
      { x: 2, y: 0, z: 0, EntityId: 'Pig' },
      { x: 3, y: 0, z: 0, SpawnData: {} },
      { x: 4, y: 0, z: 0, SpawnPotentials: [{ data: { entity: { id: 'minecraft:zombie' } } }] },
      { x: 50, y: 0, z: 0, SpawnData: { id: 'minecraft:skeleton' } },
    ] }));
    expect(s.spawners).toEqual([
      { pos: [0, 0, 0], entity: 'minecraft:blaze' },
      { pos: [1, 0, 0], entity: 'minecraft:cave_spider' },
      { pos: [2, 0, 0], entity: 'Pig' },
    ]);
    expect(s.materials).toEqual([['spawner', 5]]);
  });

  test('translates block entities relative to region minima and drops data overwritten by another region', () => {
    const nbt = parseNbt(makeLitematic([2, 1, 1], [
      { x: 1, y: 0, z: 0, name: 'minecraft:spawner' },
    ], { tileEntities: [{ x: 1, y: 0, z: 0, SpawnData: { entity: { id: 'minecraft:blaze' } } }] }));
    const region = asCompound(asCompound(nbt.Regions).main);
    region.Position = { x: -3, y: 5, z: 7 };
    region.Size = { x: -2, y: 1, z: 1 };
    // A second region extends the merged origin in y/z as well as x.
    const second = structuredClone(region);
    second.Position = { x: -6, y: 3, z: 4 };
    second.Size = { x: 2, y: 1, z: 1 };
    nbt.Regions = { main: region, second };
    const s = loadSchematic(nbt);
    expect(s.spawners).toEqual([
      { pos: [3, 2, 3], entity: 'minecraft:blaze' },
      { pos: [1, 0, 0], entity: 'minecraft:blaze' },
    ]);
    const replacement = structuredClone(region);
    replacement.BlockStatePalette = [{ Name: 'minecraft:air' }, { Name: 'minecraft:stone' }];
    replacement.TileEntities = [];
    asCompound(nbt.Regions).replacement = replacement;
    expect(loadSchematic(nbt).spawners).toEqual([{ pos: [1, 0, 0], entity: 'minecraft:blaze' }]);
  });
});

describe('materialList', () => {
  test('counts items, not block halves', () => {
    const s = loadSchematic(parseNbt(makeLitematic([4, 2, 1], [
      { x: 0, y: 0, z: 0, name: 'minecraft:oak_door', props: { half: 'lower', facing: 'north' } },
      { x: 0, y: 1, z: 0, name: 'minecraft:oak_door', props: { half: 'upper', facing: 'north' } },
      { x: 1, y: 0, z: 0, name: 'minecraft:stone_slab', props: { type: 'double' } },
      { x: 2, y: 0, z: 0, name: 'minecraft:stone_slab', props: { type: 'bottom' } },
      { x: 3, y: 0, z: 0, name: 'minecraft:stone' },
      { x: 3, y: 1, z: 0, name: 'minecraft:stone' },
    ])));
    expect(Object.fromEntries(materialList(s.grid, s.palette))).toEqual({ oak_door: 1, stone_slab: 3, stone: 2 });
  });
});
