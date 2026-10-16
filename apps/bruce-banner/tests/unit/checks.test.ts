import { describe, expect, it } from 'vitest';
import { contrast, foreignNumbers, layoutIssues, numbersIn, parseColor } from '../../src/engine/checks';
import { layoutBanner } from '../../src/engine/layout';
import { setText, setTexts } from '../../src/engine/ops';
import { docFromTemplate } from '../../src/engine/templates';
import { fakeMeasure } from './fake-measure';

describe('numbersIn', () => {
  it('normalises decimals, thousand groups and multipliers', () => {
    expect([...numbersIn('Ипотека от 16,99%')]).toEqual([16.99]);
    expect(numbersIn('16.99% dan Ipoteka').has(16.99)).toBe(true);
    expect(numbersIn('до 100 000 000 сум').has(100000000)).toBe(true);
    expect(numbersIn('100 млн').has(100000000)).toBe(true);
    expect(numbersIn('100 million so‘mgacha').has(100000000)).toBe(true);
    expect([...numbersIn('3/6/12 мес.')]).toEqual([3, 6, 12]);
  });
});

describe('foreignNumbers', () => {
  it('flags numbers an AI wrote that the brief does not have, only in AI text', () => {
    const d = docFromTemplate('loan');
    d.brief = 'Кредит до 100 млн за 2 минуты';
    setTexts(d, 'title', { ru: 'До 100 миллионов под 18%', uz: '100 million so‘mgacha', en: 'Up to 100 million' }, 'ai');
    expect(foreignNumbers(d, 'ru')).toEqual([{ slot: 'title', numbers: [18] }]);
    expect(foreignNumbers(d, 'uz')).toEqual([]);
    setText(d, 'title', 'ru', 'До 100 миллионов под 18%', 'user');
    expect(foreignNumbers(d, 'ru')).toEqual([]);
  });
});

describe('contrast', () => {
  it('rates white on the official orange near 2.6:1 and on emerald well above 4.5', () => {
    const white = parseColor('#FFFFFF');
    expect(contrast(white, parseColor('#F4821F'))).toBeGreaterThan(2.4);
    expect(contrast(white, parseColor('#F4821F'))).toBeLessThan(2.8);
    expect(contrast(white, parseColor('#006648'))).toBeGreaterThan(4.5);
  });
  it('composites rgba over the backdrop', () => {
    expect(parseColor('rgba(255,255,255,0.5)', [0, 0, 0])).toEqual([127.5, 127.5, 127.5]);
  });
});

describe('layoutIssues', () => {
  it('reports a missing title and an overflow, per language', () => {
    const d = docFromTemplate('loan');
    setText(d, 'title', 'en', '');
    setText(d, 'title', 'uz', 'Juda '.repeat(40));
    const en = layoutIssues(d, layoutBanner(d, 'en', fakeMeasure));
    expect(en.map((i) => i.code)).toContain('empty');
    const uz = layoutIssues(d, layoutBanner(d, 'uz', fakeMeasure));
    expect(uz.map((i) => i.code)).toContain('overflow');
  });
});
