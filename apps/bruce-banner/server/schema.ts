/**
 * Input validation and the JSON Schemas the model must answer in (the documented subset: type,
 * properties, required, enum, items, minItems, maxItems, description). A model answer is still
 * checked against the catalog afterwards: an unknown layout or asset never reaches the editor.
 */
import type { BriefRequest, Catalog, CatalogLayout, IllustrationRequest, Lang, LangText, TextRequest, Variant } from './contracts.js';
import { HttpError } from './http.js';
import { clip, normalizeUz } from './text.js';

const LANGS: Lang[] = ['ru', 'uz', 'en'];
export const SLOT_KEYS = ['title', 'sub', 'badge', 'badge1', 'badge2', 'stat', 'statUnit'] as const;

const langText = { type: 'object', properties: { ru: { type: 'string' }, uz: { type: 'string' }, en: { type: 'string' } }, required: ['ru', 'uz', 'en'] };

export function briefSchema(c: Catalog) {
  return {
    type: 'object',
    properties: {
      variants: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            layout: { type: 'string', enum: c.layouts.map((l) => l.id) },
            theme: { type: 'string', enum: c.themes.map((t) => t.id) },
            copy: { type: 'object', properties: Object.fromEntries(SLOT_KEYS.map((k) => [k, langText])), required: ['title'] },
            art: { type: 'string', enum: c.assets.map((a) => a.id) },
            generate: { type: 'string', description: 'Russian, one short phrase naming one object, or empty' },
            why: { type: 'string' },
          },
          required: ['layout', 'theme', 'copy', 'art', 'why'],
        },
      },
    },
    required: ['variants'],
  };
}

export function textSchema(to: Lang[]) {
  return {
    type: 'object',
    properties: { texts: { type: 'object', properties: Object.fromEntries(to.map((l) => [l, { type: 'string' }])), required: to }, note: { type: 'string' } },
    required: ['texts'],
  };
}

/* ---------- requests ---------- */

const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as string[]).includes(v);
const asLangText = (v: unknown, max = 300): LangText => {
  const o = (v ?? {}) as Record<string, unknown>;
  return { ru: clip(o.ru, max), uz: clip(o.uz, max), en: clip(o.en, max) };
};

export function parseCatalog(raw: unknown): Catalog {
  const c = (raw ?? {}) as Partial<Catalog>;
  if (!Array.isArray(c.layouts) || !Array.isArray(c.themes) || !Array.isArray(c.assets)) throw new HttpError(400, 'bad_request', 'Нет каталога раскладок');
  const layouts: CatalogLayout[] = c.layouts.slice(0, 40).map((l) => ({
    id: clip(l.id, 40),
    label: clip(l.label, 80),
    group: clip(l.group, 40),
    about: clip(l.about, 240),
    theme: clip(l.theme, 40),
    art: l.art ? clip(l.art, 60) : undefined,
    slots: Object.fromEntries(
      Object.entries(l.slots ?? {})
        .filter(([k]) => (SLOT_KEYS as readonly string[]).includes(k))
        .map(([k, s]) => [k, { maxChars: Math.max(4, Math.min(80, Number(s?.maxChars) || 24)), maxLines: Math.max(1, Math.min(4, Number(s?.maxLines) || 1)) }]),
    ),
    sample: l.sample ? Object.fromEntries(Object.entries(l.sample).slice(0, 8).map(([k, t]) => [clip(k, 20), asLangText(t)])) : undefined,
  }));
  if (!layouts.length) throw new HttpError(400, 'bad_request', 'Пустой каталог');
  return {
    layouts,
    themes: c.themes.slice(0, 30).map((t) => ({ id: clip(t.id, 40), label: clip(t.label, 40) })),
    assets: c.assets.slice(0, 60).map((a) => ({ id: clip(a.id, 60), kind: clip(a.kind, 20), about: clip(a.about, 200) })),
  };
}

