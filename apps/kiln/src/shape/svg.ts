import DOMPurify from 'dompurify';

/**
 * SVG → coverage raster. The browser resolves strokes, fill rules, overlaps and transforms,
 * so the mesher only ever sees "how much of this pixel is shape".
 */

export interface Coverage {
  /** 0..1, row 0 = bottom (world y up) */
  data: Float32Array;
  w: number;
  h: number;
  /** world units per pixel; the longest side of the shape is 1 unit */
  px: number;
  /** world position of pixel (0, 0) center */
  x0: number;
  y0: number;
}

export interface RasterOptions {
  /** pixels across the longest side of the shape */
  resolution: number;
  /** empty border around the shape, in world units (needs to exceed the bevel radius) */
  margin?: number;
}

export function sanitizeSvg(text: string): string {
  const clean = DOMPurify.sanitize(text, {
    USE_PROFILES: { svg: true, svgFilters: false },
    FORBID_TAGS: ['image', 'foreignObject', 'script', 'style'],
  });
  if (!clean || !/<svg[\s>]/i.test(clean)) throw new Error('This file has no SVG drawing in it');
  return clean;
}

interface SvgInfo {
  markup: string;
  vbX: number;
  vbY: number;
  vbW: number;
  vbH: number;
}

function parseSvg(text: string): SvgInfo {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== 'svg') throw new Error('This file has no SVG drawing in it');
  let vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some((n) => !Number.isFinite(n))) {
    const w = parseFloat(svg.getAttribute('width') || '256') || 256;
    const h = parseFloat(svg.getAttribute('height') || '256') || 256;
    vb = [0, 0, w, h];
    svg.setAttribute('viewBox', vb.join(' '));
  }
  // solid black on transparent: we only read alpha
  svg.setAttribute('color', '#000');
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('preserveAspectRatio', 'none');
  return { markup: new XMLSerializer().serializeToString(svg), vbX: vb[0], vbY: vb[1], vbW: vb[2], vbH: vb[3] };
}

async function loadImage(markup: string, w: number, h: number): Promise<HTMLImageElement> {
  const sized = markup.replace(/<svg\b/i, `<svg width="${w}" height="${h}"`);
  const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function alphaBox(data: Uint8ClampedArray, w: number, h: number) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX: maxX + 1, maxY: maxY + 1 };
}

/** Rasterizes an SVG so the drawn content (not the viewBox) spans `resolution` pixels. */
export async function rasterizeSvg(text: string, opts: RasterOptions): Promise<Coverage> {
  const info = parseSvg(sanitizeSvg(text));
  const margin = opts.margin ?? 0.2;

  // 1. probe the drawn bounds inside the viewBox
  const probe = 512;
  const ps = probe / Math.max(info.vbW, info.vbH);
  const pw = Math.max(1, Math.round(info.vbW * ps));
  const ph = Math.max(1, Math.round(info.vbH * ps));
  const probeImg = await loadImage(info.markup, pw, ph);
  const pc = new OffscreenCanvas(pw, ph);
  const pctx = pc.getContext('2d', { willReadFrequently: true })!;
  pctx.drawImage(probeImg, 0, 0, pw, ph);
  const box = alphaBox(pctx.getImageData(0, 0, pw, ph).data, pw, ph);
  if (!box) throw new Error('The SVG has nothing filled in it');
  // content box in viewBox units, padded by one probe pixel
  const cx0 = (box.minX - 1) / ps;
  const cy0 = (box.minY - 1) / ps;
  const cw = (box.maxX - box.minX + 2) / ps;
  const ch = (box.maxY - box.minY + 2) / ps;

  // 2. final raster: content longest side = resolution px, plus margin
  const unit = Math.max(cw, ch); // viewBox units per world unit
  const pxPerUnit = opts.resolution; // pixels per world unit
  const marginPx = Math.ceil(margin * pxPerUnit);
  const W = Math.ceil((cw / unit) * pxPerUnit) + marginPx * 2;
  const H = Math.ceil((ch / unit) * pxPerUnit) + marginPx * 2;
  const scale = pxPerUnit / unit; // canvas px per viewBox unit
  const fullW = Math.ceil(info.vbW * scale);
  const fullH = Math.ceil(info.vbH * scale);
  const img = await loadImage(info.markup, fullW, fullH);
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, marginPx - cx0 * scale, marginPx - cy0 * scale, fullW, fullH);
  const rgba = ctx.getImageData(0, 0, W, H).data;

  // flip so row 0 is the bottom, and center the content on the origin
  const data = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const src = (H - 1 - y) * W;
    for (let x = 0; x < W; x++) data[y * W + x] = rgba[(src + x) * 4 + 3] / 255;
  }
  const px = 1 / pxPerUnit;
  const contentW = cw / unit;
  const contentH = ch / unit;
  return {
    data,
    w: W,
    h: H,
    px,
    x0: -contentW / 2 - marginPx * px + px / 2,
    y0: -contentH / 2 - marginPx * px + px / 2,
  };
}
