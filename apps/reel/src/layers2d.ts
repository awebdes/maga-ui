/**
 * 2D layers composited with the 3D render: the background (with "behind" text) and the front text.
 * All sizes are relative to frame height, so preview and export match at any resolution.
 */
import type { Background, TextLayer } from './doc';
import { ease } from './doc';

/** sample that makes the browser fetch both Latin and Cyrillic subsets */
export const FONT_SAMPLE = 'Aa Яя Ўў Ққ Ғғ Ҳҳ 0123';

/** all with Cyrillic */
export const FONTS: { id: string; label: string }[] = [
  { id: 'Geist', label: 'Geist' },
  { id: 'Inter Tight', label: 'Inter Tight' },
  { id: 'Manrope', label: 'Manrope' },
  { id: 'Unbounded', label: 'Unbounded' },
  { id: 'Playfair Display', label: 'Playfair' },
];

let noiseTile: HTMLCanvasElement | null = null;
function noise() {
  if (noiseTile) return noiseTile;
  const s = 256;
  noiseTile = document.createElement('canvas');
  noiseTile.width = noiseTile.height = s;
  const c = noiseTile.getContext('2d')!;
  const img = c.createImageData(s, s);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < s * s; i++) {
    const v = rnd() * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  return noiseTile;
}

export function drawBackground(c: CanvasRenderingContext2D, bg: Background, w: number, h: number) {
  c.clearRect(0, 0, w, h);
  if (bg.kind === 'transparent') return;
  if (bg.kind === 'solid') {
    c.fillStyle = bg.a;
    c.fillRect(0, 0, w, h);
  } else if (bg.kind === 'linear') {
    const a = ((bg.angle - 90) * Math.PI) / 180;
    const len = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a));
    const dx = (Math.cos(a) * len) / 2;
    const dy = (Math.sin(a) * len) / 2;
    const g = c.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy);
    g.addColorStop(0, bg.a);
    g.addColorStop(1, bg.b);
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  } else if (bg.kind === 'radial') {
    const r = Math.hypot(w, h) * 0.62;
    const g = c.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, r);
    g.addColorStop(0, bg.a);
    g.addColorStop(1, bg.b);
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  } else {
    // mesh: base B, glows of A (top left) and C (bottom right), angle turns the pair
    c.fillStyle = bg.b;
    c.fillRect(0, 0, w, h);
    const a = (bg.angle * Math.PI) / 180;
    const R = Math.max(w, h) * 0.75;
    const blob = (x: number, y: number, col: string) => {
      const g = c.createRadialGradient(x, y, 0, x, y, R);
      g.addColorStop(0, col);
      g.addColorStop(1, hexA(col, 0));
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    };
    const ox = Math.cos(a) * w * 0.38;
    const oy = Math.sin(a) * h * 0.34;
    blob(w / 2 - ox, h / 2 - oy, bg.a);
    blob(w / 2 + ox, h / 2 + oy, bg.c);
  }
  if (bg.noise > 0) {
    c.save();
    c.globalAlpha = bg.noise * 0.09;
    c.globalCompositeOperation = 'overlay';
    c.fillStyle = c.createPattern(noise(), 'repeat')!;
    c.fillRect(0, 0, w, h);
    c.restore();
  }
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** bounds in frame-relative units (0..1) for hit testing and the selection frame */
export interface TextBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function textProgress(t: TextLayer, time: number) {
  if (t.anim === 'none') return 1;
  return Math.min(1, Math.max(0, (time - t.start) / Math.max(0.01, t.dur)));
}

export function drawTexts(c: CanvasRenderingContext2D, texts: TextLayer[], layer: 'front' | 'behind', time: number, w: number, h: number): TextBox[] {
  const boxes: TextBox[] = [];
  for (const t of texts) {
    if (!t.visible || t.layer !== layer) continue;
    const box = measure(c, t, w, h);
    boxes.push(box);
    const p = textProgress(t, time);
    if (p <= 0) continue;
    const px = t.size * h;
    c.save();
    c.font = `${t.weight} ${px}px "${t.font}"`;
    c.letterSpacing = `${t.tracking * px}px`;
    c.fillStyle = t.color;
    c.textAlign = t.align;
    c.textBaseline = 'middle';
    const lines = t.text.split('\n');
    const lh = px * t.leading;
    const x = t.x * w;
    const y0 = t.y * h - ((lines.length - 1) * lh) / 2;
    let alpha = 1;
    let dy = 0;
    let scale = 1;
    let blur = 0;
    let chars = Infinity;
    const e = ease('out', p);
    switch (t.anim) {
      case 'fade':
        alpha = ease('smooth', p);
        break;
      case 'rise':
        alpha = Math.min(1, p * 1.6);
        dy = (1 - e) * px * 0.9;
        break;
      case 'blur':
        alpha = ease('smooth', p);
        blur = (1 - e) * px * 0.35;
        scale = 1 + (1 - e) * 0.06;
        break;
      case 'pop':
        alpha = Math.min(1, p * 3);
        scale = 0.6 + 0.4 * ease('back', p);
        break;
      case 'type':
        chars = Math.floor(t.text.replace(/\n/g, '').length * p);
        break;
    }
    c.globalAlpha = alpha;
    if (blur > 0.3) c.filter = `blur(${blur.toFixed(1)}px)`;
    if (scale !== 1) {
      const cx = box.x * w + (box.w * w) / 2;
      const cy = box.y * h + (box.h * h) / 2;
      c.translate(cx, cy);
      c.scale(scale, scale);
      c.translate(-cx, -cy);
    }
    let left = chars;
    lines.forEach((line, i) => {
      if (left <= 0) return;
      const s = left >= line.length ? line : line.slice(0, left);
      left -= line.length;
      c.fillText(s, x, y0 + i * lh + dy);
    });
    c.restore();
  }
  return boxes;
}

function measure(c: CanvasRenderingContext2D, t: TextLayer, w: number, h: number): TextBox {
  const px = t.size * h;
  c.save();
  c.font = `${t.weight} ${px}px "${t.font}"`;
  c.letterSpacing = `${t.tracking * px}px`;
  const lines = t.text.split('\n');
  const tw = Math.max(1, ...lines.map((l) => c.measureText(l).width));
  c.restore();
  const lh = px * t.leading;
  const th = lines.length * lh;
  const x = t.x * w - (t.align === 'center' ? tw / 2 : t.align === 'right' ? tw : 0);
  const y = t.y * h - th / 2;
  return { id: t.id, x: x / w, y: y / h, w: tw / w, h: th / h };
}
