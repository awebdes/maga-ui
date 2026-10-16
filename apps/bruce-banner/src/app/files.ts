/** Names and texts of what the export writes: pure, so the unit tests cover them. */
import { LANG_LABEL, slotLabel, usedSlots, type BannerDoc, type Lang } from '../engine';
import { slug } from './dom';

export type Preset = 'app' | 'legacy';
export type Format = 'png' | 'jpg';

/** the legacy export size: 4096 px on the long edge */
export const LEGACY = { w: 4096, h: 1324 };

/** bruce-banner_<name>_<lang>@<n>x.png, or _4096 for the legacy size */
export function fileName(doc: BannerDoc, lang: Lang, preset: Preset, scale: number, format: Format) {
  const base = `bruce-banner_${slug(doc.name)}_${lang}`;
  return preset === 'legacy' ? `${base}_${LEGACY.w}.${format}` : `${base}@${scale}x.${format}`;
}

/** The copy of every enabled language, slot by slot: for the CMS and for review. */
export function textsOf(doc: BannerDoc) {
  // reading order for whoever pastes them: title, subtitle, badges, then the rest
  const rank = (k: string) => (k === 'title' ? 0 : k === 'sub' ? 1 : k.startsWith('badge') ? 2 : k === 'stat' ? 3 : k === 'statUnit' ? 4 : 5);
  const keys = usedSlots(doc).sort((a, b) => rank(a) - rank(b));
  return doc.languages.enabled
    .map((lang) => [`${LANG_LABEL[lang]}`, ...keys.filter((k) => doc.copy[k]?.[lang]?.trim()).map((k) => `${slotLabel(k)}: ${doc.copy[k][lang].replace(/\n/g, ' ')}`)].join('\n'))
    .join('\n\n');
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
