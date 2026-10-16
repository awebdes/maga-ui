/**
 * Pure edits on a document draft. The editor clones, applies one of these, and records history.
 */
import { applyTheme, themeById } from './themes';
import { newId, SLOT_ALIASES, templateById } from './templates';
import { normalizeUz } from './uz';
import { LANGS, type BadgeLayer, type BannerDoc, type CopySource, type GlowLayer, type ImageLayer, type Lang, type Layer, type LayerKind, type SlotKey, type StatLayer, type TextLayer } from './types';
import { usedSlots } from './checks';

export const findLayer = (doc: BannerDoc, id: string) => doc.layers.find((l) => l.id === id);

export const KIND_LABEL: Record<LayerKind, string> = {
  text: 'Текст',
  badge: 'Бейдж',
  badgeRow: 'Бейджи',
  image: 'Иллюстрация',
  imageClip: 'Иллюстрация',
  card: 'Карта',
  pill: 'Логотип',
  glow: 'Свечение',
  stat: 'Курс',
};

export function layerName(l: Layer) {
  if (l.name) return l.name;
  if (l.kind === 'text' && l.contentKey === 'title') return 'Заголовок';
  return KIND_LABEL[l.kind];
}

/* ---------- copy ---------- */

export function ensureSlot(doc: BannerDoc, key: SlotKey) {
  doc.copy[key] ??= { ru: '', uz: '', en: '', src: {} };
  return doc.copy[key];
}

export function setText(doc: BannerDoc, key: SlotKey, lang: Lang, value: string, src: CopySource = 'user') {
  const slot = ensureSlot(doc, key);
  slot[lang] = lang === 'uz' ? normalizeUz(value) : value;
  slot.src[lang] = src;
}

/** Writes several languages of one slot (an AI answer). */
export function setTexts(doc: BannerDoc, key: SlotKey, texts: Partial<Record<Lang, string>>, src: CopySource) {
  for (const lang of LANGS) {
    const v = texts[lang];
    if (typeof v === 'string') setText(doc, key, lang, v, src);
  }
}

/** Drops slots no layer reads anymore (hand-added text that was deleted). Template slots stay. */
export function pruneSlots(doc: BannerDoc) {
  const used = new Set<SlotKey>();
  for (const l of doc.layers) {
    if (l.kind === 'text') {
      used.add(l.contentKey);
      if (l.sub) used.add(l.sub.contentKey);
    } else if (l.kind === 'badge' || l.kind === 'stat') {
      used.add(l.contentKey);
      if (l.kind === 'stat') used.add(l.unitContentKey);
    } else if (l.kind === 'badgeRow') l.items.forEach((it) => used.add(it.contentKey));
  }
  for (const key of Object.keys(doc.copy)) if (key.startsWith('t-') && !used.has(key)) delete doc.copy[key];
}

/* ---------- geometry ---------- */

export function moveLayer(doc: BannerDoc, id: string, dx: number, dy: number) {
  const l = findLayer(doc, id);
  if (!l) return;
  switch (l.kind) {
    case 'text':
      l.x += dx;
      l.y += dy;
      break;
    case 'badgeRow':
      l.x += dx;
      break;
    case 'imageClip':
      l.img.x += dx;
      l.img.y += dy;
      break;
    default:
      l.cx += dx;
      l.cy += dy;
  }
}

/** Scales a layer about its centre. Text scales its type; glow its radius. */
export function scaleLayer(doc: BannerDoc, id: string, f: number) {
  const l = findLayer(doc, id);
  if (!l || !(f > 0)) return;
  switch (l.kind) {
    case 'image':
    case 'card':
      l.w *= f;
      l.h *= f;
      break;
    case 'pill':
      l.w *= f;
      l.h *= f;
      l.iconBox = { width: l.iconBox.width * f, height: l.iconBox.height * f };
      l.iconDraw = { x: l.iconDraw.x * f, y: l.iconDraw.y * f, width: l.iconDraw.width * f, height: l.iconDraw.height * f };
      break;
    case 'imageClip': {
      const cx = l.img.x + l.img.width / 2;
      const cy = l.img.y + l.img.height / 2;
      l.img.width *= f;
      l.img.height *= f;
      l.img.x = cx - l.img.width / 2;
      l.img.y = cy - l.img.height / 2;
      break;
    }
    case 'glow':
      l.r *= f;
      break;
    case 'badge':
    case 'badgeRow':
      l.size *= f;
      l.lineHeight *= f;
      l.paddingX *= f;
      l.paddingY *= f;
      break;
    case 'stat':
      l.size *= f;
      l.unitSize *= f;
      l.paddingX *= f;
      l.paddingY *= f;
      l.gap *= f;
      break;
    case 'text':
      l.size *= f;
      l.lineHeight *= f;
      l.minSize = Math.min(l.minSize, l.size);
      break;
  }
}

