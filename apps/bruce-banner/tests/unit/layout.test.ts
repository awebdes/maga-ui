import { describe, expect, it } from 'vitest';
import { frameHit, layoutBanner, wrap } from '../../src/engine/layout';
import { setText } from '../../src/engine/ops';
import { docFromTemplate } from '../../src/engine/templates';
import type { TextLayer } from '../../src/engine/types';
import { fakeMeasure } from './fake-measure';

const title = (d: ReturnType<typeof docFromTemplate>) => d.layers.find((l): l is TextLayer => l.kind === 'text')!;

describe('wrap', () => {
  const w = (s: string) => s.length * 10;
  it('keeps hard breaks and empty lines, breaks on spaces', () => {
    expect(wrap('aa bb\n\ncc', 1000, w)).toEqual(['aa bb', '', 'cc']);
    expect(wrap('aaa bbb ccc', 70, w)).toEqual(['aaa bbb', 'ccc']);
  });
  it('never breaks a word that is too long on its own', () => {
    expect(wrap('aaaaaaaaaa b', 50, w)).toEqual(['aaaaaaaaaa', 'b']);
  });
});

describe('layoutBanner', () => {
  it('lays the official loan copy out without shrinking', () => {
    const d = docFromTemplate('loan');
    const lay = layoutBanner(d, 'ru', fakeMeasure);
    const t = lay.texts.title;
    expect(t.status).toBe('ok');
    expect(t.lines).toEqual(['До 100 миллионов', 'на любые цели']);
    expect(t.top).toBe(20);
    expect(t.bottom).toBe(20 + 2 * 22);
  });

  it('shrinks a long title to fit three lines, then flags overflow at the minimum size', () => {
    const d = docFromTemplate('loan');
    setText(d, 'title', 'ru', 'Кредит наличными до ста миллионов сумов на любые цели без залога и поручителей прямо в приложении');
    const lay = layoutBanner(d, 'ru', fakeMeasure);
    expect(['shrunk', 'overflow']).toContain(lay.texts.title.status);
    expect(lay.texts.title.size).toBeLessThan(16);
    setText(d, 'title', 'ru', 'Очень '.repeat(40));
    const over = layoutBanner(d, 'ru', fakeMeasure);
    expect(over.texts.title.status).toBe('overflow');
    expect(over.texts.title.size).toBe(title(d).minSize);
  });

  it('flags a single word wider than the column', () => {
    const d = docFromTemplate('loan');
    setText(d, 'title', 'uz', 'Ipotekabankkartalariga0%o‘tkazmalarcheksizbezkomissiyasiz');
    expect(layoutBanner(d, 'uz', fakeMeasure).texts.title.status).toBe('overflow');
  });

  it('centres a middle-aligned title per language', () => {
    const d = docFromTemplate('mortgage');
    const lay = layoutBanner(d, 'ru', fakeMeasure);
    const t = lay.texts.title;
    expect((t.top + t.bottom) / 2).toBeCloseTo(53, 5);
  });

  it('puts the Oddiy badges under the title, following its height per language', () => {
    const d = docFromTemplate('oddly');
    const ru = layoutBanner(d, 'ru', fakeMeasure);
    expect(ru.rows.badges.y).toBeCloseTo(ru.texts.title.bottom + 8, 5);
    expect(ru.rows.badges.items.map((i) => i.text)).toEqual(['до 18%', '3/6/12 мес.']);
    const uz = layoutBanner(d, 'uz', fakeMeasure);
    expect(uz.rows.badges.y).toBeCloseTo(uz.texts.title.bottom + 8, 5);
    // the row and the title together fit the slot
    expect(uz.rows.badges.y + uz.rows.badges.h).toBeLessThanOrEqual(106.5);
  });

  it('compat mode does not auto-fit', () => {
    const d = docFromTemplate('loan');
    setText(d, 'title', 'ru', 'Очень '.repeat(40));
    const lay = layoutBanner(d, 'ru', fakeMeasure, { compat: true, scale: 3 });
    expect(lay.texts.title.size).toBe(16);
    expect(lay.texts.title.status).toBe('ok');
  });

  it('gives rotated frames for hit-testing', () => {
    const d = docFromTemplate('loan');
    const lay = layoutBanner(d, 'ru', fakeMeasure);
    const badge = lay.frames.badge;
    expect(badge.rot).toBeCloseTo(-5.87);
    expect(frameHit(badge, badge.cx, badge.cy)).toBe(true);
    expect(frameHit(badge, badge.cx + badge.w, badge.cy)).toBe(false);
  });
});
