import { getImage } from './images';

export interface UnitBox {
  /** fractions of the picture's width and height, 0…1 */
  x: number;
  y: number;
  w: number;
  h: number;
}

const cache = new Map<string, UnitBox>();
const FULL: UnitBox = { x: 0, y: 0, w: 1, h: 1 };

/**
 * The opaque part of a picture, as fractions of its size. Library PNGs carry wide transparent
 * margins (the safe fills about 60% of its square), so a replacement fits this box, not the frame.
 */
export function opaqueBox(ref: string): UnitBox {
  const hit = cache.get(ref);
  if (hit) return hit;
  const img = getImage(ref);
  if (!img) return FULL;
  const S = 128;
  const ctx = new OffscreenCanvas(S, S).getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, S, S);
  const d = ctx.getImageData(0, 0, S, S).data;
  let minX = S;
  let minY = S;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (d[(y * S + x) * 4 + 3] <= 24) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const box = maxX < 0 ? FULL : { x: minX / S, y: minY / S, w: (maxX - minX + 1) / S, h: (maxY - minY + 1) / S };
  cache.set(ref, box);
  return box;
}
