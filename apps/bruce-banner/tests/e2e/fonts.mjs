#!/usr/bin/env node
// Brand type with the real fonts: every official text of the 15 templates (45 in RU/UZ/EN) lays
// out without overflow, and Squad / Source Sans 3 have every glyph the copy needs (Cyrillic, the
// Uzbek ‘, «», №, digits). Shrunk texts and text/badge overlaps in the official copy are listed
// for the record: they are how the approved banners are. Needs `npm run vendor`.
import { startServer, launch, checker } from './browser.mjs';

const { server, url } = await startServer(4336, { env: { AI_MOCK: '1' } });
const { browser, page, errors } = await launch({ width: 1440, height: 900 });
const ck = checker();
const { check } = ck;

try {
  await page.goto(url);
  await page.waitForFunction(() => window.__bb?.ready, null, { timeout: 30000 });
  const fonts = await page.evaluate(async () => {
    await window.__bb.fontsReady;
    return ['600 16px Squad', '700 16px Squad', '600 16px "Source Sans 3"', '700 16px "Source Sans 3"'].map((f) => [f, document.fonts.check(f, 'Аа‘')]);
  });
  check(fonts.every(([, ok]) => ok), `brand fonts are loaded (${fonts.map(([f, ok]) => `${f}: ${ok ? 'ok' : 'missing'}`).join(', ')})`);

  const ids = await page.$$eval('[data-template]', (els) => els.map((e) => e.dataset.template));
  const { rows, chars } = await page.evaluate(async (ids) => {
    const rows = [];
    const chars = { body: new Set(), head: new Set() };
    for (const id of ids) {
      await window.__bb.openTemplate(id);
      const doc = window.__bb.editor.doc;
      for (const lang of ['ru', 'uz', 'en']) {
        const lay = window.__bb.editor.layout(lang);
        for (const l of doc.layers) {
          if (l.kind !== 'text') continue;
          rows.push({ id, lang, layer: l.id, status: lay.texts[l.id].status, lines: lay.texts[l.id].lines.length });
          for (const ch of doc.copy[l.contentKey]?.[lang] ?? '') chars[l.font].add(ch);
          if (l.sub) for (const ch of doc.copy[l.sub.contentKey]?.[lang] ?? '') chars[l.sub.font].add(ch);
        }
        for (const l of doc.layers) if (l.kind === 'badge' || l.kind === 'badgeRow' || l.kind === 'stat') for (const k of l.kind === 'badgeRow' ? l.items.map((i) => i.contentKey) : [l.contentKey, l.unitContentKey].filter(Boolean)) for (const ch of doc.copy[k]?.[lang] ?? '') chars[l.font].add(ch);
        for (const i of window.__bb.editor.issues(lang)) if (i.code === 'overlap' || i.code === 'shrunk') rows.push({ id, lang, note: `${i.code}: ${i.message}` });
      }
    }
    return { rows, chars: { body: [...chars.body].join(''), head: [...chars.head].join('') } };
  }, ids);

  const texts = rows.filter((r) => r.status);
  const over = texts.filter((r) => r.status === 'overflow');
  check(texts.length >= 45, `${texts.length} official texts laid out`);
  check(over.length === 0, `none overflows${over.length ? `: ${over.map((r) => `${r.id}/${r.lang}`).join(', ')}` : ''}`);
  const notes = rows.filter((r) => r.note);
  if (notes.length) console.log(`  for the record (official copy as approved):\n${notes.map((r) => `    ${r.id.padEnd(13)} ${r.lang}  ${r.note}`).join('\n')}`);

  // a glyph is missing when the text falls back: it measures like monospace AND like serif
  const extra = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя‘’«»№—–%0123456789';
  const missing = await page.evaluate(
    ({ chars, extra }) => {
      const c = document.createElement('canvas').getContext('2d');
      const width = (font, ch) => {
        c.font = font;
        return c.measureText(ch).width;
      };
      const out = {};
      for (const [family, name] of [
        ['head', 'Squad'],
        ['body', 'Source Sans 3'],
      ]) {
        const set = [...new Set([...chars[family], ...extra])].filter((ch) => ch.trim());
        for (const w of [600, 700]) {
          const miss = set.filter((ch) => {
            const mono = width(`${w} 40px monospace`, ch);
            const serif = width(`${w} 40px serif`, ch);
            if (Math.abs(mono - serif) < 0.01) return false;
            return Math.abs(width(`${w} 40px "${name}", monospace`, ch) - mono) < 0.01 && Math.abs(width(`${w} 40px "${name}", serif`, ch) - serif) < 0.01;
          });
          out[`${name} ${w}`] = miss.join('');
        }
      }
      return out;
    },
    { chars, extra },
  );
  for (const [face, miss] of Object.entries(missing)) check(!miss, `${face} has every glyph${miss ? `: missing ${miss}` : ''}`);
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} catch (e) {
  console.error(e);
  check(false, `run finished: ${e.message}`);
} finally {
  await browser.close();
  await server.close();
}
process.exit(ck.failed ? 1 : 0);
