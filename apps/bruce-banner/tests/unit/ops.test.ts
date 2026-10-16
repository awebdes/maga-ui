import { describe, expect, it } from 'vitest';
import { History } from '../../src/engine/history';
import { addLayer, duplicateLayer, findLayer, moveLayer, removeLayer, scaleLayer, setLanguageEnabled, setRotation, setText, setTheme, switchLayout } from '../../src/engine/ops';
import { docFromTemplate } from '../../src/engine/templates';
import { normalizeUz } from '../../src/engine/uz';
import type { BannerDoc, CardLayer, TextLayer } from '../../src/engine/types';

describe('normalizeUz', () => {
  it('turns every o/g apostrophe into U+2018 and keeps the tutuq belgisi as U+2019', () => {
    expect(normalizeUz("ko'paytiring, so`m, Oʻzbekiston, g’alaba")).toBe('ko‘paytiring, so‘m, O‘zbekiston, g‘alaba');
    expect(normalizeUz("ma'lumot")).toBe('ma’lumot');
  });
});

describe('ops', () => {
  it('normalises Uzbek on entry and records the source', () => {
    const d = docFromTemplate('loan');
    setText(d, 'title', 'uz', "Kredit so'mda");
    expect(d.copy.title.uz).toBe('Kredit so‘mda');
    expect(d.copy.title.src.uz).toBe('user');
  });

  it('duplicates hand-added text with its own slot and prunes it on delete', () => {
    const d = docFromTemplate('loan');
    const t = addLayer(d, 'text') as TextLayer;
    setText(d, t.contentKey, 'ru', 'Первый');
    const copy = duplicateLayer(d, t.id) as TextLayer;
    expect(copy.contentKey).not.toBe(t.contentKey);
    setText(d, copy.contentKey, 'ru', 'Второй');
    expect(d.copy[t.contentKey].ru).toBe('Первый');
    removeLayer(d, copy.id);
    expect(d.copy[copy.contentKey]).toBeUndefined();
    expect(d.copy.title).toBeDefined();
  });

  it('switches layout keeping the texts and reports what the new one hides', () => {
    const d = docFromTemplate('loan');
    setText(d, 'title', 'ru', 'Мой заголовок');
    const hidden = switchLayout(d, 'cumulative');
    expect(d.template).toBe('cumulative');
    expect(d.copy.title.ru).toBe('Мой заголовок');
    expect(hidden).toEqual(['badge']);
    // and back: the badge text is still there
    switchLayout(d, 'oddly');
    expect(d.copy.badge1.ru).toBe('за 2 минуты');
  });

  it('recolours shadows with the theme', () => {
    const d = docFromTemplate('humo');
    setTheme(d, 'orange');
    const card = d.layers.find((l): l is CardLayer => l.kind === 'card')!;
    expect(card.shadow?.color).toBe('#C4620F');
    expect(d.background).toEqual({ type: 'solid', color: '#F4821F' });
    expect((d.layers.find((l) => l.kind === 'text') as TextLayer).color).toBe('#FFFFFF');
  });

  it('moves, scales and rotates in design px', () => {
    const d = docFromTemplate('loan');
    moveLayer(d, 'art', 10, -5);
    scaleLayer(d, 'art', 2);
    setRotation(d, 'art', 200);
    expect(findLayer(d, 'art')).toMatchObject({ cx: 278.1, cy: 70.1, w: 305, h: 305, rot: -160 });
  });

  it('keeps at least one language on', () => {
    const d = docFromTemplate('loan');
    setLanguageEnabled(d, 'ru', false);
    setLanguageEnabled(d, 'uz', false);
    setLanguageEnabled(d, 'en', false);
    expect(d.languages.enabled).toEqual(['en']);
    expect(d.languages.primary).toBe('en');
  });

  it('undoes and redoes whole documents', () => {
    const h = new History<BannerDoc>();
    const a = docFromTemplate('loan', { now: 1 });
    const b = structuredClone(a);
    setText(b, 'title', 'ru', 'B');
    h.push(a);
    const undone = h.undo(b)!;
    expect(undone.copy.title.ru).toBe(a.copy.title.ru);
    expect(h.redo(undone)!.copy.title.ru).toBe('B');
  });
});
