/**
 * Canvas 2D renderer, ported from the legacy engine (xOe and friends). One function serves the
 * stage, thumbnails, the phone preview and export, on a canvas or an OffscreenCanvas, so what the
 * editor shows is what ships. Coordinates are multiplied by the scale (as the legacy did) instead
 * of transforming the context: fonts are set at output size and shadow blur stays in step.
 *
 * Fixed mode differs from the legacy only where the legacy was wrong:
 *  - glow is an erf radial gradient (the legacy fallback) on every browser, not ctx.filter;
 *  - payment logos keep their aspect ratio inside their box (Visa was squeezed to 2.32:1);
 *  - wrapping counts tracking, titles auto-fit (see layout.ts), images can be flipped.
 * `compat: true` reproduces the legacy output for the parity gate.
 */
import { assetById } from './assets';
import { fontCss } from './fonts';
import { layoutBanner, type BannerLayout, type Measure } from './layout';
import type {
  BadgeLayer,
  BadgeRowLayer,
  Background,
  BannerDoc,
  CardLayer,
  GlowLayer,
  ImageClipLayer,
  ImageLayer,
  Lang,
  Layer,
  PillLayer,
  Shadow,
  StatLayer,
  TextLayer,
} from './types';

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type DrawableImage = CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width?: number | SVGAnimatedLength; height?: number | SVGAnimatedLength };

export interface RenderOptions {
  lang: Lang;
  /** output px per design px */
  scale: number;
  measure: Measure;
  /** a decoded image for an asset id or blob ref, or null while it loads */
  image: (ref: string) => DrawableImage | null;
  compat?: boolean;
  /** paint the background (default true) */
  background?: boolean;
  /** layers to leave out (text off for contrast sampling, hidden layers) */
  skip?: (l: Layer) => boolean;
  /** a layout computed for the same doc, language and mode */
  layout?: BannerLayout;
}

export function renderBanner(ctx: Ctx, doc: BannerDoc, o: RenderOptions): BannerLayout {
  const n = o.scale;
  const lay = o.layout ?? layoutBanner(doc, o.lang, o.measure, { compat: o.compat, scale: n });
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (o.background !== false) paintBackground(ctx, doc.background, doc.format.w * n, doc.format.h * n);
  for (const l of doc.layers) {
    if (l.hidden || o.skip?.(l)) continue;
    drawLayer(ctx, l, n, lay, o);
  }
  ctx.restore();
  return lay;
}

