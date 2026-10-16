/** Uzbek Latin ‘ in o‘ / g‘ (same rule as src/engine/uz.ts; the server cannot import the client engine). */
const MARKS = "'`ʻʼ’‘";
const OG = new RegExp(`([oOgG])[${MARKS}]`, 'g');
const TUTUQ = new RegExp(`(\\p{L})[${MARKS.replace('‘', '')}](\\p{L})`, 'gu');

export function normalizeUz(text: string) {
  return text.replace(OG, '$1‘').replace(TUTUQ, '$1’$2');
}

export const clip = (s: unknown, max: number) => (typeof s === 'string' ? s.slice(0, max) : '');
