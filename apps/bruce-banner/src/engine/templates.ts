import { TEMPLATE_DATA } from './templates.data';
import { FORMAT, LANGS, type Background, type BannerDoc, type Lang, type Layer, type SlotKey } from './types';

export interface TemplateDef {
  id: string;
  /** name in the gallery (Russian, as in the legacy picker) */
  label: string;
  group: string;
  figmaNodeId: string;
  theme: string;
  background: Background;
  layers: Layer[];
  copy: Record<SlotKey, Record<Lang, string>>;
}

export const TEMPLATES: TemplateDef[] = TEMPLATE_DATA;

/** Gallery order of the template groups. */
export const GROUPS = ['Кредиты', 'Вклады', 'Карты', 'Переводы', 'Курсы', 'Пустые блоки'] as const;

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);

export const newId = (prefix = 'b') => `${prefix}-${(globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)).slice(0, 8)}`;

/** A fresh document from a template: layers and copy verbatim, copy marked as template text. */
export function docFromTemplate(id: string, opts: { name?: string; now?: number } = {}): BannerDoc {
  const t = templateById(id);
  if (!t) return blankDoc(opts);
  const now = opts.now ?? Date.now();
  const copy: BannerDoc['copy'] = {};
  for (const [key, texts] of Object.entries(t.copy)) {
    copy[key] = { ru: texts.ru ?? '', uz: texts.uz ?? '', en: texts.en ?? '', src: { ru: 'template', uz: 'template', en: 'template' } };
  }
  return {
    v: 1,
    id: newId('bn'),
    name: opts.name ?? t.label,
    format: { ...FORMAT },
    template: t.id,
    theme: t.theme,
    background: structuredClone(t.background),
    languages: { enabled: [...LANGS], primary: 'ru' },
    copy,
    layers: structuredClone(t.layers),
    createdAt: now,
    updatedAt: now,
  };
}

/** An empty white banner, as the legacy "Blank banner". */
export function blankDoc(opts: { name?: string; now?: number } = {}): BannerDoc {
  const now = opts.now ?? Date.now();
  return {
    v: 1,
    id: newId('bn'),
    name: opts.name ?? 'Новый баннер',
    format: { ...FORMAT },
    template: 'blank',
    theme: 'light',
    background: { type: 'solid', color: '#FFFFFF' },
    languages: { enabled: [...LANGS], primary: 'ru' },
    copy: {},
    layers: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Slots that carry the same meaning across layouts: a single badge and the first of two. */
export const SLOT_ALIASES: Record<SlotKey, SlotKey[]> = {
  badge: ['badge1'],
  badge1: ['badge'],
};
