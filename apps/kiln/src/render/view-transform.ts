/**
 * Turns the path tracer's linear float output into display-referred pixels.
 *
 * Matches Blender's "Standard" view transform used by the bank guide: no tone mapping,
 * a hard per-channel clamp to [0, 1], then the sRGB transfer curve. Alpha is straight
 * (not premultiplied) and passes through linearly.
 */

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
export function toDisplay(img: FloatImage, depth: 8 | 16): EncodedPixels {
  const n = img.width * img.height;
  const max = depth === 16 ? 65535 : 255;
  const out = depth === 16 ? new Uint16Array(n * 4) : new Uint8Array(n * 4);
  const d = img.data;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let a = d[o + 3];
    if (!(a > 0)) a = 0;
    else if (a > 1) a = 1;
    if (a === 0) {
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
      continue;
    }
    out[o] = Math.round(linearToSrgb(d[o]) * max);
    out[o + 1] = Math.round(linearToSrgb(d[o + 1]) * max);
    out[o + 2] = Math.round(linearToSrgb(d[o + 2]) * max);
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
