/**
 * What can go wrong with a banner, per language. The export gate blocks only on empty titles and
 * overflow; contrast is a hint (several official templates sit near 2.6:1 white on colour and are
 * approved brand), numbers an AI added that are not in the brief are a warning.
 */
import { frameCorners, type BannerLayout } from './layout';
import type { BannerDoc, Lang, SlotKey } from './types';

export type Severity = 'error' | 'warn' | 'hint';

export interface Issue {
  lang: Lang;
  severity: Severity;
  code: 'empty' | 'overflow' | 'shrunk' | 'overlap' | 'numbers' | 'contrast';
  layerId?: string;
  slot?: SlotKey;
  message: string;
}

/** Slots some visible layer reads. */
export function usedSlots(doc: BannerDoc): SlotKey[] {
  const keys = new Set<SlotKey>();
  for (const l of doc.layers) {
    if (l.hidden) continue;
    if (l.kind === 'text') {
      keys.add(l.contentKey);
      if (l.sub) keys.add(l.sub.contentKey);
    } else if (l.kind === 'badge') keys.add(l.contentKey);
    else if (l.kind === 'stat') {
      keys.add(l.contentKey);
      keys.add(l.unitContentKey);
    } else if (l.kind === 'badgeRow') l.items.forEach((it) => keys.add(it.contentKey));
  }
  return [...keys];
}

export const SLOT_LABEL: Record<string, string> = {
  title: 'Заголовок',
  sub: 'Подпись',
  badge: 'Бейдж',
  badge1: 'Бейдж 1',
  badge2: 'Бейдж 2',
  stat: 'Цифра',
  statUnit: 'Единица',
};
export const slotLabel = (key: SlotKey) => SLOT_LABEL[key] ?? 'Текст';

/** Layout problems for one language. */
export function layoutIssues(doc: BannerDoc, lay: BannerLayout): Issue[] {
  const lang = lay.lang;
  const out: Issue[] = [];
  for (const l of doc.layers) {
    if (l.hidden) continue;
    if (l.kind === 'text') {
      const t = lay.texts[l.id];
      if (!t) continue;
      if (t.status === 'empty' && l.contentKey === 'title') out.push({ lang, severity: 'error', code: 'empty', layerId: l.id, slot: l.contentKey, message: 'Нет заголовка' });
      if (t.status === 'overflow') out.push({ lang, severity: 'error', code: 'overflow', layerId: l.id, slot: l.contentKey, message: `${slotLabel(l.contentKey)} не влезает` });
      if (t.status === 'shrunk') out.push({ lang, severity: 'hint', code: 'shrunk', layerId: l.id, slot: l.contentKey, message: `${slotLabel(l.contentKey)} уменьшен, чтобы влезть` });
    }
    if (l.kind === 'badgeRow' && lay.rows[l.id]?.status === 'overflow') {
      out.push({ lang, severity: 'error', code: 'overflow', layerId: l.id, message: 'Бейджи выходят за баннер' });
    }
  }
  return [...out, ...overlapIssues(doc, lay)];
}

/** A line of text a badge or the rate circle sits on (a longer translation runs under it). */
export function overlapIssues(doc: BannerDoc, lay: BannerLayout): Issue[] {
  const out: Issue[] = [];
  const shapes = doc.layers.filter((l) => !l.hidden && ((l.kind === 'badge' && lay.badges[l.id]?.text) || (l.kind === 'stat' && lay.stats[l.id]?.text)));
  if (!shapes.length) return out;
  for (const l of doc.layers) {
    if (l.hidden || l.kind !== 'text') continue;
    const t = lay.texts[l.id];
    if (!t?.lines.length) continue;
    for (const s of shapes) {
      const f = lay.frames[s.id];
      if (!f) continue;
      const shape = frameCorners(f);
      const hit = t.lineWidths.some((w, i) => {
        if (w <= 0) return false;
        // the ink of a line: a band around its middle about as tall as the letters
        const mid = t.top + (i + 0.5) * t.lineHeight;
        const half = t.size * 0.36;
        const box: [number, number][] = [
          [l.x, mid - half],
          [l.x + w, mid - half],
          [l.x + w, mid + half],
          [l.x, mid + half],
        ];
        return penetration(box, shape) > 1.5;
      });
      if (hit) out.push({ lang: lay.lang, severity: 'warn', code: 'overlap', layerId: s.id, slot: l.contentKey, message: `${s.kind === 'badge' ? 'Бейдж' : 'Курс'} закрывает ${slotLabel(l.contentKey).toLowerCase()}` });
    }
  }
  return out;
}

