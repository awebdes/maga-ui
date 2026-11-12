#!/usr/bin/env node
// The team library with two people in two browsers against the in-memory library of the dev
// server: joining by code, a banner saved by one opens for the other with its picture and status,
// a stale save asks instead of overwriting, deleting removes it for everyone.
import { startServer, launch, checker } from './browser.mjs';

const CODE = 'team-code';
const { server, url } = await startServer(4341, { env: { AI_MOCK: '1', VITE_LIBRARY_URL: '/api/library', LIBRARY_MOCK_CODE: CODE } });
const { browser, page: a, errors } = await launch({ width: 1440, height: 900 });
const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const b = await ctxB.newPage();
b.on('pageerror', (e) => errors.push(`B pageerror: ${e.message}`));
const ck = checker();
const { check } = ck;
const wait = (p, ms) => p.waitForTimeout(ms);
const bb = (p, fn, arg) => p.evaluate(fn, arg);
const ready = async (p) => {
  await p.goto(url);
  await p.waitForFunction(() => window.__bb?.ready, null, { timeout: 30000 });
};
const join = async (p, name, code = CODE) => {
  await p.fill('.join-card input[autocomplete="name"]', name);
  await p.fill('.join-card input[type="password"]', code);
  await p.click('.join-card .cell.primary');
};
const pushed = (p) => p.waitForFunction(() => document.querySelector('#save-text')?.textContent === 'В библиотеке команды', null, { timeout: 15000 });
const title = (p) => bb(p, () => window.__bb.editor.doc.copy.title.ru);
const setTitle = (p, text) => bb(p, (t) => window.__bb.editor.change((d) => (d.copy.title.ru = t)), text);

try {
  /* ---------- joining ---------- */
  await ready(a);
  check(await a.isVisible('.join-card'), 'the home asks for a name and the team code');
  await join(a, 'Дилноза', 'wrong');
  await a.waitForFunction(() => document.querySelector('.join-err')?.textContent.length > 0);
  check(/код/i.test(await a.textContent('.join-err')), `a wrong code is said in words («${await a.textContent('.join-err')}»)`);
  await join(a, 'Дилноза');
  await a.waitForSelector('.proj-none');
  check(true, 'the right code opens the (empty) team library');

  /* ---------- Дилноза makes a banner with a drawing ---------- */
  await bb(a, () => window.__bb.openTemplate('loan'));
  await a.waitForFunction(() => window.__bb.editor.mode === 'editor');
  check(await a.isVisible('.st-btn'), 'the editor shows the banner status');
  await bb(a, () => window.__bb.editor.select(window.__bb.editor.doc.layers.find((l) => l.kind === 'image').id));
  await wait(a, 300);
  await a.click('#inspector [data-gen]');
  await a.fill('.gen-pop textarea', 'зелёный планшет с анкетой');
  await a.click('.gen-pop .cell.primary');
  await a.waitForFunction(() => document.querySelectorAll('.gen-tile img').length === 3, null, { timeout: 20000 });
  await a.click('.gen-tile:first-child');
  await a.click('.gen-pop .gen-actions .cell:not(.primary)');
  await setTitle(a, 'Пройдите опрос\nо приложении');
  await pushed(a);
  check(true, 'a save goes to the library a moment later');
  const id = await bb(a, () => window.__bb.editor.doc.id);
  const art = await bb(a, () => window.__bb.editor.doc.layers.find((l) => l.kind === 'image').src);
  await a.click('.st-btn');
  await a.click('#st-menu [data-status="review"]');
  await a.waitForFunction(() => document.querySelector('.st-btn .st-pill')?.textContent === 'На согласовании');
  check(true, 'the status changes to «На согласовании»');

  /* ---------- Азиз sees it and edits it ---------- */
  await ready(b);
  await join(b, 'Азиз');
  await b.waitForSelector('.proj-card');
  const card = await b.textContent('.proj-card');
  check(card.includes('На согласовании') && card.includes('Дилноза'), `Азиз sees the banner with its status and author («${card.trim().slice(0, 80)}»)`);
  check(await b.isVisible('.proj-card img'), 'with its picture');
  await b.click('.proj-open');
  await b.waitForFunction((id) => window.__bb.editor.doc?.id === id, id);
  check((await title(b)) === 'Пройдите опрос\nо приложении', 'it opens from the library in another browser');
  const drawn = await bb(b, async (ref) => {
    const l = window.__bb.editor.doc.layers.find((x) => x.kind === 'image');
    return l.src === ref;
  }, art);
  check(drawn, 'the drawing came along');
  await b.waitForTimeout(600);
  const pixels = await bb(b, () => {
    const c = window.__bb.renderCanvas('ru', 328);
    const d = c.getContext('2d').getImageData(240, 10, 80, 80).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  check(pixels > 100, 'and draws');
  await setTitle(b, 'Опрос: 2 минуты');
  await pushed(b);

  /* ---------- Дилноза, on the older version, saves: she is asked ---------- */
  await setTitle(a, 'Пройдите опрос сейчас');
  await a.waitForSelector('.conflict-bar:not([hidden])', { timeout: 15000 });
  check((await a.textContent('.conflict-bar')).includes('Азиз изменил баннер'), 'a stale save asks instead of overwriting the colleague');
  await a.click('.conflict-bar .cell:not(.primary)');
  await a.waitForFunction(() => window.__bb.editor.doc.copy.title.ru === 'Опрос: 2 минуты', null, { timeout: 10000 });
  check(true, '«Открыть версию: Азиз» brings his text');
  await setTitle(a, 'Опрос о приложении: 2 минуты');
  await pushed(a);
  check(true, 'and her next save goes through');

  /* ---------- deleting removes it for everyone ---------- */
  await a.click('#home-btn');
  await a.waitForSelector('.proj-card');
  await a.hover('.proj-card');
  await a.click('.proj-more');
  await a.click('.proj-card .menu-item.danger');
  check((await a.textContent('.proj-card .menu-item.danger')).includes('всей команды'), 'deleting a shared banner warns it is for everyone');
  await a.click('.proj-card .menu-item.danger');
  await a.waitForFunction(() => !document.querySelector('.proj-card'));
  await b.click('#home-btn');
  await b.waitForFunction(() => window.__bb.editor.mode === 'home');
  await b.waitForFunction(() => document.querySelector('.proj-none') || ![...document.querySelectorAll('.proj-date')].some((x) => x.textContent.includes('Дилноза')));
  const left = await b.$$eval('.proj-card .st-pill', (x) => x.length);
  check(left === 0, 'Азиз no longer sees it in the library');

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} catch (e) {
  console.error(e);
  check(false, `run finished: ${e.message}`);
} finally {
  await browser.close();
  await server.close();
}
process.exit(ck.failed ? 1 : 0);
