/**
 * Layout: the single source of truth for where text lands. Rendering, the selection overlay,
 * hit-testing, snapping and the checks all read the same result, so they never disagree.
 *
 * Fixed mode (default) lays out once in design units, counts tracking when wrapping and shrinks a
 * title that does not fit (maxLines, width, the slot height) down to its minSize.
 * Compat mode reproduces the legacy engine for the parity gate: no auto-fit, tracking ignored when
 * wrapping, everything measured at the output scale.
 */
import type { BadgeLayer, BadgeRowLayer, BannerDoc, FontFamily, Lang, Layer, StatLayer, TextLayer } from './types';

export interface FontSpec {
  family: FontFamily;
  weight: number;
  /** px at the scale being measured */
  size: number;
  /** px added after every code point but the last; 0 measures the whole string (with kerning) */
  tracking: number;
}

/** Advance width of `text` in px. */
export type Measure = (text: string, font: FontSpec) => number;

export interface LayoutOptions {
  compat?: boolean;
  /** output px per design px; compat measures at this size, as the legacy engine did */
  scale?: number;
}

export type FitStatus = 'ok' | 'shrunk' | 'overflow' | 'empty';

export interface TextBlock {
  layerId: string;
  lines: string[];
  subLines: string[];
  /** font size and line height actually used (auto-fit may have shrunk them) */
  size: number;
  lineHeight: number;
  top: number;
  bottom: number;
  /** widest title line, design px */
  widest: number;
  status: FitStatus;
}

export interface BadgeBlock {
  layerId: string;
  text: string;
  textW: number;
  w: number;
  h: number;
}

export interface BadgeRowBlock {
  layerId: string;
  y: number;
  h: number;
  items: { text: string; x: number; w: number; textW: number; background: string; foreground: string }[];
  /** the row runs past the slot */
  status: FitStatus;
}

export interface StatBlock {
  layerId: string;
  text: string;
  unit: string;
  numW: number;
  unitW: number;
  w: number;
  h: number;
}

/** An oriented box in design px: what the overlay draws and the pointer hits. */
export interface Frame {
  id: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
}

export interface BannerLayout {
  lang: Lang;
  texts: Record<string, TextBlock>;
  badges: Record<string, BadgeBlock>;
  rows: Record<string, BadgeRowBlock>;
  stats: Record<string, StatBlock>;
  frames: Record<string, Frame>;
}

export const textOf = (doc: BannerDoc, key: string | undefined, lang: Lang) => (key ? (doc.copy[key]?.[lang] ?? '') : '');

/** Greedy word wrap on single spaces, keeping hard breaks and empty lines (legacy `b7`). */
export function wrap(text: string, maxWidth: number, width: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!para.length) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && width(next) > maxWidth) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

const BADGE_TRACKING = -0.01;
const STAT_TRACKING = -0.02;

export function layoutBanner(doc: BannerDoc, lang: Lang, measure: Measure, opts: LayoutOptions = {}): BannerLayout {
  const compat = !!opts.compat;
  // compat measures at output size and reports design units, fixed mode measures at design size
  const k = compat ? (opts.scale ?? 1) : 1;
  const out: BannerLayout = { lang, texts: {}, badges: {}, rows: {}, stats: {}, frames: {} };
  const H = doc.format.h;

  // badge rows reserve room under the text they follow
  const rowBelow = new Map<string, BadgeRowLayer>();
  const firstText = doc.layers.find((l): l is TextLayer => l.kind === 'text');
  for (const l of doc.layers) {
    if (l.kind !== 'badgeRow') continue;
    const anchor = l.after ?? firstText?.id;
    if (anchor) rowBelow.set(anchor, l);
  }

  for (const l of doc.layers) {
    if (l.kind === 'text') out.texts[l.id] = layoutText(doc, l, lang, measure, k, compat, H, rowBelow.get(l.id));
  }
  for (const l of doc.layers) {
    switch (l.kind) {
      case 'badge':
        out.badges[l.id] = layoutBadge(doc, l, lang, measure, k);
        break;
      case 'stat':
        out.stats[l.id] = layoutStat(doc, l, lang, measure, k);
        break;
      case 'badgeRow':
        out.rows[l.id] = layoutRow(doc, l, lang, measure, k, out, H);
        break;
      default:
        break;
    }
  }
  for (const l of doc.layers) out.frames[l.id] = frameOf(l, out);
  return out;
}