export function parseBrief(raw: unknown): BriefRequest {
  const b = (raw ?? {}) as Partial<BriefRequest>;
  const brief = typeof b.brief === 'string' ? b.brief.trim() : '';
  if (brief.length < 4) throw new HttpError(400, 'bad_request', 'Опишите баннер подробнее');
  if (brief.length > 400) throw new HttpError(400, 'bad_request', 'Бриф длиннее 400 символов');
  return { brief, catalog: parseCatalog(b.catalog), avoid: Array.isArray(b.avoid) ? b.avoid.slice(0, 20).map((x) => clip(x, 40)) : [] };
}

export function parseText(raw: unknown): TextRequest {
  const t = (raw ?? {}) as Partial<TextRequest>;
  const ops = ['shorter', 'rephrase', 'translate', 'fix'];
  if (!t.op || !ops.includes(t.op)) throw new HttpError(400, 'bad_request', 'Неизвестное действие');
  if (!isLang(t.from)) throw new HttpError(400, 'bad_request', 'Неизвестный язык');
  const to = Array.isArray(t.to) ? t.to.filter(isLang) : [];
  if (!to.length) throw new HttpError(400, 'bad_request', 'Не указаны языки');
  const texts = asLangText(t.texts);
  if (!texts[t.from].trim()) throw new HttpError(400, 'bad_request', 'Пустой исходный текст');
  return {
    op: t.op,
    slot: clip(t.slot, 40) || 'title',
    texts,
    from: t.from,
    to,
    context: { title: clip(t.context?.title, 200), brief: clip(t.context?.brief, 400) },
    limits: t.limits ? { maxChars: Math.max(4, Math.min(80, Number(t.limits.maxChars) || 24)), maxLines: Math.max(1, Math.min(4, Number(t.limits.maxLines) || 1)) } : undefined,
  };
}

export function parseIllustration(raw: unknown): IllustrationRequest {
  const r = (raw ?? {}) as Partial<IllustrationRequest>;
  const subject = typeof r.subject === 'string' ? r.subject.trim() : '';
  if (subject.length < 3) throw new HttpError(400, 'bad_request', 'Опишите, что нарисовать');
  if (subject.length > 300) throw new HttpError(400, 'bad_request', 'Описание длиннее 300 символов');
  return { subject, theme: r.theme ? clip(r.theme, 40) : undefined };
}

/* ---------- model answers ---------- */

/** Keeps the answer inside the catalog and the chosen layout's slots; Uzbek gets its ‘. */
export function cleanVariants(raw: unknown, c: Catalog): Variant[] {
  const list = ((raw as { variants?: unknown[] })?.variants ?? []).slice(0, 3);
  const layoutIds = new Set(c.layouts.map((l) => l.id));
  const themeIds = new Set(c.themes.map((t) => t.id));
  const assetIds = new Set(c.assets.map((a) => a.id));
  const out: Variant[] = [];
  for (const v of list as Partial<Variant>[]) {
    const layout = c.layouts.find((l) => l.id === v.layout) ?? (layoutIds.size ? c.layouts[0] : undefined);
    if (!layout) continue;
    const copy: Record<string, LangText> = {};
    for (const key of Object.keys(layout.slots)) {
      const t = asLangText(v.copy?.[key], 200);
      if (!t.ru && !t.uz && !t.en) continue;
      copy[key] = { ru: t.ru.trim(), uz: normalizeUz(t.uz.trim()), en: t.en.trim() };
    }
    if (!copy.title) continue;
    out.push({
      layout: layout.id,
      theme: v.theme && themeIds.has(v.theme) ? v.theme : layout.theme,
      copy,
      art: v.art && assetIds.has(v.art) ? v.art : (layout.art ?? c.assets[0]?.id ?? ''),
      generate: clip(v.generate, 240).trim() || undefined,
      why: clip(v.why, 200).trim(),
    });
  }
  return out;
}

export function cleanTexts(raw: unknown, to: Lang[]): { texts: Partial<LangText>; note?: string } {
  const r = (raw ?? {}) as { texts?: Record<string, unknown>; note?: unknown };
  const texts: Partial<LangText> = {};
  for (const l of to) {
    const v = clip(r.texts?.[l], 300).trim();
    if (v) texts[l] = l === 'uz' ? normalizeUz(v) : v;
  }
  const note = clip(r.note, 200).trim();
  return note ? { texts, note } : { texts };
}
