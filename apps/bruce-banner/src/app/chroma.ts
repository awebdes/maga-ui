/**
 * Cuts a generated illustration out of its flat magenta background. Pure functions over RGBA
 * bytes, so Node tests run them and the worker just wraps them. The model is asked for #FF00FF but
 * paints it lighter (about #FC39FB) and returns JPEG, so the key is measured, not assumed:
 *  1. the key colour is the median of the frame's border; the border must be flat around it and
 *     magenta at all, else the model drew a floor or a gradient and the caller retries
 *  2. alpha from the magenta excess (red and blue above green, relative to brightness) as a share of
 *     the key's own excess: 1 on the key, ≤ 0 on green, orange and white
 *  3. the edge (the anti-aliased ring and the solid ring JPEG bleeds into) takes the colour of the
 *     object just inside it; a thin detail with no inside is un-mixed, C = (I − (1 − α)·K) / α;
 *     near-clear pixels become fully clear (un-mixing them would amplify JPEG noise into a haze)
 *  4. leftover spill (red and blue above green) is pulled down only in the edge band, so the brand
 *     orange (red ≫ blue) is never touched
 *  5. crop to the opaque bounds with a small margin
 */
export interface KeyResult {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  bbox: { x: number; y: number; w: number; h: number } | null;
  /** share of border pixels that are the key colour: below ~0.85 the background is not flat */
  borderFlat: number;
  /** the key colour found on the border */
  key: [number, number, number];
}

type RGB = [number, number, number];

/** Magenta excess: (min(r, b) − g) / max(r, b). High on magenta at any brightness, ≤ 0 on most objects. */
export function excess(r: number, g: number, b: number) {
  const top = Math.max(r, b, 1);
  return (Math.min(r, b) - g) / top;
}

/** Alpha from the excess as a share of the key's: opaque up to `lo`, clear from `hi`, smooth in between. */
export function alphaOf(share: number, lo = 0.15, hi = 0.85) {
  if (share <= lo) return 1;
  if (share >= hi) return 0;
  const t = (share - lo) / (hi - lo);
  return 1 - t * t * (3 - 2 * t);
}

function borderPixels(w: number, h: number) {
  const out: number[] = [];
  for (let x = 0; x < w; x += 2) out.push(x * 4, ((h - 1) * w + x) * 4);
  for (let y = 0; y < h; y += 2) out.push(y * w * 4, (y * w + w - 1) * 4);
  return out;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1] ?? 0;
};

/** The background colour: the median of the frame's border, channel by channel. */
export function estimateKey(px: Uint8ClampedArray, w: number, h: number): RGB {
  const at = borderPixels(w, h);
  return [median(at.map((o) => px[o])), median(at.map((o) => px[o + 1])), median(at.map((o) => px[o + 2]))];
}

/** Share of border pixels that are the key: close to it (JPEG noise allowed) and the key is magenta. */
export function borderFlatness(px: Uint8ClampedArray, w: number, h: number, key: RGB = estimateKey(px, w, h)) {
  if (excess(...key) < 0.45 || Math.max(key[0], key[2]) < 120) return 0;
  const at = borderPixels(w, h);
  let n = 0;
  for (const o of at) if (Math.max(Math.abs(px[o] - key[0]), Math.abs(px[o + 1] - key[1]), Math.abs(px[o + 2] - key[2])) <= 36) n++;
  return at.length ? n / at.length : 0;
}

export function keyMagenta(px: Uint8ClampedArray, w: number, h: number, margin = 6): KeyResult {
  const key = estimateKey(px, w, h);
  // a key that is not magenta at all keys nothing out; the border check reports it
  const keyExcess = Math.max(0.45, excess(...key));
  const out = new Uint8ClampedArray(px.length);
  const alpha = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const a = alphaOf(excess(px[o], px[o + 1], px[o + 2]) / keyExcess);
    alpha[i] = a < 0.03 ? 0 : a;
  }
  // interior: solid with solid neighbours; JPEG bleeds the key into the outermost solid ring too
  const interior = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      interior[i] = alpha[i] >= 0.999 && alpha[i - 1] >= 0.999 && alpha[i + 1] >= 0.999 && alpha[i - w] >= 0.999 && alpha[i + w] >= 0.999 ? 1 : 0;
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
      if (a === 0) {
        out[o + 3] = 0;
        continue;
      }
      let r = px[o];
      let g = px[o + 1];
      let b = px[o + 2];
      // edge band: everything that is not interior, the anti-aliased ring and the solid ring inside it
      const edge = !interior[i];
      if (edge) {
        // defringe: the edge takes the colour of the object just inside it…
        const inside = interiorAround(px, interior, w, h, x, y);
        if (inside) [r, g, b] = inside;
        else if (a < 0.999) {
          // …or, with no interior nearby (a thin detail), the key is un-mixed out of it
          r = (r - (1 - a) * key[0]) / a;
          g = (g - (1 - a) * key[1]) / a;
          b = (b - (1 - a) * key[2]) / a;
        }
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
  return { data: out, width: w, height: h, bbox, borderFlat: borderFlatness(px, w, h, key), key };
}

/** Average colour of the interior pixels within 2 px, or null when there are none. */
function interiorAround(px: Uint8ClampedArray, interior: Uint8Array, w: number, h: number, x: number, y: number): RGB | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let dy = -2; dy <= 2; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= h) continue;
    for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx;
      if (xx < 0 || xx >= w || !interior[yy * w + xx]) continue;
      const o = (yy * w + xx) * 4;
      r += px[o];
      g += px[o + 1];
      b += px[o + 2];
      n++;
    }
  }
  return n ? [r / n, g / n, b / n] : null;
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