function layoutText(doc: BannerDoc, l: TextLayer, lang: Lang, measure: Measure, k: number, compat: boolean, H: number, row?: BadgeRowLayer): TextBlock {
  const text = textOf(doc, l.contentKey, lang);
  const sub = l.sub ? textOf(doc, l.sub.contentKey, lang) : '';
  const empty: TextBlock = { layerId: l.id, lines: [], subLines: [], size: l.size, lineHeight: l.lineHeight, top: l.y, bottom: l.y, widest: 0, status: 'empty' };
  if (!text && !sub) return empty;

  const rowH = row ? row.lineHeight + row.paddingY * 2 : 0;
  const below = row ? row.offset + rowH : 0;

  const attempt = (size: number) => {
    const lineHeight = (l.lineHeight * size) / l.size;
    // compat wraps without tracking (legacy b7), fixed counts it
    const font = { family: l.font, weight: l.weight, size: size * k, tracking: compat ? 0 : l.tracking * k };
    const w = (s: string) => measure(s, font) / k;
    const lines = wrap(text, l.w, w);
    let subLines: string[] = [];
    if (sub && l.sub) {
      const sf = { family: l.sub.font, weight: l.sub.weight, size: l.sub.size * k, tracking: compat ? 0 : l.tracking * k };
      subLines = wrap(sub, l.w, (s) => measure(s, sf) / k);
    }
    const subH = subLines.length && l.sub ? subLines.length * l.sub.lineHeight + l.sub.gap : 0;
    const height = lines.length * lineHeight + subH;
    const top = l.vAlign === 'middle' ? H / 2 - height / 2 : l.y;
    const widest = Math.max(0, ...lines.map(w));
    return { size, lineHeight, lines, subLines, top, bottom: top + height, widest, height };
  };

  let a = attempt(l.size);
  if (compat) return { layerId: l.id, lines: a.lines, subLines: a.subLines, size: a.size, lineHeight: a.lineHeight, top: a.top, bottom: a.bottom, widest: a.widest, status: 'ok' };

  const fits = (r: ReturnType<typeof attempt>) => {
    if (r.lines.length > l.maxLines) return false;
    if (r.widest > l.w + 0.5) return false;
    if (l.vAlign === 'middle') return r.height + below <= H;
    return r.bottom + below <= H + 0.5;
  };
  let status: FitStatus = 'ok';
  while (!fits(a)) {
    if (a.size <= l.minSize) {
      status = 'overflow';
      break;
    }
    a = attempt(Math.max(l.minSize, a.size - 0.5));
    status = 'shrunk';
  }
  if (status === 'shrunk' && !fits(a)) status = 'overflow';
  return { layerId: l.id, lines: a.lines, subLines: a.subLines, size: a.size, lineHeight: a.lineHeight, top: a.top, bottom: a.bottom, widest: a.widest, status };
}

function layoutBadge(doc: BannerDoc, l: BadgeLayer, lang: Lang, measure: Measure, k: number): BadgeBlock {
  const text = textOf(doc, l.contentKey, lang);
  const textW = text ? measure(text, { family: l.font, weight: l.weight, size: l.size * k, tracking: BADGE_TRACKING * l.size * k }) / k : 0;
  return { layerId: l.id, text, textW, w: textW + l.paddingX * 2, h: l.lineHeight + l.paddingY * 2 };
}

function layoutStat(doc: BannerDoc, l: StatLayer, lang: Lang, measure: Measure, k: number): StatBlock {
  const text = textOf(doc, l.contentKey, lang);
  const unit = textOf(doc, l.unitContentKey, lang);
  const numW = measure(text, { family: l.font, weight: 700, size: l.size * k, tracking: STAT_TRACKING * l.size * k }) / k;
  const unitW = measure(unit, { family: l.font, weight: 700, size: l.unitSize * k, tracking: STAT_TRACKING * l.unitSize * k }) / k;
  return { layerId: l.id, text, unit, numW, unitW, w: Math.max(numW, unitW) + l.paddingX * 2, h: l.size + l.unitSize + l.gap + l.paddingY * 2 };
}

