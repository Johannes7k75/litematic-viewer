// Extracts block textures, blockstates and models from a Minecraft client jar into
// assets/atlas.png and assets/blocks.json, which the viewer renders with.
//
// Usage: bun run build:assets [path/to/minecraft-client.jar]

import { strFromU8, unzipSync } from 'fflate';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { decodePng, encodePng, type Image } from '../server/png.ts';
import type { BlockAssets, BlockstateDef, Direction, ElementDef, FaceDef, ModelDef, ModelRef, UV, Vec3 } from '../shared/types.ts';
import { blockData } from './block-data.ts';
import { addChests } from './chests.ts';
import { addSpawnerMobs } from './mobs.ts';

export const PROJECT_DIR = join(import.meta.dir, '..', '..');
export const ASSETS_DIR = join(PROJECT_DIR, 'assets');

const TILE = 16;
const COLS = 64;
/**
 * Border around each atlas tile, filled with copies of the tile's edge pixels. Antialiasing can
 * sample slightly outside a face; without it that picks up the neighbouring texture.
 */
const PAD = 4;
const CELL = TILE + 2 * PAD;
/** Bump when blocks.json / atlas.png change shape, so existing assets get rebuilt. */
export const ASSETS_FORMAT = 3;
/** Textures the viewer needs even if no model references them. */
const EXTRA_TEXTURES = ['block/water_still', 'block/water_flow', 'block/lava_still', 'block/lava_flow'];

// ---------------------------------------------------------------- jar lookup

function versionKey(jar: string): number[] {
  return basename(dirname(jar)).split(/[.-]/).map((p) => (/^\d+$/.test(p) ? +p : 0));
}

function compareVersions(a: string, b: string): number {
  const ka = versionKey(a), kb = versionKey(b);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const d = (ka[i] ?? 0) - (kb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Newest Minecraft client jar from Prism Launcher (native or Flatpak) or the vanilla launcher. */
export function findJar(): string {
  const roots = [
    '.local/share/PrismLauncher/libraries/com/mojang/minecraft',
    '.var/app/org.prismlauncher.PrismLauncher/data/PrismLauncher/libraries/com/mojang/minecraft',
    '.minecraft/versions',
  ];
  const jars: string[] = [];
  for (const rel of roots) {
    const dir = join(homedir(), rel);
    if (!existsSync(dir)) continue;
    for (const ver of readdirSync(dir)) {
      const vdir = join(dir, ver);
      if (!statSync(vdir).isDirectory()) continue;
      for (const f of readdirSync(vdir)) {
        if (f.endsWith('.jar') && /\d/.test(f) && (f.includes('client') || rel.endsWith('versions'))) jars.push(join(vdir, f));
      }
    }
  }
  if (!jars.length) throw new Error('No Minecraft client jar found; pass one as an argument.');
  return jars.sort(compareVersions).at(-1)!;
}

// ---------------------------------------------------------------- textures

/** First square frame of a texture (animated strips), scaled with nearest sampling to TILE x TILE. */
function toTile(img: Image): Uint8Array {
  const side = Math.min(img.width, img.height);
  const out = new Uint8Array(TILE * TILE * 4);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const sx = Math.floor(((x + 0.5) * side) / TILE), sy = Math.floor(((y + 0.5) * side) / TILE);
      const o = (sy * img.width + sx) * 4;
      out.set(img.data.subarray(o, o + 4), (y * TILE + x) * 4);
    }
  }
  return out;
}

function missingTile(): Uint8Array {
  const out = new Uint8Array(TILE * TILE * 4);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      out.set(((x >> 3) + (y >> 3)) % 2 ? [0, 0, 0, 255] : [255, 0, 220, 255], (y * TILE + x) * 4);
    }
  }
  return out;
}

// ---------------------------------------------------------------- models

interface RawFace {
  uv?: UV;
  texture?: string;
  cullface?: Direction;
  rotation?: number;
  tintindex?: number;
}
interface RawElement {
  from: Vec3;
  to: Vec3;
  rotation?: ElementDef['rot'];
  shade?: boolean;
  faces: Partial<Record<Direction, RawFace>>;
}
type TextureRef = string | { sprite?: string };
interface RawModel {
  parent?: string;
  textures?: Record<string, TextureRef>;
  elements?: RawElement[];
}