export function setRotation(doc: BannerDoc, id: string, deg: number) {
  const l = findLayer(doc, id);
  if (!l) return;
  if (l.kind === 'image' || l.kind === 'card' || l.kind === 'badge' || l.kind === 'stat') l.rot = wrap180(deg);
}

export const rotatable = (l: Layer) => l.kind === 'image' || l.kind === 'card' || l.kind === 'badge' || l.kind === 'stat';
export const scalable = (l: Layer) => l.kind !== 'badgeRow';

export function wrap180(d: number) {
  let a = ((d + 180) % 360) - 180;
  if (a < -180) a += 360;
  return Math.round(a * 100) / 100;
}

/* ---------- assets, theme, layout ---------- */

export function setAsset(doc: BannerDoc, id: string, ref: string) {
  const l = findLayer(doc, id);
  if (!l) return;
  if (l.kind === 'image' || l.kind === 'card' || l.kind === 'imageClip') l.src = ref;
  else if (l.kind === 'pill') l.icon = ref;
}

export function setTheme(doc: BannerDoc, themeId: string) {
  applyTheme(doc, themeById(themeId));
}

/**
 * Takes another template's layout and keeps this document's texts: slots map by name, a single
 * badge and the first of two are the same slot. Returns the slots with text that the new layout
 * does not show, so the editor can say "скрыто N текстов".
 */
export function switchLayout(doc: BannerDoc, templateId: string): SlotKey[] {
  const t = templateById(templateId);
  if (!t) return [];
  const before = doc.copy;
  doc.layers = structuredClone(t.layers);
  doc.template = t.id;
  // the new layout's slots get this doc's text where there is one, else the template's
  const copy: BannerDoc['copy'] = {};
  for (const key of usedSlots(doc)) {
    const own = before[key] ?? (SLOT_ALIASES[key] ?? []).map((k) => before[k]).find(Boolean);
    const tpl = t.copy[key];
    copy[key] = own ? structuredClone(own) : { ru: tpl?.ru ?? '', uz: tpl?.uz ?? '', en: tpl?.en ?? '', src: { ru: 'template', uz: 'template', en: 'template' } };
  }
  const hidden = Object.keys(before).filter((k) => !(k in copy) && !(SLOT_ALIASES[k] ?? []).some((a) => a in copy) && LANGS.some((l) => before[k][l].trim()));
  // keep hidden texts so switching back restores them
  for (const k of hidden) copy[k] = before[k];
  doc.copy = copy;
  applyTheme(doc, themeById(doc.theme));
  return hidden;
}

/* ---------- layers ---------- */

export function addLayer(doc: BannerDoc, kind: 'text' | 'badge' | 'image' | 'glow' | 'stat', opts: { src?: string; cx?: number; cy?: number } = {}): Layer {
  const theme = themeById(doc.theme);
  const id = newId(kind);
  let layer: Layer;
  switch (kind) {
    case 'text': {
      const key = `t-${id}`;
      ensureSlot(doc, key);
      setText(doc, key, 'ru', 'Новый текст');
      setText(doc, key, 'uz', 'Yangi matn');
      setText(doc, key, 'en', 'New text');
      layer = {
        id,
        kind: 'text',
        contentKey: key,
        x: 16,
        y: (opts.cy ?? 70) - 11,
        w: 209,
        font: 'body',
        size: 16,
        weight: 600,
        lineHeight: 22,
        tracking: 0,
        vAlign: 'top',
        color: theme.text,
        maxLines: 3,
        minSize: 11,
      } satisfies TextLayer;
      break;
    }
    case 'badge': {
      const key = doc.copy.badge || doc.layers.some((l) => l.kind === 'badge' && l.contentKey === 'badge') ? `t-${id}` : 'badge';
      ensureSlot(doc, key);
      if (!doc.copy[key].ru) {
        setText(doc, key, 'ru', 'до 18%');
        setText(doc, key, 'uz', '18% gacha');
        setText(doc, key, 'en', 'up to 18%');
      }
      layer = {
        id,
        kind: 'badge',
        contentKey: key,
        cx: opts.cx ?? 196,
        cy: opts.cy ?? 63,
        rot: -6,
        font: 'body',
        size: 14,
        weight: 600,
        lineHeight: 16,
        paddingX: 12,
        paddingY: 6,
        radius: 32,
        background: theme.badge.bg,
        foreground: theme.badge.fg,
      } satisfies BadgeLayer;
      break;
    }
    case 'image':
      layer = { id, kind: 'image', src: opts.src ?? 'money-loan', cx: opts.cx ?? 262, cy: opts.cy ?? 72, w: 150, h: 150, rot: 0 } satisfies ImageLayer;
      break;
    case 'glow':
      layer = { id, kind: 'glow', cx: opts.cx ?? 264, cy: opts.cy ?? 196, r: 162, blur: 50, color: theme.glow, opacity: 1 } satisfies GlowLayer;
      break;
    case 'stat': {
      ensureSlot(doc, 'stat');
      ensureSlot(doc, 'statUnit');
      if (!doc.copy.stat.ru) {
        setTexts(doc, 'stat', { ru: '151', uz: '151', en: '151' }, 'user');
        setTexts(doc, 'statUnit', { ru: 'сум', uz: 'so‘m', en: 'sum' }, 'user');
      }
      layer = {
        id,
        kind: 'stat',
        contentKey: 'stat',
        unitContentKey: 'statUnit',
        font: 'head',
        cx: opts.cx ?? 236,
        cy: opts.cy ?? 52.5,
        rot: 6.4,
        size: 48,
        unitSize: 21,
        gap: 2,
        paddingX: 18,
        paddingY: 12,
        background: theme.stat.bg,
        foreground: theme.stat.fg,
        halo: { blur: 45, color: 'rgba(255,255,255,0.8)', offsetY: 0 },
      } satisfies StatLayer;
      break;
    }
  }
  // glow goes to the bottom, everything else on top
  if (kind === 'glow') doc.layers.unshift(layer);
  else doc.layers.push(layer);
  return layer;
}

