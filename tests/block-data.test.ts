import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import mcData from 'minecraft-data';
import { Atlas, blockInfo, tintFor } from '../src/client/mesher/blocks.ts';
import { blockName } from '../src/client/format.ts';
import type { BlockAssets } from '../src/shared/types.ts';
import { pickVersion } from '../src/tools/block-data.ts';

describe('pickVersion', () => {
  const releases = mcData.supportedVersions.pc.filter((v) => /^\d+(\.\d+)*$/.test(v));
  test('uses the exact version when minecraft-data has it', () => {
    expect(pickVersion('1.20.6')).toBe('1.20.6');
  });
  test('falls back to the newest version not newer than the assets', () => {
    expect(pickVersion('99.0')).toBe(releases.at(-1)!);
    expect(pickVersion(null)).toBe(releases.at(-1)!);
  });
});

const ASSETS = join(import.meta.dir, '..', 'assets', 'blocks.json');
const assets = existsSync(ASSETS) ? (JSON.parse(readFileSync(ASSETS, 'utf8')) as BlockAssets) : null;
const hex = (v: number[]) => '#' + v.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');

describe.skipIf(!assets)('baked minecraft-data', () => {
  test('tints come from the data, not hard-coded colors', () => {
    const a = assets!;
    const data = mcData(a.dataVersion)!;
    const constant = (name: string) => (data.tints.constant.data.find((e) => (e.keys as string[]).includes(name))!.color >>> 0) & 0xffffff;
    expect(hex(tintFor(a, 'birch_leaves', {}))).toBe('#' + constant('birch_leaves').toString(16).padStart(6, '0'));
    expect(hex(tintFor(a, 'redstone_wire', { power: '15' }))).toBe('#' + a.tints.redstone[15].toString(16).padStart(6, '0'));
    expect(tintFor(a, 'oak_leaves', {})).toEqual(tintFor(a, 'vine', {}));
    // Plains grass from the colormap is Minecraft's well-known #91bd59.
    expect(hex(tintFor(a, 'short_grass', {}))).toBe('#91bd59');
  });

  test('blocks without a model use their collision boxes', () => {
    const atlas = new Atlas(assets!);
    const pot = blockInfo(atlas, { name: 'decorated_pot', props: {} });
    const xs = pot.quads.flatMap((q) => [q.pos[0], q.pos[3], q.pos[6], q.pos[9]]);
    expect(Math.min(...xs) * 16).toBeCloseTo(1); // pot collision box is 1..15
    expect(Math.max(...xs) * 16).toBeCloseTo(15);
    // Banners have no collision box: still drawn (as a thin post), never invisible.
    expect(blockInfo(atlas, { name: 'white_banner', props: { rotation: '0' } }).quads.length).toBeGreaterThan(0);
  });

  test('display names', () => {
    expect(blockName(assets, 'iron_block')).toBe('Block of Iron');
    expect(blockName(assets, 'some_future_block')).toBe('Some Future Block');
  });
});
