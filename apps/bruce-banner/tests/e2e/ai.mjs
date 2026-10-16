#!/usr/bin/env node
// AI flows on mocks (no key, no network): brief → three variants → «Ещё варианты» → take one →
// draw an illustration (keyed off magenta in the worker: transparent corners) → place it →
// translate with an answer that arrives after a hand edit (the stale language is dropped) →
// review chip → team access code → network failure. Needs `npm run vendor`.
import { startServer, launch, checker } from './browser.mjs';

const { server, url } = await startServer(4335, { env: { AI_MOCK: '1' } });
const { browser, page, errors } = await launch({ width: 1440, height: 900 });
const ck = checker();
const { check } = ck;
const wait = (ms) => page.waitForTimeout(ms);
const bb = (fn, arg) => page.evaluate(fn, arg);

try {
  await page.goto(url);
  await page.waitForFunction(() => window.__bb?.ready, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__bb.aiState() === 'mock');
  check(true, 'AI reports demo mode without a key');

  /* ---------- brief → variants ---------- */
  const briefs = [];
  page.on('request', (r) => r.url().endsWith('/api/ai/brief') && briefs.push(r.postDataJSON()));
  await page.click('#brief-examples .chip:first-child');
  await page.click('#brief-go');
  await page.waitForSelector('.var-card:not(.is-skeleton)', { timeout: 15000 });
  check((await page.locator('.var-card:not(.is-skeleton)').count()) === 3, 'a brief gives three variants');
  check((await page.getAttribute('#var-status', 'data-state')) === 'mock', 'the status says it is a demo');
  check(briefs[0]?.catalog?.layouts?.length === 15 && Object.keys(briefs[0].catalog.layouts[0].slots).length > 0, 'the request carries the catalog with measured slot limits');
  await page.click('#var-more');
  await page.waitForFunction(() => document.querySelectorAll('.var-card:not(.is-skeleton)').length === 3 && !document.querySelector('#var-more[disabled]'));
  check(briefs[1]?.avoid?.length === 3, '«Ещё варианты» asks for layouts not shown yet');
  await page.click('#var-lang [data-value="uz"]');
  await wait(200);
  check((await page.locator('.var-card canvas').count()) === 3, 'variants redraw in UZ');
  await page.click('.var-card:first-child .cell.primary');
  await page.waitForFunction(() => window.__bb.editor.mode === 'editor');
  check(await bb(() => !!window.__bb.editor.doc.brief), 'the taken variant keeps its brief');

  /* ---------- illustration ---------- */
  const art = await bb(() => {
    const l = window.__bb.editor.doc.layers.find((x) => x.kind === 'image');
    window.__bb.editor.select(l.id);
    return { id: l.id, w: l.w, src: l.src };
  });
  await wait(300);
  await page.click('#inspector [data-gen]');
  await page.waitForSelector('.gen-pop.is-open');
  await page.fill('.gen-pop textarea', 'зелёная копилка с оранжевой монетой');
  await page.click('.gen-pop .cell.primary');
  await page.waitForSelector('.gen-result img', { timeout: 20000 });
  const keyed = await bb(async () => {
    const img = document.querySelector('.gen-result img');
    await img.decode();
    const c = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const a = (px, py) => d[(py * c.width + px) * 4 + 3];
    return { corner: Math.max(a(0, 0), a(c.width - 1, 0), a(0, c.height - 1), a(c.width - 1, c.height - 1)), centre: a(c.width >> 1, c.height >> 1), w: c.width, h: c.height };
  });
  check(keyed.corner === 0 && keyed.centre === 255, `the magenta background is keyed out (corners ${keyed.corner}, centre ${keyed.centre})`);
  check(keyed.w < 1024 && keyed.h < 1024, `the drawing is cropped to the object (${keyed.w}×${keyed.h})`);
  await page.click('.gen-pop .gen-actions .cell:not(.primary)');
  await wait(400);
  const placed = await bb((id) => window.__bb.editor.doc.layers.find((l) => l.id === id), art.id);
  check(placed.src.startsWith('blob:') && placed.w < art.w, `it replaces the illustration, fitted to the old picture (${art.w.toFixed(0)} → ${placed.w.toFixed(0)} px)`);

  /* ---------- «Мои картинки»: the drawing is there in any banner ---------- */
  const drawn = placed.src;
  const back = await bb(() => window.__bb.editor.doc.id);
  await bb(() => window.__bb.flushSave());
  await bb(() => window.__bb.openTemplate('cumulative'));
  await bb(() => window.__bb.editor.select(window.__bb.editor.doc.layers.find((l) => l.kind === 'image').id));
  await page.waitForSelector('#inspector .asset-mine .asset');
  check((await page.getAttribute('#inspector .asset-mine .asset', 'data-ref')) === drawn, 'another banner offers the drawing under «Мои картинки»');
  await page.click('#inspector .asset-mine .asset');
  check(await bb((ref) => window.__bb.editor.doc.layers.find((l) => l.kind === 'image').src === ref, drawn), 'one click puts it there');
  await page.evaluate((id) => (location.hash = `#/b/${id}`), back);
  await page.waitForFunction((id) => window.__bb.editor.doc?.id === id, back);
  await wait(400);

  /* ---------- a late answer never overwrites a hand edit ---------- */
  await page.route('**/api/ai/text', async (route) => {
    await new Promise((r) => setTimeout(r, 900));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ texts: { uz: 'AI javobi', en: 'AI answer' }, mock: false, model: 'test' }) });
  });
  await bb(() => window.__bb.editor.select(window.__bb.editor.doc.layers.find((l) => l.kind === 'text').id));
  await wait(300);
  await page.click('#inspector .ai-tools .ai-btn:nth-child(3)');
  await page.fill('#inspector .copy-row[data-lang="uz"] textarea', 'Qo‘lda yozildi');
  await page.waitForFunction(() => window.__bb.editor.doc.copy.title.en === 'AI answer', null, { timeout: 5000 });
  const t = await bb(() => window.__bb.editor.doc.copy.title);
  check(t.uz === 'Qo‘lda yozildi', 'the language typed in meanwhile keeps the hand edit');
  check(t.en === 'AI answer' && t.src.en === 'ai', 'the other language takes the AI answer, marked as AI');
  await page.unroute('**/api/ai/text');
  await page.mouse.click(700, 780);
  await page.click('#lang-seg [data-value="en"]');
  await wait(200);
  check(await page.isVisible('#review-chip'), 'AI copy on screen asks for a human look');
  await page.click('#review-ok');
  await wait(200);
  check(!(await page.isVisible('#review-chip')) && (await bb(() => window.__bb.editor.doc.copy.title.src.en)) !== 'ai', '«Проверено» clears it');

  /* ---------- team access code ---------- */
  let asked = 0;
  let codeSeen = '';
  await page.route('**/api/ai/brief', async (route) => {
    asked++;
    codeSeen = route.request().headers()['x-banner-code'] ?? '';
    if (!codeSeen) await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'unauthorized', message: 'Нужен код доступа команды' }) });
    else await route.continue();
  });
  await page.click('#home-btn');
  await page.waitForFunction(() => window.__bb.editor.mode === 'home');
  await page.fill('#brief textarea', 'Кэшбэк 5% на АЗС по карте Humo');
  await page.click('#brief-go');
  await page.waitForSelector('.code-pop.is-open');
  await page.fill('.code-pop input', 'team-code');
  await page.click('.code-pop .cell.primary');
  await page.waitForSelector('.var-card:not(.is-skeleton)', { timeout: 15000 });
  check(asked === 2 && codeSeen === 'team-code', 'a 401 asks for the code once and retries with it');
  check((await bb(() => localStorage.getItem('bb:code'))) === '"team-code"', 'the code stays in this browser');
  await page.unroute('**/api/ai/brief');

  /* ---------- failures read as words ---------- */
  await page.route('**/api/ai/brief', (route) => route.abort('connectionrefused'));
  await page.click('#var-more');
  await page.waitForFunction(() => document.querySelector('#var-status')?.dataset.state === 'error');
  check(/Сервер не отвечает|Нет интернета/.test(await page.textContent('#var-status')), 'a dead server is said in words, with a retry');
  await page.unroute('**/api/ai/brief');

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} catch (e) {
  console.error(e);
  check(false, `run finished: ${e.message}`);
} finally {
  await browser.close();
  await server.close();
}
process.exit(ck.failed ? 1 : 0);