function layoutRow(doc: BannerDoc, l: BadgeRowLayer, lang: Lang, measure: Measure, k: number, out: BannerLayout, H: number): BadgeRowBlock {
  // legacy jOe: the first text layer that has text, else 60
  const anchorId = l.after;
  let bottom = 60;
  const candidates = doc.layers.filter((x): x is TextLayer => x.kind === 'text' && (!anchorId || x.id === anchorId));
  for (const t of candidates) {
    const b = out.texts[t.id];
    if (b && b.status !== 'empty') {
      bottom = b.bottom;
      break;
    }
  }
  const y = bottom + l.offset;
  const h = l.lineHeight + l.paddingY * 2;
  let x = l.x;
  const items: BadgeRowBlock['items'] = [];
  for (const it of l.items) {
    const text = textOf(doc, it.contentKey, lang);
    if (!text) continue;
    const textW = measure(text, { family: l.font, weight: l.weight, size: l.size * k, tracking: BADGE_TRACKING * l.size * k }) / k;
    const w = textW + l.paddingX * 2;
    items.push({ text, x, w, textW, background: it.background, foreground: it.foreground });
    x += w + l.gap;
  }
  return { layerId: l.id, y, h, items, status: y + h > H + 0.5 ? 'overflow' : items.length ? 'ok' : 'empty' };
}

function frameOf(l: Layer, out: BannerLayout): Frame {
  switch (l.kind) {
    case 'glow':
      return { id: l.id, cx: l.cx, cy: l.cy, w: l.r * 2, h: l.r * 2, rot: 0 };
    case 'image':
    case 'card':
      return { id: l.id, cx: l.cx, cy: l.cy, w: l.w, h: l.h, rot: l.rot };
    case 'imageClip':
      return { id: l.id, cx: l.box.x + l.box.width / 2, cy: l.box.y + l.box.height / 2, w: l.box.width, h: l.box.height, rot: 0 };
    case 'pill':
      return { id: l.id, cx: l.cx, cy: l.cy, w: l.w, h: l.h, rot: 0 };
    case 'badge': {
      const b = out.badges[l.id];
      return { id: l.id, cx: l.cx, cy: l.cy, w: b?.w ?? 0, h: b?.h ?? 0, rot: l.rot };
    }
    case 'stat': {
      const s = out.stats[l.id];
      return { id: l.id, cx: l.cx, cy: l.cy, w: s?.w ?? 0, h: s?.h ?? 0, rot: l.rot };
    }
    case 'badgeRow': {
      const r = out.rows[l.id];
      const last = r?.items[r.items.length - 1];
      const w = last ? last.x + last.w - l.x : 0;
      return { id: l.id, cx: l.x + w / 2, cy: (r?.y ?? 0) + (r?.h ?? 0) / 2, w, h: r?.h ?? 0, rot: 0 };
    }
    case 'text': {
      const t = out.texts[l.id];
      const top = t?.top ?? l.y;
      const bottom = t && t.status !== 'empty' ? t.bottom : top + l.lineHeight;
      return { id: l.id, cx: l.x + l.w / 2, cy: (top + bottom) / 2, w: l.w, h: bottom - top, rot: 0 };
    }
  }
}

/** Corners of a frame in design px, clockwise from top-left. */
export function frameCorners(f: Frame): [number, number][] {
  const a = (f.rot * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const hw = f.w / 2;
  const hh = f.h / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => [f.cx + x * c - y * s, f.cy + x * s + y * c] as [number, number]);
}

/** Is the design-px point inside the oriented frame? */
export function frameHit(f: Frame, x: number, y: number, pad = 0) {
  const a = (-f.rot * Math.PI) / 180;
  const dx = x - f.cx;
  const dy = y - f.cy;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= f.w / 2 + pad && Math.abs(ly) <= f.h / 2 + pad;
}

/** Axis-aligned bounds of a frame. */
export function frameBounds(f: Frame) {
  const pts = frameCorners(f);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}
