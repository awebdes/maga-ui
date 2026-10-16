/**
 * Cuts a generated illustration out of its flat magenta (#FF00FF) background. Pure functions over
 * RGBA bytes, so Node tests run them and the worker just wraps them.
 *  1. the border must be flat magenta, else the model drew a floor or a gradient: the caller retries
 *  2. alpha from the magenta excess: how far red AND blue rise above green, relative to brightness
 *     (1 on the key in light or shadow, ≤ 0 on green, orange and white)
 *  3. edge pixels are un-mixed: C = (I − (1 − α)·K) / α removes the magenta that bled in
 *  4. leftover spill (magenta = red and blue above green) is pulled down only in the edge band,
 *     so the brand orange (red ≫ blue) is never touched
 *  5. crop to the opaque bounds with a small margin
 */
export interface KeyResult {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  bbox: { x: number; y: number; w: number; h: number } | null;
  /** share of border pixels that are the key colour: below ~0.9 the background is not flat */
  borderFlat: number;
}

const KEY: [number, number, number] = [255, 0, 255];

/** Magenta excess: (min(r, b) − g) / max(r, b). 1 on the key at any brightness, ≤ 0 on most objects. */
export function excess(r: number, g: number, b: number) {
  const top = Math.max(r, b, 1);
  return (Math.min(r, b) - g) / top;
}

/** Alpha from excess: opaque up to `lo`, transparent from `hi`, smooth in between. */
export function alphaOf(e: number, lo = 0.12, hi = 0.8) {
  if (e <= lo) return 1;
  if (e >= hi) return 0;
  const t = (e - lo) / (hi - lo);
  return 1 - t * t * (3 - 2 * t);
}

export function borderFlatness(px: Uint8ClampedArray, w: number, h: number) {
  let n = 0;
  let key = 0;
  const test = (i: number) => {
    n++;
    if (excess(px[i], px[i + 1], px[i + 2]) > 0.8 && Math.max(px[i], px[i + 2]) > 120) key++;
  };
  for (let x = 0; x < w; x += 2) {
    test(x * 4);
    test(((h - 1) * w + x) * 4);
  }
  for (let y = 0; y < h; y += 2) {
    test(y * w * 4);
    test((y * w + w - 1) * 4);
  }
  return n ? key / n : 0;
}

export function keyMagenta(px: Uint8ClampedArray, w: number, h: number, margin = 6): KeyResult {
  const out = new Uint8ClampedArray(px.length);
  const alpha = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    alpha[i] = alphaOf(excess(px[o], px[o + 1], px[o + 2]));
  }
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      const a = alpha[i];
      if (a <= 0.004) {
        out[o + 3] = 0;
        continue;
      }
      let r = px[o];
      let g = px[o + 1];
      let b = px[o + 2];
      // edge band: a pixel with a transparent neighbour or partial alpha
      const edge = a < 0.999 || (x > 0 && alpha[i - 1] < 0.5) || (x < w - 1 && alpha[i + 1] < 0.5) || (y > 0 && alpha[i - w] < 0.5) || (y < h - 1 && alpha[i + w] < 0.5);
      if (a < 0.999) {
        // un-mix the key that bled into the edge
        r = (r - (1 - a) * KEY[0]) / a;
        g = (g - (1 - a) * KEY[1]) / a;
        b = (b - (1 - a) * KEY[2]) / a;
      }
      if (edge) {
        // spill: red and blue both above green → pull both down; orange (b ≪ g) and green keep their colour
        const spill = Math.min(r, b) - g;
        if (spill > 0) {
          r -= spill * 0.9;
          b -= spill * 0.9;
        }
      }
      out[o] = clamp255(r);
      out[o + 1] = clamp255(g);
      out[o + 2] = clamp255(b);
      out[o + 3] = Math.round(a * 255);
      if (a > 0.1) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  const bbox = maxX < 0 ? null : { x: Math.max(0, minX - margin), y: Math.max(0, minY - margin), w: 0, h: 0 };
  if (bbox) {
    bbox.w = Math.min(w, maxX + margin + 1) - bbox.x;
    bbox.h = Math.min(h, maxY + margin + 1) - bbox.y;
  }
  return { data: out, width: w, height: h, bbox, borderFlat: borderFlatness(px, w, h) };
}

/** Copies the bbox out of a keyed image. */
export function crop(r: KeyResult): { data: Uint8ClampedArray; width: number; height: number } {
  if (!r.bbox) return { data: r.data, width: r.width, height: r.height };
  const { x, y, w, h } = r.bbox;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) data.set(r.data.subarray(((y + row) * r.width + x) * 4, ((y + row) * r.width + x + w) * 4), row * w * 4);
  return { data, width: w, height: h };
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
