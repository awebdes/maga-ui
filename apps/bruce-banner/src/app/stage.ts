/**
 * The stage: the banner as the one object on screen, about 3× and sharp at the device pixel ratio,
 * or the enabled languages stacked when "Все языки" is on. Draws the selection chrome (rotated
 * frames, handles, snap guides) in an SVG overlay and a faint "ghost" of what the selected layer
 * draws outside the slot, so cropping is visible before export.
 */
import { findLayer, frameCorners, renderBanner, rotatable, type Frame, type Lang, type Layer, type TextBlock, type TextLayer } from '../engine';
import { drawBanner } from '../render/draw';
import { getImage, onImageLoad } from '../render/images';
import { measure } from '../render/measure';
import type { Editor } from './state';

export interface Placement {
  lang: Lang;
  /** banner origin in client px */
  x: number;
  y: number;
  /** CSS px per design px */
  zoom: number;
  w: number;
  h: number;
  el: HTMLElement;
  canvas: HTMLCanvasElement;
  active: boolean;
}

export type Handle = { kind: 'scale'; corner: number } | { kind: 'rotate' };

export interface Guide {
  axis: 'x' | 'y';
  /** design px */
  at: number;
}

const NS = 'http://www.w3.org/2000/svg';
const LANG_NAME: Record<Lang, string> = { ru: 'Русский', uz: 'O‘zbekcha', en: 'English' };
/** layers whose hit area is the frame (images hit on their alpha, glow only from the list) */
const HANDLE_R = 9;
const KNOB_GAP = 24;

export class Stage {
  placements: Placement[] = [];
  hover: string | null = null;
  guides: Guide[] = [];
  /** room the islands take around the banner, client px */
  insets = { left: 292, right: 352, top: 88, bottom: 112 };
  private queued = false;
  private frames = new Map<Lang, HTMLElement>();
  private alpha = new Map<string, { w: number; h: number; data: Uint8ClampedArray } | null>();

  constructor(
    private editor: Editor,
    private root: HTMLElement,
    private bannersEl: HTMLElement,
    private overlay: SVGSVGElement,
    private ghost: HTMLCanvasElement,
  ) {
    onImageLoad(() => this.invalidate());
    new ResizeObserver(() => this.invalidate()).observe(root);
    window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener?.('change', () => this.invalidate());
  }

