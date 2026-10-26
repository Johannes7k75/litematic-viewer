import type { BlockAssets, ModelRef } from '../shared/types.ts';

/** Display name from minecraft-data ("iron_block" -> "Block of Iron"); title-cases unknown ids. */
export const blockName = (assets: BlockAssets | null, id: string) =>
  assets?.names[id] ?? id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** 3500 -> "2 SB + 2 st + 44" (shulker boxes, stacks, items). */
export function stacks(n: number): string {
  const sb = Math.floor(n / 1728), st = Math.floor((n % 1728) / 64), r = n % 64;
  const out: string[] = [];
  if (sb) out.push(`${sb} SB`);
  if (st) out.push(`${st} st`);
  if (r && (sb || st)) out.push(String(r));
  return out.join(' + ');
}

const ICON = 20;

/** Inline style that shows a block's texture from the atlas as a 20px icon. */
export function iconStyle(assets: BlockAssets | null, name: string): string {
  if (!assets) return '';
  const bs = assets.blockstates[name];
  const first = (a: ModelRef | ModelRef[]) => (Array.isArray(a) ? a[0] : a);
  let model: string | undefined;
  if (bs?.variants) model = first(Object.values(bs.variants)[0]).model;
  else if (bs?.multipart?.length) model = first(bs.multipart[0].apply).model;
  const m = model ? assets.models[model.replace(/^minecraft:/, '')] : undefined;
  let tile = m ? m.p : assets.tiles[`block/${name}`];
  let crop = assets.tile; // texels of the tile to show
  // For single-box models the side texture reads better than the particle one.
  if (m?.e.length === 1 && m.e[0].faces.north) tile = m.e[0].faces.north.t;
  // Generated models (chests) keep each face in the top-left corner of its tile.
  if (model?.startsWith('viewer/')) {
    const uv = m?.e[0].faces.south?.uv;
    if (uv) crop = Math.max(uv[2], uv[3]);
  }
  if (tile === undefined) return '';
  const s = ICON / crop, col = tile % assets.cols, row = Math.floor(tile / assets.cols);
  const cell = assets.tile + 2 * assets.pad;
  return [
    'background-image:url(assets/atlas.png)',
    `background-size:${assets.width * s}px ${assets.height * s}px`,
    `background-position:-${(col * cell + assets.pad) * s}px -${(row * cell + assets.pad) * s}px`,
  ].join(';');
}

export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(`lv.${key}`);
      return v === null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(`lv.${key}`, JSON.stringify(value));
    } catch {
      // Storage unavailable (private mode); preferences just won't persist.
    }
  },
};
