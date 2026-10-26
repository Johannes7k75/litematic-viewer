import { expect, test } from 'bun:test';
import { decodePng, encodePng } from '../src/server/png.ts';

test('RGBA round trip', () => {
  const width = 5, height = 3;
  const data = Uint8Array.from({ length: width * height * 4 }, (_, i) => (i * 37) & 255);
  const back = decodePng(encodePng({ width, height, data }));
  expect(back.width).toBe(width);
  expect(back.height).toBe(height);
  expect([...back.data]).toEqual([...data]);
});

test('rejects non-PNG input', () => {
  expect(() => decodePng(new Uint8Array([1, 2, 3, 4]))).toThrow();
});