/** How deep two convex polygons overlap (separating axes), 0 when they do not. */
export function penetration(a: [number, number][], b: [number, number][]) {
  let depth = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const ax = (y1 - y2) / len;
      const ay = (x2 - x1) / len;
      let aMin = Infinity;
      let aMax = -Infinity;
      let bMin = Infinity;
      let bMax = -Infinity;
      for (const [x, y] of a) {
        const p = x * ax + y * ay;
        aMin = Math.min(aMin, p);
        aMax = Math.max(aMax, p);
      }
      for (const [x, y] of b) {
        const p = x * ax + y * ay;
        bMin = Math.min(bMin, p);
        bMax = Math.max(bMax, p);
      }
      const o = Math.min(aMax, bMax) - Math.max(aMin, bMin);
      if (o <= 0) return 0;
      depth = Math.min(depth, o);
    }
  }
  return depth;
}

/* ---------- numbers the AI added ---------- */

function multiplier(word: string | undefined) {
  if (!word) return 0;
  const w = word.toLowerCase();
  if (/^(млн|mln|million|миллион)/.test(w)) return 1e6;
  if (/^(млрд|mlrd|billion|миллиард)/.test(w)) return 1e9;
  if (/^(тыс|ming|thousand)/.test(w)) return 1e3;
  return 0;
}

/** Numbers in a text, normalised: 16,99 = 16.99, NBSP and thin spaces in thousands, "100 млн" = 100000000. */
export function numbersIn(text: string): Set<number> {
  const out = new Set<number>();
  const t = text.replace(/[   ]/g, ' ');
  const re = /(\d{1,3}(?: \d{3})+|\d+)(?:[.,](\d+))?(?:\s*([\p{L}]+))?/gu;
  for (const m of t.matchAll(re)) {
    const int = m[1].replace(/ /g, '');
    const v = Number(m[2] ? `${int}.${m[2]}` : int);
    if (!Number.isFinite(v)) continue;
    out.add(v);
    const mult = multiplier(m[3]);
    if (mult) out.add(v * mult);
  }
  return out;
}

/** Numbers in AI-written copy that the brief does not contain. */
export function foreignNumbers(doc: BannerDoc, lang: Lang): { slot: SlotKey; numbers: number[] }[] {
  if (!doc.brief) return [];
  const allowed = numbersIn(doc.brief);
  const out: { slot: SlotKey; numbers: number[] }[] = [];
  for (const key of usedSlots(doc)) {
    const slot = doc.copy[key];
    if (!slot || slot.src[lang] !== 'ai') continue;
    const extra = [...numbersIn(slot[lang])].filter((n) => !allowed.has(n));
    if (extra.length) out.push({ slot: key, numbers: extra });
  }
  return out;
}

export function numberIssues(doc: BannerDoc, lang: Lang): Issue[] {
  return foreignNumbers(doc, lang).map((f) => ({
    lang,
    severity: 'warn' as const,
    code: 'numbers' as const,
    slot: f.slot,
    message: `AI добавил цифры, которых нет в брифе: ${f.numbers.join(', ')}`,
  }));
}

/* ---------- contrast ---------- */

export function luminance([r, g, b]: [number, number, number]) {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a: [number, number, number], b: [number, number, number]) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Parses #RGB, #RRGGBB and rgb[a](); alpha is composited over `under`. */
export function parseColor(color: string, under: [number, number, number] = [255, 255, 255]): [number, number, number] {
  const m = /^rgba?\(([^)]+)\)$/.exec(color.trim());
  if (m) {
    const [r, g, b, a = 1] = m[1].split(',').map((s) => Number(s.trim()));
    return [r * a + under[0] * (1 - a), g * a + under[1] * (1 - a), b * a + under[2] * (1 - a)];
  }
  const hex = color.replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex.slice(0, 6);
  const v = Number.parseInt(full, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * Below this, text is flagged. The darkest approved pairing among the official templates is white
 * on Апельсин #F4821F at about 2.6:1, so the threshold sits just under it.
 */
export const CONTRAST_HINT = 2.4;
