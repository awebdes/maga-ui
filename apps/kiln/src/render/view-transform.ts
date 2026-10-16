/**
 * Turns the path tracer's linear float output into display-referred pixels.
 *
 * Two view transforms:
 * - "filmic": the ACES fit three.js uses for `ACESFilmicToneMapping`, so stills match the raster
 *   preview. The Green clay references measure as filmic: one green albedo under ACES explains
 *   every sampled spot within ΔE76 ≈ 2 (Standard leaves the bright side faces 12 ΔE off).
 * - "standard": no tone mapping, a hard per-channel clamp, then sRGB. Blender's "Standard",
 *   which the silver bank guide uses.
 *
 * Alpha is straight (not premultiplied) and passes through linearly.
 */

export type ViewTransform = 'filmic' | 'standard';

export interface ViewSettings {
  transform: ViewTransform;
  /** linear multiplier applied before the transform */
  exposure: number;
}

export const DEFAULT_VIEW: ViewSettings = { transform: 'filmic', exposure: 1 };

/** Linear → sRGB electro-optical transfer, input clamped to [0, 1]. */
export function linearToSrgb(x: number): number {
  if (!(x > 0)) return 0; // also catches NaN
  if (x >= 1) return 1;
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** sRGB → linear, for decoding reference images in tests. */
export function srgbToLinear(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

const clamp01 = (x: number) => (x > 0 ? (x < 1 ? x : 1) : 0);
const rrtOdt = (x: number) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081);

/**
 * three.js `acesFilmicToneMapping` (Stephen Hill's RRT + ODT fit), linear sRGB in and out.
 * Writes the display-linear result into `out`.
 */
export function acesFilmic(r: number, g: number, b: number, out: Float32Array | number[]) {
  r /= 0.6;
  g /= 0.6;
  b /= 0.6;
  const ir = rrtOdt(0.59719 * r + 0.35458 * g + 0.04823 * b);
  const ig = rrtOdt(0.076 * r + 0.90834 * g + 0.01566 * b);
  const ib = rrtOdt(0.0284 * r + 0.13383 * g + 0.83777 * b);
  out[0] = clamp01(1.60475 * ir - 0.53108 * ig - 0.07367 * ib);
  out[1] = clamp01(-0.10208 * ir + 1.10813 * ig - 0.00605 * ib);
  out[2] = clamp01(-0.00327 * ir - 0.07276 * ig + 1.07602 * ib);
}

/** Scene-linear RGB → display sRGB (0..1) for one pixel. */
export function viewPixel(r: number, g: number, b: number, view: ViewSettings, out: Float32Array | number[]) {
  const e = view.exposure;
  if (view.transform === 'filmic') {
    acesFilmic(r * e, g * e, b * e, out);
    out[0] = linearToSrgb(out[0]);
    out[1] = linearToSrgb(out[1]);
    out[2] = linearToSrgb(out[2]);
  } else {
    out[0] = linearToSrgb(r * e);
    out[1] = linearToSrgb(g * e);
    out[2] = linearToSrgb(b * e);
  }
}

export interface FloatImage {
  width: number;
  height: number;
  /** RGBA, linear color, straight alpha, tightly packed rows (top row first). */
  data: Float32Array;
}

/**
 * Copies a GPU readback (rows padded to `rowStride` floats) into a tightly packed image.
 * `flipY` reverses row order when the source origin is bottom-left.
 */
export function unpadRows(
  src: Float32Array,
  width: number,
  height: number,
  rowStride: number,
  flipY = false,
): FloatImage {
  const out = new Float32Array(width * height * 4);
  const rowLen = width * 4;
  for (let y = 0; y < height; y++) {
    const sy = flipY ? height - 1 - y : y;
    out.set(src.subarray(sy * rowStride, sy * rowStride + rowLen), y * rowLen);
  }
  return { width, height, data: out };
}

/** Floats per padded row for a WebGPU buffer copy of an rgba32float texture. */
export function paddedRowFloats(width: number, bytesPerTexel = 16): number {
  const bytes = Math.ceil((width * bytesPerTexel) / 256) * 256;
  return bytes / 4;
}

export interface EncodedPixels {
  width: number;
  height: number;
  data: Uint8Array | Uint16Array;
  depth: 8 | 16;
}

/**
 * Applies the view transform and quantizes to 8 or 16 bits per channel.
 * Fully transparent pixels get zero color so encoders and viewers don't show garbage.
 */
export function toDisplay(img: FloatImage, depth: 8 | 16, view: ViewSettings = DEFAULT_VIEW): EncodedPixels {
  const n = img.width * img.height;
  const max = depth === 16 ? 65535 : 255;
  const out = depth === 16 ? new Uint16Array(n * 4) : new Uint8Array(n * 4);
  const d = img.data;
  const px = new Float32Array(3);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let a = d[o + 3];
    if (!(a > 0)) a = 0;
    else if (a > 1) a = 1;
    if (a === 0) {
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
      continue;
    }
    viewPixel(d[o], d[o + 1], d[o + 2], view, px);
    out[o] = Math.round(px[0] * max);
    out[o + 1] = Math.round(px[1] * max);
    out[o + 2] = Math.round(px[2] * max);
    out[o + 3] = Math.round(a * max);
  }
  return { width: img.width, height: img.height, data: out, depth };
}

/**
 * Box downscale in linear, premultiplied space (so edges don't pick up dark fringes).
 * Returns a straight-alpha linear image.
 */
export function downscale(img: FloatImage, targetW: number, targetH: number): FloatImage {
  const { width: w, height: h, data: s } = img;
  const out = new Float32Array(targetW * targetH * 4);
  const sx = w / targetW;
  const sy = h / targetH;
  for (let ty = 0; ty < targetH; ty++) {
    const y0 = ty * sy;
    const y1 = y0 + sy;
    for (let tx = 0; tx < targetW; tx++) {
      const x0 = tx * sx;
      const x1 = x0 + sx;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        if (wy <= 0) continue;
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0);
          if (wx <= 0) continue;
          const wt = wx * wy;
          const i = (y * w + x) * 4;
          const al = Math.min(1, Math.max(0, s[i + 3]));
          r += s[i] * al * wt;
          g += s[i + 1] * al * wt;
          b += s[i + 2] * al * wt;
          a += al * wt;
          wsum += wt;
        }
      }
      const o = (ty * targetW + tx) * 4;
      const A = wsum > 0 ? a / wsum : 0;
      out[o + 3] = A;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
    }
  }
  return { width: targetW, height: targetH, data: out };
}

/** Bounding box of pixels with alpha above a threshold, or null if the image is empty. */
export function alphaBounds(img: FloatImage, threshold = 1 / 255) {
  let minX = img.width, minY = img.height, maxX = -1, maxY = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}