export function removeLayer(doc: BannerDoc, id: string) {
  doc.layers = doc.layers.filter((l) => l.id !== id);
  pruneSlots(doc);
}

/** A copy of the layer, nudged; hand-added text gets its own slot so the two edit separately. */
export function duplicateLayer(doc: BannerDoc, id: string): Layer | null {
  const l = findLayer(doc, id);
  if (!l) return null;
  const copy = structuredClone(l);
  copy.id = newId(l.kind);
  const cloneSlot = (key: SlotKey) => {
    const next = `t-${copy.id}${key.startsWith('t-') ? '' : `-${key}`}`;
    doc.copy[next] = structuredClone(doc.copy[key] ?? { ru: '', uz: '', en: '', src: {} });
    return next;
  };
  if (copy.kind === 'text') {
    copy.contentKey = cloneSlot(copy.contentKey);
    if (copy.sub) copy.sub.contentKey = cloneSlot(copy.sub.contentKey);
  } else if (copy.kind === 'badge') copy.contentKey = cloneSlot(copy.contentKey);
  else if (copy.kind === 'stat') {
    copy.contentKey = cloneSlot(copy.contentKey);
    copy.unitContentKey = cloneSlot(copy.unitContentKey);
  } else if (copy.kind === 'badgeRow') copy.items = copy.items.map((it) => ({ ...it, contentKey: cloneSlot(it.contentKey) }));
  doc.layers.splice(doc.layers.indexOf(l) + 1, 0, copy);
  moveLayer(doc, copy.id, 6, 6);
  return copy;
}

export function setHidden(doc: BannerDoc, id: string, hidden: boolean) {
  const l = findLayer(doc, id);
  if (l) l.hidden = hidden || undefined;
}

/** Moves a layer to a new index in the bottom-first list. */
export function reorderLayer(doc: BannerDoc, id: string, to: number) {
  const from = doc.layers.findIndex((l) => l.id === id);
  if (from < 0) return;
  const [l] = doc.layers.splice(from, 1);
  doc.layers.splice(Math.max(0, Math.min(doc.layers.length, to)), 0, l);
}

/* ---------- languages ---------- */

export function setLanguageEnabled(doc: BannerDoc, lang: Lang, on: boolean) {
  const set = new Set(doc.languages.enabled);
  if (on) set.add(lang);
  else if (set.size > 1) set.delete(lang);
  doc.languages.enabled = LANGS.filter((l) => set.has(l));
  if (!doc.languages.enabled.includes(doc.languages.primary)) doc.languages.primary = doc.languages.enabled[0];
}

export function setPrimaryLanguage(doc: BannerDoc, lang: Lang) {
  if (!doc.languages.enabled.includes(lang)) setLanguageEnabled(doc, lang, true);
  doc.languages.primary = lang;
}

/** Marks a language's AI text as checked by a person (clears the "проверьте" chip). */
export function confirmLanguage(doc: BannerDoc, lang: Lang) {
  for (const slot of Object.values(doc.copy)) if (slot.src[lang] === 'ai') slot.src[lang] = 'user';
}
