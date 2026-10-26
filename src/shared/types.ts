// Types shared by the server, the asset builder and the browser client.

export type Vec3 = [number, number, number];
export type UV = [number, number, number, number];
export type Direction = 'down' | 'up' | 'north' | 'south' | 'west' | 'east';
export const DIRECTIONS: readonly Direction[] = ['down', 'up', 'north', 'south', 'west', 'east'];

// ---------------------------------------------------------------- blocks.json (built from the Minecraft jar)

export interface FaceDef {
  /** Atlas tile index. */
  t: number;
  /** Texture rect in tile pixels (0..16). Derived from the element bounds when absent. */
  uv?: UV;
  /** Cull this face when the neighbour in this direction is a full opaque block. */
  c?: Direction;
  /** Texture rotation in degrees (0, 90, 180, 270). */
  r?: number;
  /** Face is tinted (grass, leaves, water, redstone). */
  ti?: 1;
}

export interface ElementRotation {
  origin?: Vec3;
  axis?: 'x' | 'y' | 'z';
  angle?: number;
  rescale?: boolean;
  x?: number;
  y?: number;
  z?: number;
}

export interface ElementDef {
  f: Vec3;
  t: Vec3;
  faces: Partial<Record<Direction, FaceDef>>;
  rot?: ElementRotation;
  /** shade: false */
  ns?: 1;
}

export interface ModelDef {
  e: ElementDef[];
  /** Particle texture tile. */
  p: number;
  /** Single opaque full cube (hides neighbouring faces). */
  full: 0 | 1;
}

export interface ModelRef {
  model: string;
  x?: number;
  y?: number;
  uvlock?: boolean;
  weight?: number;
}

export type Condition =
  | { OR: Condition[] }
  | { AND: Condition[] }
  | Record<string, string | number | boolean>;

export interface BlockstateDef {
  variants?: Record<string, ModelRef | ModelRef[]>;
  multipart?: { when?: Condition; apply: ModelRef | ModelRef[] }[];
}

/** Tint colors as 0xRRGGBB (from minecraft-data and the jar's colormaps). */
export interface BlockTints {
  grass: number;
  foliage: number;
  water: number;
  /** Indexed by redstone power 0..15. */
  redstone: number[];
  /** Blocks with a fixed tint (birch/spruce leaves, lily pad, stems). */
  constant: Record<string, number>;
}

export interface BlockAssets {
  /** Layout version of these files (see ASSETS_FORMAT in tools/build-assets.ts). */
  format: number;
  jar: string;
  /** minecraft-data version the names, shapes and tints come from. */
  dataVersion: string;
  /** Display names, e.g. iron_block -> "Block of Iron". */
  names: Record<string, string>;
  /** Collision boxes [x1, y1, z1, x2, y2, z2] in 1/16 units for blocks without a block model. */
  shapes: Record<string, number[][]>;
  tints: BlockTints;
  /** Tile size in pixels. */
  tile: number;
  /** Border around each tile in the atlas (edge pixels repeated); a cell is tile + 2 * pad. */
  pad: number;
  cols: number;
  width: number;
  height: number;
  tiles: Record<string, number>;
  translucent: number[];
  models: Record<string, ModelDef>;
  blockstates: Record<string, BlockstateDef>;
}

// ---------------------------------------------------------------- worker protocol

export interface BlockState {
  name: string;
  props: Record<string, string>;
}

/** Mob displayed inside a spawner, at a position in the merged block grid. */
export interface SpawnerMob {
  pos: Vec3;
  entity: string;
}

export interface MeshPart {
  pos: Float32Array;
  uv: Float32Array;
  /** Tint rgb (0..255) and a lit flag in alpha (255 lit, 128 unlit). */
  col: Uint8Array;
  /** Outward unit normal per vertex, normalized int8. */
  nrm: Int8Array;
  idx: Uint32Array;
}

export interface MeshData {
  solid: MeshPart;
  trans: MeshPart;
}

export interface SchematicMeta {
  name?: string;
  author?: string;
  description?: string;
  totalBlocks?: number;
  mcVersion?: number;
}

/** The block content of a schematic: what the mesher needs. */
export interface BlockGrid {
  dims: Vec3;
  /** Palette index per block, indexed (y * SZ + z) * SX + x. Index 0 is air. */
  grid: Uint16Array;
  palette: BlockState[];
  spawners?: SpawnerMob[];
}

/** A .litematic as parsed by the server (sent as litematic.v1.Schematic, see schematic-proto.ts). */
export interface ParsedSchematic extends BlockGrid {
  regions: string[];
  meta: SchematicMeta;
  /** [block name, item count], most common first. */
  materials: [string, number][];
}

export type WorkerRequest =
  | { type: 'assets'; assets: BlockAssets }
  | { type: 'load'; id: number; schematic: BlockGrid }
  | { type: 'mesh'; id: number; yMin: number; yMax: number };

export type WorkerResponse =
  | { type: 'mesh'; id: number; mesh: MeshData }
  | { type: 'error'; id: number; error: string };