  invalidate() {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.render();
    });
  }

  /** Where each banner sits for the current viewport, mode and languages. */
  private place() {
    const doc = this.editor.doc;
    if (!doc) {
      this.placements = [];
      return;
    }
    const W = this.root.clientWidth;
    const H = this.root.clientHeight;
    const { left, right, top, bottom } = this.insets;
    const availW = Math.max(200, W - left - right);
    const availH = Math.max(120, H - top - bottom);
    const langs = this.editor.allLangs ? doc.languages.enabled : [this.editor.lang];
    const label = this.editor.allLangs ? 26 : 0;
    const gap = this.editor.allLangs ? 22 : 0;
    const n = langs.length;
    let zoom = Math.min(4, availW / doc.format.w, (availH * (n > 1 ? 1 : 0.86)) / doc.format.h);
    if (n > 1) zoom = Math.min(zoom, (availH - (n - 1) * gap - n * label) / (n * doc.format.h));
    zoom = Math.max(0.5, zoom);
    const bw = doc.format.w * zoom;
    const bh = doc.format.h * zoom;
    const total = n * (bh + label) + (n - 1) * gap;
    const x = Math.round(left + (availW - bw) / 2);
    let y = Math.round(top + (availH - total) / 2);
    const next: Placement[] = [];
    for (const lang of langs) {
      y += label;
      let el = this.frames.get(lang);
      if (!el) {
        el = document.createElement('div');
        el.className = 'bframe';
        el.dataset.lang = lang;
        el.innerHTML = `<span class="bframe-label caps"></span><canvas role="img"></canvas>`;
        this.frames.set(lang, el);
      }
      if (el.parentElement !== this.bannersEl) this.bannersEl.appendChild(el);
      const active = lang === this.editor.lang;
      el.classList.toggle('is-active', active);
      el.classList.toggle('is-stacked', n > 1);
      el.querySelector('.bframe-label')!.textContent = `${lang.toUpperCase()} · ${LANG_NAME[lang]}`;
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.style.setProperty('--zoom', String(zoom));
      const canvas = el.querySelector('canvas')!;
      canvas.setAttribute('aria-label', `Баннер, ${LANG_NAME[lang]}`);
      next.push({ lang, x, y, zoom, w: bw, h: bh, el, canvas, active });
      y += bh + gap;
    }
    for (const [lang, el] of this.frames) if (!langs.includes(lang)) el.remove();
    this.placements = next;
  }

  get active(): Placement | undefined {
    return this.placements.find((p) => p.active) ?? this.placements[0];
  }

  render() {
    this.place();
    const doc = this.editor.doc;
    const dpr = window.devicePixelRatio || 1;
    if (doc) for (const p of this.placements) drawBanner(p.canvas, doc, p.lang, p.w, { dpr });
    this.renderGhost(dpr);
    this.renderOverlay();
  }

  private renderGhost(dpr: number) {
    const W = this.root.clientWidth;
    const H = this.root.clientHeight;
    const g = this.ghost;
    if (g.width !== Math.round(W * dpr) || g.height !== Math.round(H * dpr)) {
      g.width = Math.round(W * dpr);
      g.height = Math.round(H * dpr);
      g.style.width = `${W}px`;
      g.style.height = `${H}px`;
    }
    const ctx = g.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, g.width, g.height);
    const doc = this.editor.doc;
    const p = this.active;
    const sel = this.editor.selection && doc ? findLayer(doc, this.editor.selection) : null;
    if (!doc || !p || !sel || sel.hidden || sel.kind === 'text' || sel.kind === 'badgeRow') return;
    // the banner canvases are opaque and sit above: only what spills out of the slot shows
    ctx.setTransform(1, 0, 0, 1, p.x * dpr, p.y * dpr);
    renderBanner(ctx, doc, { lang: p.lang, scale: p.zoom * dpr, measure, image: getImage, background: false, layout: this.editor.layout(p.lang) ?? undefined, skip: (l) => l.id !== sel.id });
  }

  /* ---------- coordinates ---------- */

  toScreen(p: Placement, x: number, y: number): [number, number] {
    return [p.x + x * p.zoom, p.y + y * p.zoom];
  }

  toDesign(p: Placement, sx: number, sy: number): [number, number] {
    return [(sx - p.x) / p.zoom, (sy - p.y) / p.zoom];
  }

  placementAt(sx: number, sy: number, pad = 0): Placement | undefined {
    return this.placements.find((p) => sx >= p.x - pad && sx <= p.x + p.w + pad && sy >= p.y - pad && sy <= p.y + p.h + pad);
  }

  frameOf(id: string, lang = this.editor.lang): Frame | undefined {
    return this.editor.layout(lang)?.frames[id];
  }

  /** The topmost layer under a design point: frames, with images tested on their alpha. */
  hitLayer(p: Placement, x: number, y: number): string | null {
    const doc = this.editor.doc;
    const lay = this.editor.layout(p.lang);
    if (!doc || !lay) return null;
    const pad = 3 / p.zoom;
    for (let i = doc.layers.length - 1; i >= 0; i--) {
      const l = doc.layers[i];
      if (l.hidden || l.kind === 'glow') continue;
      const f = lay.frames[l.id];
      if (!f || !inFrame(f, x, y, l.kind === 'image' ? 0 : pad)) continue;
      if (l.kind === 'image' && !this.alphaHit(l, x, y)) continue;
      if (l.kind === 'text' && !textHit(l, lay.texts[l.id], x, y, pad)) continue;
      return l.id;
    }
    return null;
  }

  private alphaHit(l: Extract<Layer, { kind: 'image' }>, x: number, y: number) {
    const a = this.alphaOf(l.src);
    if (!a) return true;
    const rad = (-l.rot * Math.PI) / 180;
    const dx = x - l.cx;
    const dy = y - l.cy;
    let lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    if (l.flip) lx = -lx;
    const u = Math.floor(((lx + l.w / 2) / l.w) * a.w);
    const v = Math.floor(((ly + l.h / 2) / l.h) * a.h);
    if (u < 0 || v < 0 || u >= a.w || v >= a.h) return false;
    return a.data[(v * a.w + u) * 4 + 3] > 24;
  }

  private alphaOf(ref: string) {
    if (this.alpha.has(ref)) return this.alpha.get(ref) ?? null;
    const img = getImage(ref);
    if (!img) return null;
    const c = new OffscreenCanvas(96, 96);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, 96, 96);
    const entry = { w: 96, h: 96, data: ctx.getImageData(0, 0, 96, 96).data };
    this.alpha.set(ref, entry);
    return entry;
  }

  /** A handle of the selected layer under a client point. */
  hitHandle(sx: number, sy: number): Handle | null {
    const h = this.handles();
    if (!h) return null;
    if (h.knob && Math.hypot(sx - h.knob[0], sy - h.knob[1]) <= HANDLE_R + 2) return { kind: 'rotate' };
    for (let i = 0; i < h.corners.length; i++) if (Math.hypot(sx - h.corners[i][0], sy - h.corners[i][1]) <= HANDLE_R) return { kind: 'scale', corner: i };
    return null;
  }

  /** Screen positions of the selection's corners and rotation knob. */
  handles() {
    const doc = this.editor.doc;
    const p = this.active;
    const id = this.editor.selection;
    if (!doc || !p || !id) return null;
    const l = findLayer(doc, id);
    const f = this.frameOf(id, p.lang);
    if (!l || !f || l.hidden) return null;
    const pts = frameCorners(f).map(([x, y]) => this.toScreen(p, x, y));
    const scalable = l.kind !== 'text' && l.kind !== 'badgeRow';
    let knob: [number, number] | null = null;
    if (rotatable(l)) {
      const top = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
      const a = (f.rot * Math.PI) / 180;
      knob = [top[0] + Math.sin(a) * KNOB_GAP, top[1] - Math.cos(a) * KNOB_GAP];
    }
    return { pts, corners: scalable ? pts : [], knob, top: rotatable(l) ? [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2] : null };
  }

  /* ---------- overlay ---------- */

  private renderOverlay() {
    const svg = this.overlay;
    svg.replaceChildren();
    const doc = this.editor.doc;
    const p = this.active;
    if (!doc || !p || this.editor.mode !== 'editor') return;
    // snap guides across the banner
    for (const g of this.guides) {
      const line = el('line', { class: 'guide' });
      if (g.axis === 'x') {
        const [x] = this.toScreen(p, g.at, 0);
        setAttrs(line, { x1: x, x2: x, y1: p.y - 14, y2: p.y + p.h + 14 });
      } else {
        const [, y] = this.toScreen(p, 0, g.at);
        setAttrs(line, { x1: p.x - 14, x2: p.x + p.w + 14, y1: y, y2: y });
      }
      svg.appendChild(line);
    }
    if (this.hover && this.hover !== this.editor.selection) {
      const f = this.frameOf(this.hover, p.lang);
      if (f) svg.appendChild(el('polygon', { class: 'hover-frame', points: frameCorners(f).map(([x, y]) => this.toScreen(p, x, y).join(',')).join(' ') }));
    }
    const h = this.handles();
    if (!h) return;
    svg.appendChild(el('polygon', { class: 'sel-frame', points: h.pts.map((q) => q.join(',')).join(' ') }));
    if (h.knob && h.top) {
      svg.appendChild(el('line', { class: 'sel-stem', x1: h.top[0], y1: h.top[1], x2: h.knob[0], y2: h.knob[1] }));
      svg.appendChild(el('circle', { class: 'sel-knob', cx: h.knob[0], cy: h.knob[1], r: 5.5 }));
    }
    for (const [x, y] of h.corners) svg.appendChild(el('rect', { class: 'sel-handle', x: x - 4.5, y: y - 4.5, width: 9, height: 9, rx: 2.5 }));
  }
}

