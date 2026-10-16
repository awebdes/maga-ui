import type { Measure } from '../../src/engine/layout';

/** Deterministic advance widths (em) so layout logic is testable in Node without a canvas. */
const NARROW = new Set([...'iljtf.,:;!|‘’\'` ']);
const WIDE = new Set([...'mwMWШЩЖЮшщжю%']);

export const fakeMeasure: Measure = (text, f) => {
  let em = 0;
  let n = 0;
  for (const ch of text) {
    n++;
    if (NARROW.has(ch)) em += 0.28;
    else if (WIDE.has(ch)) em += 0.78;
    else if (/[0-9]/.test(ch)) em += 0.52;
    else if (ch === ch.toUpperCase() && ch !== ch.toLowerCase()) em += 0.62;
    else em += 0.5;
  }
  const weight = 1 + (f.weight - 400) / 3000;
  return em * f.size * weight + (n > 1 ? f.tracking * (n - 1) : 0);
};
