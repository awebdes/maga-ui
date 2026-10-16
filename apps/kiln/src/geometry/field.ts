/**
 * 2D signed distance field from a rasterized shape.
 *
 * Coverage (anti-aliased alpha) seeds a sub-pixel accurate Euclidean distance transform
 * (the TinySDF approach): edge pixels start at their fractional distance to the 50 % contour,
 * then Felzenszwalb's exact EDT runs on the inside and the outside separately.
 */

export interface Field {
  /** samples per row / column */
  w: number;
  h: number;
  /** world units per sample */
  px: number;
  /** world position of sample (0, 0) (pixel center), y grows with row index */
  x0: number;
  y0: number;
  /** signed distance in world units, negative inside */
  d: Float32Array;
}

const INF = 1e20;

function edt1d(
  grid: Float64Array,
  offset: number,
  stride: number,
  length: number,
  f: Float64Array,
  v: Uint32Array,
  z: Float64Array,
) {
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  f[0] = grid[offset];
  for (let q = 1, k = 0, s = 0; q < length; q++) {
    f[q] = grid[offset + q * stride];
    const q2 = q * q;
    do {
      const r = v[k];
      s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2;
    } while (s <= z[k] && --k > -1);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  for (let q = 0, k = 0; q < length; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    const qr = q - r;
    grid[offset + q * stride] = f[r] + qr * qr;
  }
}

function edt2d(grid: Float64Array, w: number, h: number) {
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const v = new Uint32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) edt1d(grid, x, w, h, f, v, z);
  for (let y = 0; y < h; y++) edt1d(grid, y * w, 1, w, f, v, z);
}

/**
 * @param coverage 0..1 per pixel (row-major, row 0 at world y0)
 */
export function fieldFromCoverage(
  coverage: ArrayLike<number>,
  w: number,
  h: number,
  px: number,
  x0: number,
  y0: number,
): Field {
  const n = w * h;
  const outer = new Float64Array(n);
  const inner = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = coverage[i];
    if (a <= 0) {
      outer[i] = INF;
      inner[i] = 0;
    } else if (a >= 1) {
      outer[i] = 0;
      inner[i] = INF;
    } else {
      const dd = 0.5 - a;
      outer[i] = dd > 0 ? dd * dd : 0;
      inner[i] = dd < 0 ? dd * dd : 0;
    }
  }
  edt2d(outer, w, h);
  edt2d(inner, w, h);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    d[i] = (Math.sqrt(outer[i]) - Math.sqrt(inner[i])) * px;
  }
  return { w, h, px, x0, y0, d };
}

/** Bilinear sample of any per-sample array laid out like the field. */
export function sampleBilinear(field: Field, data: Float32Array, x: number, y: number): number {
  const fx = (x - field.x0) / field.px;
  const fy = (y - field.y0) / field.px;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const w = field.w;
  const h = field.h;
  const x0 = ix < 0 ? 0 : ix >= w ? w - 1 : ix;
  const x1 = ix + 1 < 0 ? 0 : ix + 1 >= w ? w - 1 : ix + 1;
  const y0 = iy < 0 ? 0 : iy >= h ? h - 1 : iy;
  const y1 = iy + 1 < 0 ? 0 : iy + 1 >= h ? h - 1 : iy + 1;
  const a = data[y0 * w + x0];
  const b = data[y0 * w + x1];
  const c = data[y1 * w + x0];
  const d = data[y1 * w + x1];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/**
 * Local half-width: for every sample, the deepest interior distance within `radius`.
 * Thin strokes get a small value, wide bodies a large one; the mesher clamps the bevel radius
 * to it so thin parts turn into rounded bars instead of vanishing.
 * Separable square max filter (van Herk / Gil-Werman), O(n) per pass.
 */
export function localHalfWidth(field: Field, radius: number): Float32Array {
  const { w, h, d } = field;
  const k = Math.max(1, Math.round(radius / field.px));
  const depth = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) depth[i] = d[i] < 0 ? -d[i] : 0;
  const tmp = new Float32Array(w * h);
  maxFilter1d(depth, tmp, w, h, k, true);
  const out = new Float32Array(w * h);
  maxFilter1d(tmp, out, w, h, k, false);
  return out;
}

function maxFilter1d(src: Float32Array, dst: Float32Array, w: number, h: number, k: number, horizontal: boolean) {
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const win = 2 * k + 1;
  const g = new Float32Array(len + win);
  const hbuf = new Float32Array(len + win);
  const line = new Float32Array(len + 2 * k);
  for (let l = 0; l < lines; l++) {
    // padded line
    for (let i = 0; i < len + 2 * k; i++) {
      const j = i - k;
      if (j < 0 || j >= len) line[i] = 0;
      else line[i] = horizontal ? src[l * w + j] : src[j * w + l];
    }
    const n = len + 2 * k;
    for (let i = 0; i < n; i++) g[i] = i % win === 0 ? line[i] : Math.max(g[i - 1], line[i]);
    for (let i = n - 1; i >= 0; i--) hbuf[i] = i === n - 1 || (i + 1) % win === 0 ? line[i] : Math.max(hbuf[i + 1], line[i]);
    for (let j = 0; j < len; j++) {
      const lo = j; // window [j, j + 2k] in padded coords = [j - k, j + k] original
      const hi = j + 2 * k;
      const v = Math.max(hbuf[lo], g[hi]);
      if (horizontal) dst[l * w + j] = v;
      else dst[j * w + l] = v;
    }
  }
}
