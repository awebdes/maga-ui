/**
 * Uzbek Latin typography. The templates (and Squad) use U+2018 ‘ in o‘ / g‘; people and models type
 * ʻ ' ’ ` ʼ instead. The tutuq belgisi (ma’lumot) keeps U+2019 ’.
 */
const MARKS = "'`ʻʼ’‘";
const OG = new RegExp(`([oOgG])[${MARKS}]`, 'g');
const TUTUQ = new RegExp(`(\\p{L})[${MARKS.replace('‘', '')}](\\p{L})`, 'gu');

export function normalizeUz(text: string) {
  return text.replace(OG, '$1‘').replace(TUTUQ, '$1’$2');
}
