import { CONTRAST_HINT, contrast, parseColor, renderBanner, slotLabel, type BannerDoc, type BannerLayout, type Issue, type Lang } from '../engine';
import { getImage } from './images';
import { measure } from './measure';

/**
 * Text against what is actually behind it: the banner drawn without its texts, badges and rates,
 * sampled under every line. A hint, never a gate: several approved templates sit near 2.6:1.
 */
export function contrastIssues(doc: BannerDoc, lang: Lang, lay: BannerLayout): Issue[] {
  const { w, h } = doc.format;
  const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  renderBanner(ctx, doc, { lang, scale: 1, measure, image: getImage, layout: lay, skip: (l) => l.kind === 'text' || l.kind === 'badge' || l.kind === 'badgeRow' || l.kind === 'stat' });
  const px = ctx.getImageData(0, 0, w, h).data;
  const out: Issue[] = [];
  for (const l of doc.layers) {
    if (l.hidden || l.kind !== 'text') continue;
    const t = lay.texts[l.id];
    if (!t?.lines.length) continue;
    const fg = parseColor(l.color);
    const ratios: number[] = [];
    t.lineWidths.forEach((lw, i) => {
      const mid = t.top + (i + 0.5) * t.lineHeight;
      for (let x = l.x + 1; x < l.x + lw; x += 2)
        for (const dy of [-0.25, 0, 0.25]) {
          const sx = Math.round(x);
          const sy = Math.round(mid + dy * t.size);
          if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
          const o = (sy * w + sx) * 4;
          ratios.push(contrast(fg, [px[o], px[o + 1], px[o + 2]]));
        }
    });
    if (!ratios.length) continue;
    ratios.sort((a, b) => a - b);
    // judged on the typical background under the words, not on a stray light pixel
    if (ratios[Math.floor(ratios.length / 2)] < CONTRAST_HINT) out.push({ lang, severity: 'hint', code: 'contrast', layerId: l.id, slot: l.contentKey, message: `${slotLabel(l.contentKey)} плохо читается на фоне` });
  }
  return out;
}
