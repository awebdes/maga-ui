/** What the models are told. One place to tune the voice, the facts rule and the art style. */
import type { Catalog, LangText, SlotLimit, TextOp } from './contracts.js';

export const BRAND = `Ipoteka Bank (OTP Group), Uzbekistan. Mobile app promo banners: a 328×106 slot, a short title of two or three lines on the left, optional badges, a glossy 3D brand illustration or a bank card on the right.`;

export const VOICE = `Voice: short, concrete, benefit first. Numbers as digits (100 млн, 18%, 16,99%). No exclamation marks, no CAPS, no clickbait, no emoji unless the brief has one. Sentence case. Bank-appropriate: calm and trustworthy.`;

export const FACTS = `Facts: use ONLY the numbers, rates, amounts, dates, terms and conditions written in the brief. Never invent, round or "improve" them. If the brief has no number, write the copy without numbers.`;

export const LANGS = `Write all three languages, each natively, not word for word: ru — Russian; uz — Uzbek in Latin script, use the character ‘ (U+2018) in o‘ and g‘ (so‘m, ko‘proq, to‘lov, g‘oyib), "so‘m" for the currency; en — English, "UZS" or "sum" for the currency.`;

export function briefSystem(c: Catalog) {
  const layouts = c.layouts
    .map((l) => `- ${l.id} (${l.group}): ${l.about}. Slots: ${Object.entries(l.slots).map(([k, s]) => `${k} ≤ ${s.maxChars} chars × ${s.maxLines} lines`).join(', ')}`)
    .join('\n');
  const themes = c.themes.map((t) => `${t.id} (${t.label})`).join(', ');
  const assets = c.assets.map((a) => `- ${a.id} [${a.kind}]: ${a.about}`).join('\n');
  return [
    `You write promo banners for ${BRAND}`,
    VOICE,
    FACTS,
    LANGS,
    `Fit: every text must fit its slot in every language: at most maxChars characters per line and maxLines lines. Put "\\n" where a title should break so lines read naturally and are balanced. Badges are one short line.`,
    `Layouts (choose by what the message needs: a badge for a short highlight such as "до 18%" or "за 2 минуты", stat + statUnit for an exchange rate, a card layout for a card product):\n${layouts}`,
    `Themes: ${themes}. Green themes for loans, deposits and everyday products; gold and silver for premium cards; night for bold offers; sky for savings; light for calm, informational banners; orange for promotions.`,
    `Illustration: "art" is the asset id from this library that best shows the subject:\n${assets}\nIf no asset shows the subject well, still pick the closest one and describe the ideal illustration in "generate": one short Russian phrase naming a single object, e.g. "зелёная бензоколонка с оранжевой монетой-процентом" (the person sees it and may edit it before drawing). Otherwise leave "generate" empty.`,
    `"why": one short Russian sentence for the person choosing: what this variant emphasises.`,
    `Return exactly 3 variants that really differ: a different layout or theme and a different angle in the copy. Fill only the slots the chosen layout has.`,
  ].join('\n\n');
}

export function briefPrompt(brief: string, avoid: string[] = []) {
  return [`Brief:\n"""${brief}"""`, avoid.length ? `Avoid these layouts, they were already shown: ${avoid.join(', ')}.` : ''].filter(Boolean).join('\n\n');
}

const OP_TASK: Record<TextOp, string> = {
  shorter: 'Make the text shorter so it fits comfortably; keep every fact and number.',
  rephrase: 'Write a different wording with the same facts and numbers; keep about the same length.',
  translate: 'Translate from the source language into the target languages, natively and idiomatically, keeping every number and name.',
  fix: 'Fix grammar, spelling and typography only. Uzbek: Latin script with ‘ in o‘ and g‘.',
};

export function textSystem() {
  return [`You edit banner copy for ${BRAND}`, VOICE, FACTS, LANGS, 'Keep line breaks ("\\n") only where a title should break. Return JSON with the rewritten texts and an optional short Russian "note" for the person if something needs their attention.'].join('\n\n');
}

export function textPrompt(op: TextOp, slot: string, texts: LangText, from: string, to: string[], limits?: SlotLimit, context?: { title?: string; brief?: string }) {
  return [
    `Task: ${OP_TASK[op]}`,
    `Slot: ${slot}${limits ? ` (≤ ${limits.maxChars} characters per line, ≤ ${limits.maxLines} lines)` : ''}.`,
    `Source language: ${from}. Write: ${to.join(', ')}.`,
    `Current texts:\n${JSON.stringify(texts)}`,
    context?.title ? `Banner title for context: ${context.title}` : '',
    context?.brief ? `Original brief (the only source of facts): ${context.brief}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

const THEME_PALETTE: Record<string, string> = {
  gold: 'warm gold and champagne with green accents',
  bronze: 'warm gold with green accents',
  silver: 'silver-grey with green accents',
  graphite: 'silver-grey with green accents',
  sky: 'saturated green with light blue accents',
  orange: 'saturated green with orange accents',
  night: 'saturated green, lit to stand out on black',
};

export function imagePrompt(subject: string, theme?: string, withRefs = false) {
  const palette = (theme && THEME_PALETTE[theme]) ?? 'saturated green (#52AE30 to lime #A3E05A) with small orange (#FF6A13) accents';
  return [
    `A single glossy 3D illustration in the style of the Ipoteka Bank app banners: soft rounded shapes, smooth glossy and soft-matte plastic surfaces, ${palette}, soft studio light from the upper left, gentle reflections.`,
    `Subject: ${subject}.`,
    `Composition: one object, centred, three-quarter view, filling about 70% of the square, nothing cut off.`,
    `Isolated object on a perfectly flat, solid magenta background (#FF00FF). No floor, no ground shadow, no gradient, no vignette, no other objects. No text, no letters, no numbers unless the subject is a number, no logos, no watermark.`,
    withRefs ? 'Match the rendering style, materials and lighting of the reference images; do not copy their objects.' : '',
  ]
    .filter(Boolean)
    .join('\n');
}
