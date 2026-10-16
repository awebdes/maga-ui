import { fontCss, type FontSpec, type Measure } from '../engine';

/** Canvas text measurement with tracking applied per code point (legacy T7), memoised. */
export function createMeasure(): Measure {
  const ctx = new OffscreenCanvas(1, 1).getContext('2d')!;
  const cache = new Map<string, number>();
  let font = '';
  return (text: string, f: FontSpec) => {
    const key = `${f.family}|${f.weight}|${f.size}|${f.tracking}|${text}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const css = fontCss(f.family, f.weight, f.size);
    if (css !== font) {
      ctx.font = css;
      font = css;
    }
    let w: number;
    if (!f.tracking) w = ctx.measureText(text).width;
    else {
      w = 0;
      for (const ch of text) w += ctx.measureText(ch).width + f.tracking;
      w -= f.tracking;
    }
    if (cache.size > 20000) cache.clear();
    cache.set(key, w);
    return w;
  };
}

let inner = createMeasure();

/** The app-wide measure; widths cached until `resetMeasure`. */
export const measure: Measure = (text, f) => inner(text, f);

/** Drops cached widths, e.g. once fonts finish loading. */
export function resetMeasure() {
  inner = createMeasure();
}
