import { renderBanner, type BannerDoc, type BannerLayout, type Lang, type Layer } from '../engine';
import { getImage, preloadDoc } from './images';
import { measure } from './measure';

/**
 * Draws a banner into a canvas element sized `cssW` CSS px wide, sharp at the device pixel ratio.
 * Returns the layout used.
 */
export function drawBanner(canvas: HTMLCanvasElement, doc: BannerDoc, lang: Lang, cssW: number, opts: { dpr?: number; skip?: (l: Layer) => boolean } = {}): BannerLayout {
  const dpr = opts.dpr ?? (window.devicePixelRatio || 1);
  const scale = (cssW / doc.format.w) * dpr;
  const w = Math.round(doc.format.w * scale);
  const h = Math.round(doc.format.h * scale);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${(cssW * doc.format.h) / doc.format.w}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return renderBanner(ctx, doc, { lang, scale, measure, image: getImage, skip: opts.skip });
}

/** Renders a finished file: waits for every image, draws at `scale`, returns a PNG or JPEG blob. */
export async function renderToBlob(doc: BannerDoc, lang: Lang, scale: number, type: 'image/png' | 'image/jpeg' = 'image/png', size?: { w: number; h: number }): Promise<Blob> {
  await preloadDoc(doc);
  const w = size?.w ?? Math.round(doc.format.w * scale);
  const h = size?.h ?? Math.round(doc.format.h * scale);
  const k = size ? Math.min(w / doc.format.w, h / doc.format.h) : scale;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  if (size) {
    // a fixed pixel size (the legacy 4K preset): fill, then centre the banner
    ctx.fillStyle = doc.background.type === 'solid' ? doc.background.color : doc.background.stops[0].color;
    ctx.fillRect(0, 0, w, h);
    ctx.translate((w - doc.format.w * k) / 2, (h - doc.format.h * k) / 2);
  }
  renderBanner(ctx, doc, { lang, scale: k, measure, image: getImage });
  return canvas.convertToBlob(type === 'image/jpeg' ? { type, quality: 0.92 } : { type });
}
