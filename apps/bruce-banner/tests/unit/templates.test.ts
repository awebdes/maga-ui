import { describe, expect, it } from 'vitest';
import { ASSETS, assetById } from '../../src/engine/assets';
import { usedSlots } from '../../src/engine/checks';
import { docFromTemplate, GROUPS, TEMPLATES, blankDoc } from '../../src/engine/templates';
import { THEMES, themeById } from '../../src/engine/themes';
import { LANGS } from '../../src/engine/types';

describe('templates', () => {
  it('ports all 15 legacy templates in their groups', () => {
    expect(TEMPLATES).toHaveLength(15);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(15);
    for (const t of TEMPLATES) expect(GROUPS).toContain(t.group);
  });

  it('references only catalogued assets and known themes', () => {
    const ids = new Set(ASSETS.map((a) => a.id));
    for (const t of TEMPLATES) {
      expect(THEMES.map((x) => x.id)).toContain(t.theme);
      for (const l of t.layers) {
        if (l.kind === 'image' || l.kind === 'card' || l.kind === 'imageClip') expect(ids.has(l.src)).toBe(true);
        if (l.kind === 'pill') expect(assetById(l.icon)?.kind).toBe('logo');
      }
    }
  });

  it('has copy in every language for every slot a layer reads', () => {
    for (const t of TEMPLATES) {
      const doc = docFromTemplate(t.id);
      for (const key of usedSlots(doc)) for (const lang of LANGS) expect(doc.copy[key]?.[lang], `${t.id}.${key}.${lang}`).toBeTruthy();
    }
  });

  it('keeps the legacy copy verbatim, including the U+2018 in Uzbek', () => {
    const daromax = docFromTemplate('daromax');
    expect(daromax.copy.title.uz).toBe('Daromadingizni\n"DaroMax" bilan\nko‘paytiring');
    expect(daromax.copy.badge.ru).toBe('до 18%');
    const rub = docFromTemplate('rublerate');
    expect(rub.copy.statUnit.uz).toBe('so‘m');
    expect(rub.copy.title.ru).toBe('Выгодный курс\nрубля 🔥');
  });

  it('marks template copy as template text and keeps layers verbatim', () => {
    const d = docFromTemplate('loan', { now: 1 });
    expect(d.copy.title.src).toEqual({ ru: 'template', uz: 'template', en: 'template' });
    const art = d.layers.find((l) => l.id === 'art');
    expect(art).toMatchObject({ kind: 'image', src: 'money-loan', cx: 268.1, cy: 75.1, w: 152.5, h: 152.5, rot: 17.75 });
    expect(d.background).toEqual({ type: 'solid', color: '#006648' });
    expect(themeById(d.theme).id).toBe('emerald');
  });

  it('starts a blank banner white and empty', () => {
    const b = blankDoc();
    expect(b.layers).toEqual([]);
    expect(b.background).toEqual({ type: 'solid', color: '#FFFFFF' });
  });
});
