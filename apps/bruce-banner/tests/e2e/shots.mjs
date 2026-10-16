#!/usr/bin/env node
// README screenshots of the key states, on AI mocks, into docs/screens/ (gitignored while the
// repo is public: they show brand pictures and fonts). Needs `npm run vendor`.
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startServer, launch } from './browser.mjs';

const out = fileURLToPath(new URL('../../docs/screens/', import.meta.url));
await mkdir(out, { recursive: true });
const { server, url } = await startServer(4338, { env: { AI_MOCK: '1' } });
const { browser, page, errors } = await launch({ width: 1440, height: 900, scale: 2 });
const shot = (name) => page.screenshot({ path: `${out}${name}.png` });
const wait = (ms) => page.waitForTimeout(ms);
const bb = (fn, arg) => page.evaluate(fn, arg);

try {
  await page.goto(url);
  await page.waitForFunction(() => window.__bb?.ready, null, { timeout: 30000 });
  await bb(() => window.__bb.fontsReady);
  await wait(800);
  await shot('start');

  await page.fill('#brief textarea', 'Кредит до 100 млн сум за 2 минуты, без справок');
  await page.click('#brief-go');
  await page.waitForSelector('.var-card:not(.is-skeleton)');
  await wait(900);
  await shot('variants');

  await page.click('.var-card:first-child .cell.primary');
  await page.waitForFunction(() => window.__bb.editor.mode === 'editor');
  await wait(700);
  await shot('editor');

  const title = await bb(() => window.__bb.frameRect('title'));
  await page.mouse.dblclick(title.cx, title.cy);
  await page.waitForSelector('.text-pop.is-open');
  await wait(500);
  await shot('text');
  await page.keyboard.press('Escape');
  await page.mouse.click(700, 780);

  await page.click('#all-langs');
  await wait(700);
  await shot('languages');
  await page.click('#all-langs');

  await bb(() => window.__bb.editor.select(window.__bb.editor.doc.layers.find((l) => l.kind === 'image').id));
  await wait(300);
  await page.click('#inspector [data-gen]');
  await page.fill('.gen-pop textarea', 'зелёная копилка с оранжевой монетой');
  await page.click('.gen-pop .cell.primary');
  await page.waitForSelector('.gen-result img');
  await wait(700);
  await shot('illustration');
  await page.keyboard.press('Escape');
  await page.mouse.click(700, 780);
  await bb(() => window.__bb.editor.select(null));

  await page.click('#export-btn');
  await page.waitForSelector('#export-sheet.is-open');
  await wait(700);
  await shot('export');
  await page.keyboard.press('Escape');
  await wait(300);

  await page.click('#preview-btn');
  await page.waitForSelector('#preview.is-open');
  await wait(1400);
  await shot('preview');
  await page.click('#preview .pv-dock [data-toggle]');
  await wait(1300);
  await shot('preview-languages');
  console.log(`screens → ${out}`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  if (errors.length) console.log(errors.join('\n'));
  await browser.close();
  await server.close();
}
