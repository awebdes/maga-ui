#!/usr/bin/env node
// The editor end to end, on AI mocks: start → template → floating text editor → overflow in UZ →
// undo on the Russian layout (key «я», code KeyZ) → drag → export ZIP (names, sizes, pixels equal
// the editor's render, opaque) → JPG and 4K → phone preview in three languages → layout switch →
// autosave survives a reload. Needs `npm run vendor` (brand fonts and pictures).
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { startServer, launch, checker } from './browser.mjs';

const { server, url } = await startServer(4334, { env: { AI_MOCK: '1' } });
const { browser, page, errors } = await launch({ width: 1440, height: 900 });
const ck = checker();
const { check } = ck;
const wait = (ms) => page.waitForTimeout(ms);
const bb = (fn, arg) => page.evaluate(fn, arg);
/** keydown as the Russian layout sends it: the key is a Cyrillic letter, the code is physical */
const ruKey = (key, code, mods = {}) => bb(([key, code, mods]) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...mods })), [key, code, mods]);
const pngSize = (buf) => [buf.readUInt32BE(16), buf.readUInt32BE(20)];

async function download(click) {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  return { name: dl.suggestedFilename(), data: await readFile(await dl.path()) };
}

try {
  await page.goto(url);
  await page.waitForFunction(() => window.__bb?.ready, null, { timeout: 30000 });
  await bb(() => window.__bb.fontsReady);
  check((await page.locator('[data-template]').count()) === 15, 'start shows the 15 official templates');

  /* ---------- template → editor ---------- */
  await page.click('[data-template="loan"]');
  await page.waitForFunction(() => window.__bb.editor.mode === 'editor');
  await wait(500);
  check(await bb(() => window.__bb.editor.doc.layers.length === 4), 'loan template opens with its 4 layers');
  check((await page.locator('#layers .layer-row').count()) === 4, 'layers list shows them');

  /* ---------- the tour (auto on first run for people, from the menu here) ---------- */
  await page.click('[data-menu="settings-menu"]');
  await page.click('#settings-menu [data-action="tour"]');
  await page.waitForSelector('.coach-wrap.is-open');
  await wait(700);
  const ring = await bb(() => document.querySelector('.spot').getBoundingClientRect().width);
  check(ring > 300, 'the tour opens on the banner with a spotlight');
  for (let i = 0; i < 4; i++) await page.click('.coach-foot .cell.ghost');
  await wait(700);
  const onExport = await bb(() => {
    const s = document.querySelector('.spot').getBoundingClientRect();
    const b = document.querySelector('#export-btn').getBoundingClientRect();
    return Math.abs(s.left + 6 - b.left) < 2 && Math.abs(s.width - 12 - b.width) < 2;
  });
  check(onExport, 'the last step points at Export');
  await page.click('.coach-foot .cell.ghost');
  await wait(300);
  check(!(await page.isVisible('.coach-wrap.is-open')) && (await bb(() => localStorage.getItem('bb:toured'))) === 'true', '«Понятно» closes it for good');

  /* ---------- floating text editor, overflow in UZ ---------- */
  const title = await bb(() => window.__bb.frameRect('title'));
  await page.mouse.dblclick(title.cx, title.cy);
  await page.waitForSelector('.text-pop.is-open');
  const uzBefore = await bb(() => window.__bb.editor.doc.copy.title.uz);
  const uzField = page.locator('.text-pop .copy-row[data-lang="uz"] textarea');
  await uzField.fill('Ko‘pfunksionalliklarimizdanfoydalanishingizmumkinmikan');
  await wait(200);
  const uzIssues = await bb(() => window.__bb.editor.issues('uz').map((i) => i.code));
  check(uzIssues.includes('overflow'), 'a word too long for the slot is flagged in UZ');
  check((await page.getAttribute('#lang-seg [data-value="uz"]', 'data-state')) === 'error', 'the UZ dot in the dock turns red');
  check(await bb(() => window.__bb.editor.lang === 'uz'), 'typing in UZ shows the UZ banner');
  await page.keyboard.press('Escape');
  await page.mouse.click(700, 760);
  await wait(200);

  /* ---------- undo / redo on the Russian layout ---------- */
  await ruKey('я', 'KeyZ', { ctrlKey: true });
  await wait(100);
  check((await bb(() => window.__bb.editor.doc.copy.title.uz)) === uzBefore, '⌘Z with key «я» (code KeyZ) undoes the typing');
  await ruKey('Я', 'KeyZ', { ctrlKey: true, shiftKey: true });
  await wait(100);
  check((await bb(() => window.__bb.editor.doc.copy.title.uz)).startsWith('Ko‘pfunksional'), '⇧⌘Z redoes it');
  await ruKey('я', 'KeyZ', { metaKey: true });
  await ruKey('с', 'Digit1');
  await wait(100);
  check(await bb(() => window.__bb.editor.lang === 'ru'), 'key 1 switches back to RU');

  /* ---------- drag with snapping off ---------- */
  const badge = await bb(() => window.__bb.frameRect('badge'));
  const zoom = await bb(() => window.__bb.stage.active.zoom);
  const cx0 = await bb(() => window.__bb.editor.doc.layers.find((l) => l.id === 'badge').cx);
  await page.keyboard.down('Alt');
  await page.mouse.move(badge.cx, badge.cy);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(badge.cx + i * 6, badge.cy, { steps: 2 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  const cx1 = await bb(() => window.__bb.editor.doc.layers.find((l) => l.id === 'badge').cx);
  check(Math.abs(cx1 - cx0 - 36 / zoom) < 0.6, `dragging the badge moves it in design px (${(cx1 - cx0).toFixed(2)} ≈ ${(36 / zoom).toFixed(2)})`);
  await ruKey('я', 'KeyZ', { ctrlKey: true });
  check(Math.abs((await bb(() => window.__bb.editor.doc.layers.find((l) => l.id === 'badge').cx)) - cx0) < 1e-6, 'the drag is one undo step');

  /* ---------- contrast hint ---------- */
  await bb(() => window.__bb.editor.change((d) => {
    d.theme = 'light';
    d.background = { type: 'solid', color: '#EBEEF2' };
  }));
  await bb(() => window.__bb.editor.select('title'));
  await wait(300);
  check(await page.isVisible('#inspector .insp-hint'), 'white text on a light background gets a readability hint');
  check((await bb(() => window.__bb.editor.issues('ru').find((i) => i.code === 'contrast')?.severity)) === 'hint', 'it is a hint, not a gate');
  await ruKey('я', 'KeyZ', { ctrlKey: true });
  await bb(() => window.__bb.editor.select(null));
  await wait(200);

  /* ---------- export ---------- */
  await page.click('#export-btn');
  await page.waitForSelector('#export-sheet.is-open');
  await wait(300);
  const zip = await download(() => page.click('#exp-zip'));
  const files = unzipSync(new Uint8Array(zip.data));
  const names = Object.keys(files).sort();
  check(zip.name === 'bruce-banner_kredit-do-100-mln.zip', `ZIP name ${zip.name}`);
  check(names.length === 10 && names.includes('texts.txt'), `ZIP holds 9 banners and texts.txt (${names.length})`);
  const sizes = Object.fromEntries(names.filter((n) => n.endsWith('.png')).map((n) => [n, pngSize(Buffer.from(files[n])).join('×')]));
  check(sizes['bruce-banner_kredit-do-100-mln_ru@1x.png'] === '328×106' && sizes['bruce-banner_kredit-do-100-mln_uz@2x.png'] === '656×212' && sizes['bruce-banner_kredit-do-100-mln_en@3x.png'] === '984×318', '@1x/@2x/@3x sizes are 328×106, 656×212, 984×318');
  check(new TextDecoder().decode(files['texts.txt']).includes('Заголовок: До 100 миллионов на любые цели'), 'texts.txt has the RU title');
  const same = await bb(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const x = c.getContext('2d');
    x.drawImage(bmp, 0, 0);
    const a = x.getImageData(0, 0, bmp.width, bmp.height).data;
    const ref = window.__bb.renderCanvas('ru', 656);
    const b = ref.getContext('2d').getImageData(0, 0, ref.width, ref.height).data;
    let max = 0;
    let alphaMin = 255;
    for (let i = 0; i < a.length; i++) {
      if (i % 4 === 3) alphaMin = Math.min(alphaMin, a[i]);
      max = Math.max(max, Math.abs(a[i] - b[i]));
    }
    return { max, alphaMin, size: a.length === b.length };
  }, Buffer.from(files['bruce-banner_kredit-do-100-mln_ru@2x.png']).toString('base64'));
  check(same.size && same.max <= 2, `the exported @2x equals the editor's render (max Δ ${same.max})`);
  check(same.alphaMin === 255, 'the PNG is opaque everywhere');

  await page.click('#exp-format [data-value="jpg"]');
  const jpg = await download(() => page.click('#exp-langs .exp-row:first-child .icon-btn'));
  check(jpg.name.endsWith('_ru@3x.jpg') && jpg.data[0] === 0xff && jpg.data[1] === 0xd8, `one language as JPG (${jpg.name})`);
  await page.click('#exp-format [data-value="png"]');
  await page.click('#exp-preset [data-value="legacy"]');
  const big = unzipSync(new Uint8Array((await download(() => page.click('#exp-zip'))).data));
  const bigPngs = Object.keys(big).filter((n) => n.endsWith('.png'));
  check(bigPngs.length === 3 && bigPngs.every((n) => pngSize(Buffer.from(big[n])).join('×') === '4096×1324'), 'the legacy preset writes 3 × 4096×1324');
  await page.click('#exp-preset [data-value="app"]');
  await page.keyboard.press('Escape');
  await wait(300);

  /* ---------- phone preview ---------- */
  await page.mouse.click(700, 760);
  await ruKey('з', 'KeyP');
  await page.waitForSelector('#preview.is-open');
  await wait(1300);
  const slot = await bb(() => {
    const c = document.querySelector('#preview .pv-slide.is-own canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const colors = new Set();
    for (let i = 0; i < d.length; i += 4 * 97) colors.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    const r = c.getBoundingClientRect();
    return { colors: colors.size, w: r.width, scale: c.width / 328, visible: getComputedStyle(c).opacity };
  });
  check(slot.colors > 30 && slot.visible === '1', `the banner is drawn in the phone's slot (${slot.colors} colours)`);
  check(Math.abs(slot.w / (await bb(() => document.querySelector('.pv-phone').getBoundingClientRect().width / 380)) - 328) < 1, 'the slot is 328 px of the 360 px screen');
  await page.click('#preview .pv-dock .seg [data-value="uz"]');
  await wait(500);
  check((await page.textContent('#preview .pv-bal-label')) === 'Umumiy balans', 'UZ switches the app screen too');
  await ruKey('д', 'KeyL');
  await wait(900);
  check((await page.locator('#preview .pv-device').count()) === 3, 'L shows a phone per language');
  await ruKey('д', 'KeyL');
  await wait(400);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__bb.editor.mode === 'editor');
  check(await bb(() => window.__bb.editor.lang === 'uz'), 'back in the editor on the language looked at last');

  /* ---------- layout switch ---------- */
  await ruKey('с', 'Digit1');
  await page.click('#inspector .cell.wide');
  await page.waitForSelector('.layout-pop.is-open');
  await page.click('.layout-pop .layout-card[aria-label="Переводы 0%"]');
  await wait(300);
  check(await bb(() => window.__bb.editor.doc.template === 'zero'), 'layout switches to «Переводы 0%»');
  check(await bb(() => window.__bb.editor.doc.copy.title.ru.startsWith('До 100 миллионов')), 'the banner keeps its own title');

  /* ---------- autosave ---------- */
  await bb(() => window.__bb.flushSave());
  const id = await bb(() => window.__bb.editor.doc.id);
  await page.reload();
  await page.waitForFunction(() => window.__bb?.ready, null, { timeout: 30000 });
  await page.waitForFunction((id) => window.__bb.editor.doc?.id === id, id, { timeout: 10000 });
  check(await bb(() => window.__bb.editor.doc.template === 'zero'), 'a reload reopens the saved banner');
  await page.click('#home-btn');
  await page.waitForSelector('#projects .proj-card');
  check((await page.locator('#projects .proj-card').count()) === 1, '«Мои баннеры» lists it');

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} catch (e) {
  console.error(e);
  check(false, `run finished: ${e.message}`);
} finally {
  await browser.close();
  await server.close();
}
process.exit(ck.failed ? 1 : 0);
