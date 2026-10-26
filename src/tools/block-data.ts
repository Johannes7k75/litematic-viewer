// Block facts from PrismarineJS minecraft-data, baked into blocks.json at build time
// (the package is large, so the browser never loads it).

import mcData from 'minecraft-data';
import type { Image } from '../server/png.ts';
import type { BlockTints } from '../shared/types.ts';

export interface BlockData {
  /** minecraft-data version used (closest to the assets' Minecraft version). */
  version: string;
  /** Display names, e.g. iron_block -> "Block of Iron". */
  names: Record<string, string>;
  /** Collision boxes (1/16 units) of the first block state, for blocks drawn by entity renderers. */
  shapes: Record<string, number[][]>;
  tints: BlockTints;
}

/** Plains: temperature from minecraft-data; downfall isn't in the data set (Minecraft's value is 0.4). */
const PLAINS_DOWNFALL = 0.4;

const versionParts = (v: string) => v.split('.').map(Number);
const cmp = (a: string, b: string) => {
  const x = versionParts(a), y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

/** Newest supported release that is not newer than `mcVersion` (or the oldest one, for very old versions). */
export function pickVersion(mcVersion: string | null): string {
  const releases = mcData.supportedVersions.pc.filter((v) => /^\d+(\.\d+)*$/.test(v)).sort(cmp);
  if (!mcVersion) return releases.at(-1)!;
  return releases.filter((v) => cmp(v, mcVersion) <= 0).at(-1) ?? releases[0];
}

/** Minecraft's colormap lookup (BiomeColors / GrassColor.get). */
function colormap(img: Image, temperature: number, downfall: number): number {
  const t = Math.min(1, Math.max(0, temperature));
  const d = Math.min(1, Math.max(0, downfall)) * t;
  const x = Math.floor((1 - t) * 255), y = Math.floor((1 - d) * 255);
  const o = (y * img.width + x) * 4;
  return (img.data[o] << 16) | (img.data[o + 1] << 8) | img.data[o + 2];
}

const rgb = (argb: number) => (argb >>> 0) & 0xffffff;

export function blockData(
  mcVersion: string | null,
  colormaps: { grass: Image | null; foliage: Image | null },
  entityRendered: (name: string) => boolean,
): BlockData {
  const version = pickVersion(mcVersion);
  const data = mcData(version);
  if (!data) throw new Error(`minecraft-data has no data for ${version}`);

  const names: Record<string, string> = {};
  for (const b of data.blocksArray) names[b.name] = b.displayName;

  const shapes: Record<string, number[][]> = {};
  const { blocks: shapeIds, shapes: boxes } = data.blockCollisionShapes;
  for (const [name, ids] of Object.entries(shapeIds)) {
    if (!entityRendered(name)) continue;
    const id = Array.isArray(ids) ? ids[0] : ids;
    shapes[name] = (boxes[id] ?? []).map((box) => box.map((v) => Math.round(v * 16 * 1000) / 1000));
  }

  const { tints } = data;
  const plains = data.biomesByName.plains;
  const biomeColor = (kind: 'grass' | 'foliage' | 'water') => {
    const entry = tints[kind].data.find((e) => (e.keys as string[]).includes('plains'));
    return entry && entry.color !== 0 ? rgb(entry.color) : null;
  };
  // Grass and foliage in plains come from the colormap textures (minecraft-data lists them as 0 = "computed").
  const fromColormap = (kind: 'grass' | 'foliage') => {
    const img = colormaps[kind];
    if (!img) throw new Error(`Assets have no textures/colormap/${kind}.png`);
    return colormap(img, plains.temperature, PLAINS_DOWNFALL);
  };
  const water = biomeColor('water');
  if (water === null) throw new Error(`minecraft-data ${version} has no plains water tint`);

  return {
    version,
    names,
    shapes,
    tints: {
      grass: biomeColor('grass') ?? fromColormap('grass'),
      foliage: biomeColor('foliage') ?? fromColormap('foliage'),
      water,
      redstone: [...tints.redstone.data].sort((a, b) => Number(a.keys[0]) - Number(b.keys[0])).map((e) => rgb(e.color)),
      constant: Object.fromEntries(tints.constant.data.flatMap((e) => (e.keys as string[]).map((k) => [k, rgb(e.color)]))),
    },
  };
}