export function paintBackground(ctx: Ctx, bg: Background, w: number, h: number) {
  if (bg.type === 'solid') {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  // CSS angle semantics, as the legacy bOe: 90deg runs left to right over the whole rectangle
  const a = ((bg.angle - 90) * Math.PI) / 180;
  const cx = w / 2;
  const cy = h / 2;
  const len = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a));
  const g = ctx.createLinearGradient(cx - (Math.cos(a) * len) / 2, cy - (Math.sin(a) * len) / 2, cx + (Math.cos(a) * len) / 2, cy + (Math.sin(a) * len) / 2);
  for (const s of bg.stops) g.addColorStop(clamp01(s.position), s.color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawLayer(ctx: Ctx, l: Layer, n: number, lay: BannerLayout, o: RenderOptions) {
  switch (l.kind) {
    case 'glow':
      return drawGlow(ctx, l, n, !!o.compat);
    case 'image':
      return drawImage(ctx, l, n, o);
    case 'imageClip':
      return drawImageClip(ctx, l, n, o);
    case 'card':
      return drawCard(ctx, l, n, o);
    case 'pill':
      return drawPill(ctx, l, n, o);
    case 'badge':
      return drawBadge(ctx, l, n, lay);
    case 'badgeRow':
      return drawBadgeRow(ctx, l, n, lay);
    case 'text':
      return drawText(ctx, l, n, lay, !!o.compat);
    case 'stat':
      return drawStat(ctx, l, n, lay);
  }
}

/* ---------- glow ---------- */

function drawGlow(ctx: Ctx, l: GlowLayer, n: number, compat: boolean) {
  const r = l.r * n;
  const blur = l.blur * n;
  ctx.save();
  ctx.globalAlpha = l.opacity;
  if (compat && typeof ctx.filter === 'string') {
    ctx.filter = `blur(${blur}px)`;
    ctx.fillStyle = l.color;
    ctx.beginPath();
    ctx.arc(l.cx * n, l.cy * n, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.filter = 'none';
  } else {
    // a blurred disc: alpha falls off as the Gaussian CDF across the edge (legacy fallback)
    const R = r + 3 * blur;
    const g = ctx.createRadialGradient(l.cx * n, l.cy * n, 0, l.cx * n, l.cy * n, R);
    for (let i = 0; i <= 16; i++) {
      const t = (r - (i / 16) * R) / (blur * Math.SQRT2 || 1);
      g.addColorStop(i / 16, rgba(l.color, 0.5 * (1 + erf(t))));
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(l.cx * n, l.cy * n, R, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ---------- images ---------- */

function drawImage(ctx: Ctx, l: ImageLayer, n: number, o: RenderOptions) {
  const img = o.image(l.src);
  if (!img) return;
  const w = l.w * n;
  const h = l.h * n;
  ctx.save();
  setShadow(ctx, l.shadow, n);
  ctx.translate(l.cx * n, l.cy * n);
  if (l.rot) ctx.rotate((l.rot * Math.PI) / 180);
  if (l.flip) ctx.scale(-1, 1);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

function drawImageClip(ctx: Ctx, l: ImageClipLayer, n: number, o: RenderOptions) {
  const img = o.image(l.src);
  if (!img) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(l.box.x * n, l.box.y * n, l.box.width * n, l.box.height * n);
  ctx.clip();
  ctx.drawImage(img, l.img.x * n, l.img.y * n, l.img.width * n, l.img.height * n);
  ctx.restore();
}

function drawCard(ctx: Ctx, l: CardLayer, n: number, o: RenderOptions) {
  const w = l.w * n;
  const h = l.h * n;
  const r = l.radius * n;
  ctx.save();
  ctx.translate(l.cx * n, l.cy * n);
  if (l.rot) ctx.rotate((l.rot * Math.PI) / 180);
  setShadow(ctx, l.shadow, n);
  ctx.fillStyle = '#D9D9D9';
  roundRect(ctx, -w / 2, -h / 2, w, h, r);
  ctx.fill();
  clearShadow(ctx);
  const img = o.image(l.src);
  if (img) {
    ctx.save();
    roundRect(ctx, -w / 2, -h / 2, w, h, r);
    ctx.clip();
    // cover fit on the natural size
    const [iw, ih] = sizeOf(img, l.src);
    const ia = iw / ih;
    const ba = w / h;
    const dw = ia > ba ? h * ia : w;
    const dh = ia > ba ? h : w / ia;
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }
  if (l.border) {
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = l.border * n;
    roundRect(ctx, -w / 2, -h / 2, w, h, r);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPill(ctx: Ctx, l: PillLayer, n: number, o: RenderOptions) {
  const w = l.w * n;
  const h = l.h * n;
  ctx.save();
  ctx.translate(l.cx * n, l.cy * n);
  setShadow(ctx, l.shadow, n);
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, -w / 2, -h / 2, w, h, l.radius * n);
  ctx.fill();
  clearShadow(ctx);
  const img = o.image(l.icon);
  if (img) {
    const bw = l.iconBox.width;
    const bh = l.iconBox.height;
    let d = l.iconDraw;
    if (!o.compat) {
      // keep the logo's own proportions inside its draw box
      const [iw, ih] = sizeOf(img, l.icon);
      const scale = Math.min(d.width / iw, d.height / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      d = { x: d.x + (d.width - dw) / 2, y: d.y + (d.height - dh) / 2, width: dw, height: dh };
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect((-bw / 2) * n, (-bh / 2) * n, bw * n, bh * n);
    ctx.clip();
    if (l.iconRot) ctx.rotate((l.iconRot * Math.PI) / 180);
    ctx.drawImage(img, (-bw / 2 + d.x) * n, (-bh / 2 + d.y) * n, d.width * n, d.height * n);
    ctx.restore();
  }
  ctx.restore();
}

/* ---------- text ---------- */

function drawBadge(ctx: Ctx, l: BadgeLayer, n: number, lay: BannerLayout) {
  const b = lay.badges[l.id];
  if (!b || !b.text) return;
  const tracking = -0.01 * l.size * n;
  const textW = b.textW * n;
  const w = b.w * n;
  const h = b.h * n;
  ctx.save();
  ctx.font = fontCss(l.font, l.weight, l.size * n);
  ctx.translate(l.cx * n, l.cy * n);
  if (l.rot) ctx.rotate((l.rot * Math.PI) / 180);
  setShadow(ctx, l.halo, n);
  ctx.fillStyle = l.background;
  roundRect(ctx, -w / 2, -h / 2, w, h, l.radius * n);
  ctx.fill();
  clearShadow(ctx);
  ctx.fillStyle = l.foreground;
  ctx.textBaseline = 'middle';
  fillTracked(ctx, b.text, -textW / 2, 0, tracking);
  ctx.restore();
}

function drawBadgeRow(ctx: Ctx, l: BadgeRowLayer, n: number, lay: BannerLayout) {
  const row = lay.rows[l.id];
  if (!row) return;
  const tracking = -0.01 * l.size * n;
  const h = row.h * n;
  const y = row.y * n;
  ctx.save();
  ctx.font = fontCss(l.font, l.weight, l.size * n);
  ctx.textBaseline = 'middle';
  for (const it of row.items) {
    ctx.fillStyle = it.background;
    roundRect(ctx, it.x * n, y, it.w * n, h, l.radius * n);
    ctx.fill();
    ctx.fillStyle = it.foreground;
    fillTracked(ctx, it.text, (it.x + l.paddingX) * n, y + h / 2, tracking);
  }
  ctx.restore();
}

function drawText(ctx: Ctx, l: TextLayer, n: number, lay: BannerLayout, compat: boolean) {
  const t = lay.texts[l.id];
  if (!t || t.status === 'empty') return;
  const lh = t.lineHeight * n;
  const tracking = l.tracking * n;
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = l.color;
  ctx.font = fontCss(l.font, l.weight, t.size * n);
  let y = t.top * n + lh * 0.72;
  for (const line of t.lines) {
    fillTracked(ctx, line, l.x * n, y, tracking);
    y += lh;
  }
  if (t.subLines.length && l.sub) {
    const s = l.sub;
    ctx.font = fontCss(s.font, s.weight, s.size * n);
    ctx.fillStyle = compat ? 'rgba(255,255,255,0.7)' : s.color;
    let sy = t.top * n + t.lines.length * lh + s.gap * n + s.lineHeight * n * 0.72;
    for (const line of t.subLines) {
      fillTracked(ctx, line, l.x * n, sy, tracking);
      sy += s.lineHeight * n;
    }
  }
  ctx.restore();
}

function drawStat(ctx: Ctx, l: StatLayer, n: number, lay: BannerLayout) {
  const s = lay.stats[l.id];
  if (!s || (!s.text && !s.unit)) return;
  const tn = -0.02 * l.size * n;
  const tu = -0.02 * l.unitSize * n;
  const numW = s.numW * n;
  const unitW = s.unitW * n;
  const w = s.w * n;
  const h = s.h * n;
  ctx.save();
  ctx.translate(l.cx * n, l.cy * n);
  if (l.rot) ctx.rotate((l.rot * Math.PI) / 180);
  setShadow(ctx, l.halo, n);
  ctx.fillStyle = l.background;
  roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) / 2);
  ctx.fill();
  clearShadow(ctx);
  ctx.fillStyle = l.foreground;
  ctx.textBaseline = 'middle';
  ctx.font = fontCss(l.font, 700, l.size * n);
  fillTracked(ctx, s.text, -numW / 2, -h / 2 + l.paddingY * n + (l.size * n) / 2, tn);
  ctx.font = fontCss(l.font, 700, l.unitSize * n);
  fillTracked(ctx, s.unit, -unitW / 2, h / 2 - l.paddingY * n - (l.unitSize * n) / 2, tu);
  ctx.restore();
}

/* ---------- helpers ---------- */

/** Draws text with letter spacing one code point at a time (legacy w7). */
export function fillTracked(ctx: Ctx, text: string, x: number, y: number, tracking: number) {
  if (!tracking) {
    ctx.fillText(text, x, y);
    return;
  }
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + tracking;
  }
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function setShadow(ctx: Ctx, s: Shadow | undefined, n: number) {
  if (!s) return;
  ctx.shadowColor = s.color;
  ctx.shadowBlur = s.blur * n;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = s.offsetY * n;
}

function clearShadow(ctx: Ctx) {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

/** Natural size of a decoded image; the catalog size when the element cannot tell (SVG). */
function sizeOf(img: DrawableImage, ref: string): [number, number] {
  const nw = img.naturalWidth || (typeof img.width === 'number' ? img.width : 0);
  const nh = img.naturalHeight || (typeof img.height === 'number' ? img.height : 0);
  if (nw && nh) return [nw, nh];
  const a = assetById(ref);
  return a ? [a.natural.w, a.natural.h] : [1, 1];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** #RGB / #RRGGBB / rgba() with a new alpha. */
export function rgba(color: string, alpha: number) {
  const m = /^rgba?\(([^)]+)\)$/.exec(color.trim());
  if (m) {
    const [r, g, b, a = '1'] = m[1].split(',').map((s) => s.trim());
    return `rgba(${r},${g},${b},${clamp01(Number(a) * alpha)})`;
  }
  const hex = color.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex.slice(0, 6);
  const v = Number.parseInt(full, 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${clamp01(alpha)})`;
}

/** Abramowitz–Stegun erf, as the legacy NOe. */
export function erf(x: number) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  return sign * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax));
}
