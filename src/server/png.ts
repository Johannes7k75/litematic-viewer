// RGBA PNG decode/encode on top of fast-png.

import { convertIndexedToRgb, decode, encode, type DecodedPng } from 'fast-png';

export interface Image {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, row-major. */
  data: Uint8Array;
}

/** Decode any PNG to 8-bit RGBA. */
export function decodePng(bytes: Uint8Array): Image {
  const png: DecodedPng = decode(bytes);
  const { width, height } = png;
  let src: ArrayLike<number> = png.data, channels = png.channels, shift = png.depth === 16 ? 8 : 0;
  if (png.palette) {
    src = convertIndexedToRgb(png);
    channels = png.palette[0].length;
    shift = 0;
  } else if (png.depth < 8) {
    // fast-png leaves low-bit-depth grayscale packed (rows padded to whole bytes).
    const depth = png.depth, max = (1 << depth) - 1, stride = Math.ceil((width * channels * depth) / 8);
    const packed = png.data, unpacked = new Uint8Array(width * height * channels);
    for (let y = 0; y < height; y++) {
      for (let i = 0; i < width * channels; i++) {
        const bit = i * depth;
        const v = (packed[y * stride + (bit >> 3)] >> (8 - depth - (bit & 7))) & max;
        unpacked[y * width * channels + i] = Math.round((v * 255) / max);
      }
    }
    src = unpacked;
  }
  // tRNS on grayscale / RGB images: one color (in raw sample values) is fully transparent.
  const key = !png.palette && (channels === 1 || channels === 3) ? png.transparency : undefined;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, o = 0; i < width * height; i++, o += 4) {
    const s = i * channels;
    const px = (c: number) => src[s + c] >> shift;
    if (channels <= 2) {
      data[o] = data[o + 1] = data[o + 2] = px(0);
      data[o + 3] = channels === 2 ? px(1) : key && src[s] === keyValue(key[0], png.depth) ? 0 : 255;
    } else {
      data[o] = px(0); data[o + 1] = px(1); data[o + 2] = px(2);
      const keyed = key && [0, 1, 2].every((c) => src[s + c] === keyValue(key[c], png.depth));
      data[o + 3] = channels === 4 ? px(3) : keyed ? 0 : 255;
    }
  }
  return { width, height, data };
}

/** tRNS key in the units of `src` (low bit depths were already scaled to 0..255 above). */
function keyValue(v: number, depth: number): number {
  return depth < 8 ? Math.round((v * 255) / ((1 << depth) - 1)) : v;
}

export function encodePng({ width, height, data }: Image): Uint8Array {
  return encode({ width, height, data, depth: 8, channels: 4 });
}
