import { describe, expect, it } from 'vitest';
import { alphaOf, borderFlatness, crop, excess, keyMagenta } from '../../src/app/chroma';

type RGB = [number, number, number];
const MAGENTA: RGB = [255, 0, 255];
const GREEN: RGB = [82, 174, 48];
const ORANGE: RGB = [244, 130, 31];

/** w×h image filled by `fill(x, y)`. */
function image(w: number, h: number, fill: (x: number, y: number) => RGB) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fill(x, y);
      px.set([r, g, b, 255], (y * w + x) * 4);
    }
  return px;
}
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] * (1 - t) + b[i] * t)) as RGB;
const at = (px: Uint8ClampedArray, w: number, x: number, y: number) => Array.from(px.subarray((y * w + x) * 4, (y * w + x) * 4 + 4));

describe('magenta excess', () => {
  it('is 1 on the key in light and in shadow, ≤ 0 on brand colours and white', () => {
    expect(excess(...MAGENTA)).toBe(1);
    expect(excess(128, 0, 128)).toBe(1);
    expect(excess(...GREEN)).toBeLessThan(0);
    expect(excess(...ORANGE)).toBeLessThan(0);
    expect(excess(255, 255, 255)).toBe(0);
  });

  it('maps to alpha: opaque objects, transparent key, smooth between', () => {
    expect(alphaOf(-0.5)).toBe(1);
    expect(alphaOf(0.12)).toBe(1);
    expect(alphaOf(0.8)).toBe(0);
    expect(alphaOf(1)).toBe(0);
    const mid = alphaOf(0.46);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    expect(alphaOf(0.3)).toBeGreaterThan(alphaOf(0.6));
  });
});

describe('keyMagenta', () => {
  // a green square with an orange stripe on magenta, edges mixed 50/50 with the key
  const W = 40;
  const H = 40;
  const px = image(W, H, (x, y) => {
    const inside = x >= 12 && x < 28 && y >= 12 && y < 28;
    const edge = (x === 11 || x === 28) && y >= 11 && y <= 28;
    if (inside) return y >= 18 && y < 22 ? ORANGE : GREEN;
    if (edge) return mix(GREEN, MAGENTA, 0.5);
    return MAGENTA;
  });
  const r = keyMagenta(px, W, H, 2);

  it('makes the background transparent and the object opaque', () => {
    expect(at(r.data, W, 2, 2)[3]).toBe(0);
    expect(at(r.data, W, 20, 14)[3]).toBe(255);
    expect(at(r.data, W, 20, 14).slice(0, 3)).toEqual(GREEN);
  });

  it('leaves the brand orange untouched', () => {
    expect(at(r.data, W, 20, 19).slice(0, 3)).toEqual(ORANGE);
  });

  it('un-mixes the key out of edge pixels', () => {
    const [red, g, b, a] = at(r.data, W, 11, 20);
    expect(a).toBeGreaterThan(40);
    expect(a).toBeLessThan(230);
    // the recovered colour is green, not pink
    expect(g).toBeGreaterThan(red);
    expect(g).toBeGreaterThan(b);
  });

  it('crops to the object with a margin', () => {
    expect(r.bbox).toEqual({ x: 9, y: 9, w: 22, h: 22 });
    const c = crop(r);
    expect([c.width, c.height]).toEqual([22, 22]);
    expect(c.data.length).toBe(22 * 22 * 4);
  });

  it('finds nothing on a blank key', () => {
    expect(keyMagenta(image(8, 8, () => MAGENTA), 8, 8).bbox).toBeNull();
  });
});

describe('border flatness', () => {
  it('is 1 on a flat key and low when the model drew a floor', () => {
    expect(borderFlatness(image(32, 32, () => MAGENTA), 32, 32)).toBe(1);
    const floor = image(32, 32, (_x, y) => (y > 20 ? [180, 160, 170] : MAGENTA));
    expect(borderFlatness(floor, 32, 32)).toBeLessThan(0.85);
  });
});
