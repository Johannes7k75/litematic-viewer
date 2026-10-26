// NBT parsing via prismarine-nbt (server only: it is a Node library), plus typed accessors
// for the simplified tree.

import { gunzipSync } from 'fflate';
import nbt from 'prismarine-nbt';

/** A value from `nbt.simplify`: compounds become objects, lists arrays, long arrays [high, low] pairs. */
export type NbtValue = unknown;
export type NbtCompound = Record<string, NbtValue>;

export function isGzip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Parse a (possibly gzip'd) big-endian NBT file such as a .litematic. */
export function parseNbt(bytes: Uint8Array): NbtCompound {
  const raw = isGzip(bytes) ? gunzipSync(bytes) : bytes;
  return nbt.simplify(nbt.parseUncompressed(Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength), 'big'));
}

export const asCompound = (v: NbtValue): NbtCompound =>
  v && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v) ? (v as NbtCompound) : {};

/** Numbers, including longs (bigint or [high, low]). */
export function asNumber(v: NbtValue, fallback = 0): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number')) return v[0] * 4294967296 + (v[1] >>> 0);
  return fallback;
}

export const asString = (v: NbtValue, fallback = ''): string => (typeof v === 'string' ? v : fallback);
export const asList = (v: NbtValue): NbtValue[] => (Array.isArray(v) ? v : []);
export const asNumbers = (v: NbtValue): number[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === 'number') ? v : null;

/**
 * A long array as 32-bit words, low word first, so bit k of the packed stream is bit (k & 31)
 * of words[k >> 5]. One spare word lets readers peek past the end when a value spans two words.
 */
export function longArrayWords(v: NbtValue): Uint32Array | null {
  if (!Array.isArray(v)) return null;
  const words = new Uint32Array(v.length * 2 + 1);
  for (let i = 0; i < v.length; i++) {
    const pair = v[i];
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    words[2 * i] = pair[1] >>> 0;
    words[2 * i + 1] = pair[0] >>> 0;
  }
  return words;
}
