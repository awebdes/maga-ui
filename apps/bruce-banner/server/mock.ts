/**
 * Deterministic answers for when there is no Gemini key (or AI_MOCK=1): the whole flow works and
 * the e2e runs offline. Variants are the closest official templates with their real copy; text
 * actions do what can be done honestly without a model and say so.
 */
import type { BriefRequest, BriefResponse, IllustrationRequest, IllustrationResponse, Lang, LangText, TextRequest, TextResponse, Variant } from './contracts.js';
import { MOCK_ILLUSTRATION_PNG } from './fixtures.js';
import { imagePrompt } from './prompts.js';
import { normalizeUz } from './text.js';

const RULES: [RegExp, string[]][] = [
  [/humo/i, ['humo']],
  [/uzcard/i, ['uzcard']],
  [/visa\s*gold/i, ['visagold']],
  [/visa/i, ['visaclassic', 'visagold']],
  [/(master\s*card|mc)\s*gold/i, ['mcgold']],
  [/master\s*card|мастеркард/i, ['mcstandard', 'mcgold']],
  [/ипотек|ipoteka\b|mortgage|жиль|квартир|uy-joy/i, ['mortgage']],
  [/курс|рубл|rubl|валют|обмен|exchange|kurs/i, ['rublerate']],
  [/перевод|o‘?tkazma|transfer|комисси|0\s?%/i, ['zero']],
  [/вклад|депозит|omonat|deposit|накоп|доходн|daromad|годовых/i, ['daromax', 'cumulative', 'oddly', 'emptydeposit']],
  [/кредит|займ|kredit|loan|наличн|млн/i, ['loan', 'emptyloan']],
  [/карт|karta|card|кэшбэк|cashback|keshbek/i, ['humo', 'uzcard', 'visaclassic']],
];

const FALLBACK = ['loan', 'daromax', 'zero'];
const ALT_THEMES = ['night', 'light', 'sky', 'emerald'];

export function mockBrief(req: BriefRequest, model = 'mock'): BriefResponse {
  const ids = new Set(req.catalog.layouts.map((l) => l.id));
  const themeIds = new Set(req.catalog.themes.map((t) => t.id));
  const matched: string[] = [];
  for (const [re, layouts] of RULES) if (re.test(req.brief)) for (const id of layouts) if (ids.has(id) && !matched.includes(id)) matched.push(id);
  const fresh = matched.filter((id) => !req.avoid?.includes(id));
  // «Ещё варианты» on a topic with no unseen layouts left: the same layouts in other themes
  const again = fresh.length === 0 && matched.length > 0;
  let picks = fresh.length ? fresh : matched;
  if (!picks.length) picks = FALLBACK.filter((id) => ids.has(id) && !req.avoid?.includes(id));
  if (!picks.length) picks = FALLBACK.filter((id) => ids.has(id));
  const used = new Set<string>();
  const variants: Variant[] = [0, 1, 2].map((i) => {
    const id = picks[i % picks.length];
    const l = req.catalog.layouts.find((x) => x.id === id)!;
    const copy: Record<string, LangText> = {};
    for (const [k, t] of Object.entries(l.sample ?? {})) copy[k] = { ...t, uz: normalizeUz(t.uz) };
    if (!copy.title) copy.title = { ru: req.brief.slice(0, 60), uz: req.brief.slice(0, 60), en: req.brief.slice(0, 60) };
    const themes = [l.theme, ...ALT_THEMES].filter((t, k, all) => all.indexOf(t) === k && themeIds.has(t));
    const order = again ? [...themes.slice(1), themes[0]] : themes;
    const theme = order.find((t) => !used.has(`${id}:${t}`)) ?? l.theme;
    used.add(`${id}:${theme}`);
    const why = i === 0 && !again ? 'Демо: ближайший официальный шаблон с его текстом' : theme === l.theme ? 'Демо: другая раскладка на ту же тему' : 'Демо: тот же текст в другой теме';
    return { layout: id, theme, copy, art: l.art ?? req.catalog.assets[0]?.id ?? '', generate: undefined, why };
  });
  return { variants, mock: true, model };
}

export function mockText(req: TextRequest, model = 'mock'): TextResponse {
  // without a model the honest answer is the text as it was (only «fix» is mechanical)
  const texts: Partial<Record<Lang, string>> = {};
  for (const lang of req.to) {
    const src = req.texts[lang] ?? '';
    texts[lang] = req.op === 'fix' ? (lang === 'uz' ? normalizeUz(src) : src.replace(/\s+([,.!?])/g, '$1')) : src;
  }
  const note =
    req.op === 'translate'
      ? 'Демо-режим: перевод заработает с ключом Gemini, тексты не изменены'
      : req.op === 'rephrase'
        ? 'Демо-режим: перефразирование заработает с ключом Gemini'
        : req.op === 'shorter'
          ? 'Демо-режим: сокращение заработает с ключом Gemini'
          : '';
  return { texts, note, mock: true, model };
}

export function mockIllustration(req: IllustrationRequest, model = 'mock'): IllustrationResponse {
  return { image: MOCK_ILLUSTRATION_PNG, mime: 'image/png', prompt: imagePrompt(req.subject, req.theme), mock: true, model };
}
