#!/usr/bin/env node
// Style A/B for AI illustrations: the same subjects drawn with the brand style in words only and
// with the three brand illustrations sent as style references (GEMINI_STYLE_REFS), keyed the way
// the app keys them, side by side next to the library pictures. Spends real image calls:
//   subjects × columns × $0.0336 (gemini-nano-banana-2.1); STYLE_AB_PRO=1 adds a gemini-3-pro-image
//   column at $0.134 each. With the default 6 subjects: about $0.40, or $1.20 with the pro column.
// Needs GEMINI_API_KEY in .env.local (AI_MOCK=1 runs the mechanics on the fixture for free).
//   NODE_USE_ENV_PROXY=1 node tests/e2e/style-ab.mjs  →  tests/e2e/out/style-ab.png
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startServer, launch } from './browser.mjs';

const out = fileURLToPath(new URL('./out/', import.meta.url));
const SUBJECTS = [
  'зелёный планшет с анкетой и оранжевой галочкой',
  'зелёная машина с оранжевым ключом',
  'зелёная подарочная коробка с оранжевой лентой',
  'зелёный щит с оранжевой галочкой',
  'смартфон с оранжевой монетой кэшбэка',
  'зелёный чемодан с оранжевым самолётиком',
];
const COLUMNS = [
  { label: 'Стиль текстом', env: { GEMINI_STYLE_REFS: '0' } },
  { label: 'С референсами', env: { GEMINI_STYLE_REFS: '1' } },
  ...(process.env.STYLE_AB_PRO === '1' ? [{ label: '3-pro-image + референсы', env: { GEMINI_STYLE_REFS: '1', GEMINI_IMAGE_MODEL: 'gemini-3-pro-image' } }] : []),
];

await mkdir(out, { recursive: true });
const { server, url } = await startServer(4342);
const { browser, page, errors } = await launch({ width: 1200, height: 900, scale: 2 });
const keep = { ...process.env };

/** One drawing through the app's own endpoint; the handler reads the env per request. */
async function draw(subject, env) {
  Object.assign(process.env, keep, env);
  const res = await fetch(`${url}/api/ai/illustration`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: url, 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify({ subject, theme: 'emerald' }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${body.message}`);
  return body;
}

try {
  const rows = [];
  let mock = false;
  for (const subject of SUBJECTS) {
    const cells = [];
    for (const col of COLUMNS) {
      try {
        const r = await draw(subject, col.env);
        mock ||= r.mock;
        cells.push({ mime: r.mime, image: r.image });
        console.log(`✓ ${col.label}: ${subject}`);
      } catch (e) {
        cells.push({ error: e.message });
        console.log(`✗ ${col.label}: ${subject} — ${e.message}`);
      }
    }
    rows.push({ subject, cells });
  }
  Object.assign(process.env, keep);
  await writeFile(`${out}style-ab.json`, JSON.stringify({ columns: COLUMNS.map((c) => c.label), rows: rows.map((r) => ({ subject: r.subject, errors: r.cells.map((c) => c.error ?? null) })) }, null, 2));

  // key every drawing with the app's chroma code and lay out the sheet in the dev server's page
  await page.goto(url);
  await page.waitForFunction(() => window.__bb?.ready, null, { timeout: 30000 });
  await page.evaluate(
    async ({ rows, columns, mock }) => {
      const { keyMagenta, crop } = await import('/src/app/chroma.ts');
      const keyed = async (mime, b64) => {
        const img = new Image();
        img.src = `data:${mime};base64,${b64}`;
        await img.decode();
        const c = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height);
        const r = crop(keyMagenta(d.data, c.width, c.height));
        const o = document.createElement('canvas');
        o.width = r.width;
        o.height = r.height;
        o.getContext('2d').putImageData(new ImageData(r.data, r.width, r.height), 0, 0);
        return o;
      };
      const sheet = document.createElement('div');
      sheet.id = 'ab-sheet';
      sheet.style.cssText = 'position:fixed;inset:0;z-index:9999;overflow:auto;background:#0e0e10;color:#ddd;font:13px/1.3 Geist,system-ui;padding:24px';
      const grid = document.createElement('div');
      grid.style.cssText = `display:grid;grid-template-columns:200px repeat(${columns.length + 1},170px);gap:10px;align-items:center`;
      const cell = (child, bg = '#1a1a1e') => {
        const d = document.createElement('div');
        d.style.cssText = `height:170px;display:grid;place-items:center;border-radius:12px;background:${bg};overflow:hidden`;
        if (child) {
          child.style.maxWidth = '88%';
          child.style.maxHeight = '88%';
          d.append(child);
        }
        return d;
      };
      const head = (t) => Object.assign(document.createElement('b'), { textContent: t });
      grid.append(head(mock ? 'ДЕМО: заготовка вместо Gemini' : 'Предмет'), ...columns.map(head), head('Из библиотеки'));
      // the house style to match: library pictures, one per row in turn
      const libs = ['money-loan', 'deposit-time', 'mortgage', 'money-deposit', 'ruble', 'zero-percent'].map((n) => `/src/brand/img/${n}.png`);
      for (const [i, r] of rows.entries()) {
        const lib = libs[i % libs.length];
        grid.append(Object.assign(document.createElement('span'), { textContent: r.subject }));
        for (const c of r.cells) {
          if (c.error) grid.append(cell(Object.assign(document.createElement('span'), { textContent: c.error })));
          else grid.append(cell(await keyed(c.mime, c.image), 'repeating-conic-gradient(#232327 0 25%, #1b1b1f 0 50%) 0 0 / 16px 16px'));
        }
        const ref = document.createElement('img');
        ref.src = lib;
        await ref.decode().catch(() => {});
        grid.append(cell(ref, '#0b5a3c'));
      }
      sheet.append(grid);
      document.body.append(sheet);
    },
    { rows, columns: COLUMNS.map((c) => c.label), mock },
  );
  // the app clips the page at the window: make the window as tall as the sheet
  await page.setViewportSize({ width: 1200, height: 120 + rows.length * 180 });
  await page.locator('#ab-sheet > div').screenshot({ path: `${out}style-ab.png` });
  console.log(`sheet → ${out}style-ab.png${mock ? ' (demo: no Gemini key, the fixture everywhere)' : ''}`);
  if (errors.length) console.log('page errors:', errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  await server.close();
}
