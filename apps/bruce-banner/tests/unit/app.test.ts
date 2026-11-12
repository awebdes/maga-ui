import { describe, expect, it } from 'vitest';
import { layoutIssues, overlapIssues, penetration } from '../../src/engine/checks';
import { layoutBanner } from '../../src/engine/layout';
import { renderBanner } from '../../src/engine/render';
import { findLayer, replaceArt, setAsset, setLanguageEnabled, setText } from '../../src/engine/ops';
import { docFromTemplate } from '../../src/engine/templates';
import type { ImageLayer } from '../../src/engine/types';
import { slug } from '../../src/app/dom';
import { fileName, plural, textsOf } from '../../src/app/files';
import { fakeMeasure } from './fake-measure';

describe('export names', () => {
  const doc = docFromTemplate('loan', { name: 'Кредит до 100 млн — осень' });
  it('slugs Cyrillic and Uzbek names to Latin', () => {
    expect(slug('Кредит до 100 млн — осень')).toBe('kredit-do-100-mln-osen');
    expect(slug('Ko‘proq so‘m')).toBe('koproq-som');
    expect(slug('!!!')).toBe('banner');
  });
  it('names files per language and size', () => {
    expect(fileName(doc, 'uz', 'app', 3, 'png')).toBe('bruce-banner_kredit-do-100-mln-osen_uz@3x.png');
    expect(fileName(doc, 'en', 'legacy', 1, 'jpg')).toBe('bruce-banner_kredit-do-100-mln-osen_en_4096.jpg');
  });
  it('writes the texts of enabled languages only', () => {
    const d = structuredClone(doc);
    setLanguageEnabled(d, 'en', false);
    const t = textsOf(d);
    expect(t).toContain('RU\nЗаголовок: До 100 миллионов на любые цели');
    expect(t).toContain('UZ\n');
    expect(t).not.toContain('EN');
  });
  it('agrees numbers with nouns in Russian', () => {
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => plural(n, 'файл', 'файла', 'файлов'))).toEqual(['файл', 'файла', 'файлов', 'файлов', 'файл', 'файла', 'файлов']);
  });
});

describe('replaceArt', () => {
  it('fits a tight drawing into the visible part of the old picture', () => {
    const d = docFromTemplate('daromax');
    const art = d.layers.find((l): l is ImageLayer => l.kind === 'image')!;
    const before = { ...art };
    // the old safe filled the middle 60% of its square, a bit to the right
    replaceArt(d, art.id, 'blob:abc', 2, { x: 0.3, y: 0.2, w: 0.6, h: 0.6 });
    const l = findLayer(d, art.id) as ImageLayer;
    expect(l.src).toBe('blob:abc');
    expect(l.w).toBeCloseTo(before.w * 0.6);
    expect(l.h).toBeCloseTo((before.w * 0.6) / 2);
    expect(l.cx).toBeCloseTo(before.cx + 0.1 * before.w);
    expect(l.cy).toBeCloseTo(before.cy);
  });
  it('keeps a portrait drawing inside the box height', () => {
    const d = docFromTemplate('loan');
    const art = d.layers.find((l): l is ImageLayer => l.kind === 'image')!;
    const w0 = art.w;
    const h0 = art.h;
    replaceArt(d, art.id, 'blob:tall', 0.5);
    const l = findLayer(d, art.id) as ImageLayer;
    expect(l.h).toBeCloseTo(h0);
    expect(l.w).toBeCloseTo(h0 * 0.5);
    expect(l.w).toBeLessThanOrEqual(w0);
  });
});

describe('overlap', () => {
  const square = (x: number, y: number, s: number): [number, number][] => [
    [x, y],
    [x + s, y],
    [x + s, y + s],
    [x, y + s],
  ];
  it('measures penetration between convex shapes', () => {
    expect(penetration(square(0, 0, 10), square(20, 0, 10))).toBe(0);
    expect(penetration(square(0, 0, 10), square(7, 0, 10))).toBeCloseTo(3);
  });
  it('warns when a longer translation runs under the badge', () => {
    const d = docFromTemplate('loan');
    expect(overlapIssues(d, layoutBanner(d, 'ru', fakeMeasure))).toEqual([]);
    setText(d, 'title', 'ru', 'Кредит наличными до ста миллионов сумов на любые цели');
    const issues = layoutIssues(d, layoutBanner(d, 'ru', fakeMeasure));
    expect(issues.some((i) => i.code === 'overlap' && i.severity === 'warn' && i.message === 'Бейдж закрывает заголовок')).toBe(true);
  });
  it('ignores an empty badge', () => {
    const d = docFromTemplate('loan');
    setText(d, 'title', 'ru', 'Кредит наличными до ста миллионов сумов на любые цели');
    setText(d, 'badge', 'ru', '');
    expect(overlapIssues(d, layoutBanner(d, 'ru', fakeMeasure))).toEqual([]);
  });
});

describe('a picture still to be drawn', () => {
  /** a canvas context that records which images are drawn and whether anything is filled */
  const recorder = () => {
    const drawn: unknown[] = [];
    let fills = 0;
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k) => (k === 'drawImage' ? (img: unknown) => drawn.push(img) : k === 'fill' ? () => fills++ : k in t ? t[k as string] : k === 'measureText' ? () => ({ width: 10 }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}),
      set: (t, k, v) => ((t[k as string] = v), true),
    });
    return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn, fills: () => fills };
  };
  it('shows a stand-in in the app and nothing in files, never the placeholder picture', () => {
    const doc = docFromTemplate('loan', { now: 0 });
    const art = doc.layers.find((l) => l.kind === 'image') as ImageLayer;
    art.awaiting = 'планшет с анкетой';
    const image = (ref: string) => (ref === art.src ? ({ width: 1, height: 1, tag: 'stand-in source' } as unknown as ImageBitmap) : null);
    const app = recorder();
    renderBanner(app.ctx, doc, { lang: 'ru', scale: 1, measure: fakeMeasure, image, standIns: true });
    const file = recorder();
    renderBanner(file.ctx, doc, { lang: 'ru', scale: 1, measure: fakeMeasure, image, standIns: false });
    expect(app.drawn).toHaveLength(0);
    expect(file.drawn).toHaveLength(0);
    expect(app.fills()).toBeGreaterThan(file.fills());
  });

  it('stops waiting when a picture is chosen or drawn for the layer', () => {
    const doc = docFromTemplate('loan', { now: 0 });
    const art = doc.layers.find((l) => l.kind === 'image') as ImageLayer;
    art.awaiting = 'планшет с анкетой';
    setAsset(doc, art.id, 'deposit-time');
    expect((findLayer(doc, art.id) as ImageLayer).awaiting).toBeUndefined();
    art.awaiting = 'планшет с анкетой';
    replaceArt(doc, art.id, 'blob:x', 1);
    expect((findLayer(doc, art.id) as ImageLayer).awaiting).toBeUndefined();
  });
});