const norm = (ref: string) => (ref.includes(':') ? ref.split(':')[1] : ref);
const asArray = <T>(a: T | T[]): T[] => (Array.isArray(a) ? a : [a]);

export function buildAssets(jarPath = findJar(), outDir = ASSETS_DIR): BlockAssets {
  console.log(`Using ${jarPath}`);
  const MODELS = 'assets/minecraft/models/block/', STATES = 'assets/minecraft/blockstates/';
  const TEXTURES = 'assets/minecraft/textures/';
  const jar = unzipSync(readFileSync(jarPath), {
    filter: ({ name }) => name.startsWith(MODELS) || name.startsWith(STATES) || name.startsWith(TEXTURES),
  });

  const rawModels: Record<string, RawModel> = {};
  const blockstates: Record<string, BlockstateDef> = {};
  for (const [n, data] of Object.entries(jar)) {
    if (!n.endsWith('.json')) continue;
    if (n.startsWith(MODELS)) rawModels[`block/${n.slice(MODELS.length, -5)}`] = JSON.parse(strFromU8(data));
    else if (n.startsWith(STATES)) blockstates[n.slice(STATES.length, -5)] = JSON.parse(strFromU8(data));
  }

  /** Merge a model with its parents. */
  const flatten = (name: string, seen = new Set<string>()): [Record<string, TextureRef>, RawElement[] | null] => {
    const m = rawModels[name];
    if (!m || seen.has(name)) return [{}, null];
    seen.add(name);
    let [textures, elements] = m.parent ? flatten(norm(m.parent), seen) : [{}, null];
    textures = { ...textures, ...(m.textures ?? {}) };
    if (m.elements) elements = m.elements;
    return [textures, elements];
  };

  const resolveTex = (textures: Record<string, TextureRef>, ref: TextureRef | undefined): string | null => {
    for (let depth = 0; depth < 10; depth++) {
      if (ref && typeof ref === 'object') ref = ref.sprite; // newer format: {"sprite": "...", ...}
      if (!(ref && ref.startsWith('#'))) break;
      ref = textures[ref.slice(1)];
    }
    return typeof ref === 'string' && !ref.startsWith('#') ? norm(ref) : null;
  };

  const usedModels = new Set<string>();
  const use = (a: ModelRef | ModelRef[]) => asArray(a).forEach((r) => usedModels.add(norm(r.model)));
  for (const bs of Object.values(blockstates)) {
    Object.values(bs.variants ?? {}).forEach(use);
    (bs.multipart ?? []).forEach((part) => use(part.apply));
  }

  const tileIndex: Record<string, number> = {};
  const tiles: Uint8Array[] = [];
  const addTile = (key: string, tile: Uint8Array) => {
    tileIndex[key] = tiles.length;
    tiles.push(tile);
    return tileIndex[key];
  };
  const loadImage = (texPath: string): Image | null => {
    const data = jar[`${TEXTURES}${texPath}.png`];
    if (!data) return null;
    try {
      return decodePng(data);
    } catch (e) {
      console.warn(`  skipping ${texPath}: ${(e as Error).message}`);
      return null;
    }
  };
  const tileFor = (p: string | null): number => {
    const key = p ?? 'missing';
    if (key in tileIndex) return tileIndex[key];
    const img = key === 'missing' ? null : loadImage(key);
    return addTile(key, img ? toTile(img) : missingTile());
  };
  EXTRA_TEXTURES.forEach(tileFor);

  const models: Record<string, ModelDef> = {};
  for (const name of [...usedModels].sort()) {
    const [textures, elements] = flatten(name);
    const e: ElementDef[] = (elements ?? []).map((el) => {
      const faces: Partial<Record<Direction, FaceDef>> = {};
      for (const [d, f] of Object.entries(el.faces) as [Direction, RawFace][]) {
        const fo: FaceDef = { t: tileFor(resolveTex(textures, f.texture)) };
        if (f.uv) fo.uv = f.uv;
        if (f.cullface) fo.c = f.cullface;
        if (f.rotation) fo.r = f.rotation;
        if (f.tintindex !== undefined) fo.ti = 1;
        faces[d] = fo;
      }
      const oe: ElementDef = { f: el.from, t: el.to, faces };
      if (el.rotation) oe.rot = el.rotation;
      if (el.shade === false) oe.ns = 1;
      return oe;
    });
    models[name] = { e, p: tileFor(resolveTex(textures, '#particle')), full: 0 };
  }

  addChests(blockstates, models, (tex) => loadImage(`entity/chest/${tex}`), addTile);
  addSpawnerMobs(models, (tex) => loadImage(`entity/${tex}`), addTile);

  // Blocks whose every model is empty are drawn by entity renderers in-game (beds, heads, signs, ...).
  const modelsOf = (bs: BlockstateDef) => [
    ...Object.values(bs.variants ?? {}).flatMap(asArray),
    ...(bs.multipart ?? []).flatMap((p) => asArray(p.apply)),
  ];
  const entityRendered = (name: string) => {
    const bs = blockstates[name];
    return !!bs && modelsOf(bs).every((r) => !models[norm(r.model)]?.e.length);
  };
  const data = blockData(
    basename(dirname(jarPath)).match(/^\d+(\.\d+)+$/)?.[0] ?? null,
    { grass: loadImage('colormap/grass'), foliage: loadImage('colormap/foliage') },
    entityRendered,
  );
  console.log(`Block names, shapes and tints from minecraft-data ${data.version}`);

  // Alpha classification per tile.
  const opaque = new Set<number>(), translucent: number[] = [];
  tiles.forEach((t, i) => {
    let partial = 0, allOpaque = true;
    for (let o = 3; o < t.length; o += 4) {
      if (t[o] !== 255) allOpaque = false;
      if (t[o] > 0 && t[o] < 255) partial++;
    }
    if (allOpaque) opaque.add(i);
    else if (partial > TILE * TILE * 0.05) translucent.push(i);
  });

  for (const m of Object.values(models)) {
    const el = m.e[0];
    m.full = m.e.length === 1 && el.f.join() === '0,0,0' && el.t.join() === '16,16,16' && !el.rot &&
      Object.keys(el.faces).length === 6 && Object.values(el.faces).every((f) => opaque.has(f!.t)) ? 1 : 0;
  }

  const rows = Math.ceil(tiles.length / COLS), width = COLS * CELL, height = rows * CELL;
  const atlas = new Uint8Array(width * height * 4);
  const clamp = (v: number) => Math.min(TILE - 1, Math.max(0, v));
  tiles.forEach((t, i) => {
    const ox = (i % COLS) * CELL, oy = Math.floor(i / COLS) * CELL;
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const src = (clamp(y - PAD) * TILE + clamp(x - PAD)) * 4;
        atlas.set(t.subarray(src, src + 4), ((oy + y) * width + ox + x) * 4);
      }
    }
  });

  const out: BlockAssets = {
    jar: basename(jarPath), dataVersion: data.version, names: data.names, shapes: data.shapes, tints: data.tints,
    format: ASSETS_FORMAT, tile: TILE, pad: PAD, cols: COLS, width, height,
    tiles: tileIndex, translucent, models, blockstates,
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'atlas.png'), encodePng({ width, height, data: atlas }));
  writeFileSync(join(outDir, 'blocks.json'), JSON.stringify(out));
  console.log(`${tiles.length} textures, ${Object.keys(models).length} models, ${Object.keys(blockstates).length} blockstates -> ${outDir}`);
  return out;
}

/** Whether assets/ is missing or was built by an older version of this script. */
export function assetsOutdated(outDir = ASSETS_DIR): boolean {
  const file = join(outDir, 'blocks.json');
  if (!existsSync(file) || !existsSync(join(outDir, 'atlas.png'))) return true;
  try {
    return (JSON.parse(readFileSync(file, 'utf8')) as Partial<BlockAssets>).format !== ASSETS_FORMAT;
  } catch {
    return true;
  }
}

if (import.meta.main) {
  // --if-needed: only rebuild when assets/ is missing or outdated (used by `make build`).
  const args = process.argv.slice(2);
  const jar = args.find((a) => !a.startsWith('--'));
  if (!args.includes('--if-needed') || assetsOutdated()) buildAssets(jar);
  else console.log('Block assets are up to date');
}