/**
 * A text is hit on its lines, not on its whole wrap box: the title's box is as wide as the slot's
 * text column and would steal clicks from the badge sitting next to a short line.
 */
function textHit(l: TextLayer, t: TextBlock | undefined, x: number, y: number, pad: number) {
  if (!t || t.status === 'empty') return false;
  for (let i = 0; i < t.lineWidths.length; i++) {
    const top = t.top + i * t.lineHeight;
    if (y >= top - pad && y <= top + t.lineHeight + pad && x >= l.x - pad && x <= l.x + t.lineWidths[i] + pad) return true;
  }
  // the subtitle sits under the lines; its line widths are not kept, so its band counts whole
  return t.subLines.length > 0 && y >= t.top + t.lineWidths.length * t.lineHeight - pad && y <= t.bottom + pad && x >= l.x - pad && x <= l.x + l.w + pad;
}

function inFrame(f: Frame, x: number, y: number, pad: number) {
  const a = (-f.rot * Math.PI) / 180;
  const dx = x - f.cx;
  const dy = y - f.cy;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= f.w / 2 + pad && Math.abs(ly) <= f.h / 2 + pad;
}

function el(tag: string, attrs: Record<string, string | number>) {
  const e = document.createElementNS(NS, tag);
  setAttrs(e, attrs);
  return e;
}

function setAttrs(e: Element, attrs: Record<string, string | number>) {
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
}
