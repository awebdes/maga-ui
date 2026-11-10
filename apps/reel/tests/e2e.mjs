// End-to-end: direct manipulation, auto-keys, timeline, text, undo, export.
// Needs the dev server: npx vite --port 5180. Run: node tests/e2e.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const URL = process.env.URL || 'http://localhost:5180/';
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()));
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const step = async (name, fn) => {
  await fn();
  console.log('✓', name);
};
const state = () => p.evaluate(() => JSON.parse(JSON.stringify(window.reel.ed.doc)));
const frameBox = async () => p.locator('#view').boundingBox();

await step('blank template loads', async () => {
  await p.click('.brand');
  await p.click('[data-template="blank"]');
  await p.waitForTimeout(400);
  const s = await state();
  assert.equal(s.devices.length, 1);
  assert.equal(s.devices[0].keys.length, 0);
});

const centre = async () => {
  const fb = await frameBox();
  return { x: fb.x + fb.width / 2, y: fb.y + fb.height / 2 };
};

await step('drag on device turns it (base, no keys)', async () => {
  const c = await centre();
  await p.mouse.move(c.x, c.y);
  await p.mouse.down();
  await p.mouse.move(c.x + 40, c.y + 10, { steps: 6 });
  await p.mouse.move(c.x + 80, c.y + 20, { steps: 6 });
  await p.mouse.up();
  const s = await state();
  assert.ok(s.devices[0].base.rot[1] > 20, 'turned: ' + s.devices[0].base.rot[1]);
  assert.ok(s.devices[0].base.rot[0] > 3, 'tilted: ' + s.devices[0].base.rot[0]);
  assert.equal(s.devices[0].keys.length, 0);
});

await step('K keys at 0, edit at 2 s writes a second key by itself', async () => {
  await p.keyboard.press('k');
  let s = await state();
  assert.equal(s.devices[0].keys.length, 1);
  await p.evaluate(() => window.reel.ed.setTime(2));
  await p.waitForTimeout(200);
  const c = await centre();
  await p.mouse.move(c.x, c.y);
  await p.mouse.down();
  await p.mouse.move(c.x - 60, c.y, { steps: 8 });
  await p.mouse.up();
  s = await state();
  assert.equal(s.devices[0].keys.length, 2);
  assert.equal(s.devices[0].keys[1].t, 2);
  assert.ok(s.devices[0].keys[1].s.rot[1] < s.devices[0].keys[0].s.rot[1] - 10);
});

await step('Space drag moves the device', async () => {
  const before = (await state()).devices[0].keys[1].s.pos[0];
  const c = await centre();
  await p.mouse.move(c.x, c.y);
  await p.keyboard.down(' ');
  await p.mouse.down();
  await p.mouse.move(c.x + 60, c.y, { steps: 8 });
  await p.mouse.up();
  await p.keyboard.up(' ');
  const s = await state();
  assert.ok(s.devices[0].keys[1].s.pos[0] > before + 0.1, 'moved x');
  assert.equal(await p.evaluate(() => window.reel.ed.playing), false, 'space drag did not start playback');
});

await step('undo restores the previous pose, redo brings it back', async () => {
  const s0 = (await state()).devices[0].keys[1].s.pos[0];
  await p.keyboard.press('Control+z');
  const s1 = (await state()).devices[0].keys[1].s.pos[0];
  assert.ok(s1 < s0);
  await p.keyboard.press('Control+Shift+z');
  const s2 = (await state()).devices[0].keys[1].s.pos[0];
  assert.equal(s2, s0);
});

await step('timeline: drag the 2 s key to ~3 s, set ease', async () => {
  const key = p.locator('.tl-row[data-id] .tl-keyf').nth(1);
  const kb = await key.boundingBox();
  const tb = await p.locator('.tl-tracks').boundingBox();
  const perSec = (tb.width - 24) / 6;
  await p.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2);
  await p.mouse.down();
  await p.mouse.move(kb.x + kb.width / 2 + perSec, kb.y + kb.height / 2, { steps: 8 });
  await p.mouse.up();
  const s = await state();
  assert.ok(Math.abs(s.devices[0].keys[1].t - 3) < 0.06, 'key at ' + s.devices[0].keys[1].t);
  await p.click('.tl-ease [data-value="spring"]');
  assert.equal((await state()).devices[0].keys[1].ease, 'spring');
});

await step('motion preset writes editable keys', async () => {
  await p.click('.btn-grid >> text=Swing');
  const s = await state();
  assert.equal(s.devices[0].keys.length, 3);
});

await step('wheel dollies the camera', async () => {
  const d0 = (await state()).camera.base.dist;
  const fb = await frameBox();
  await p.mouse.move(fb.x + 20, fb.y + 20);
  await p.mouse.wheel(0, 300);
  await p.waitForTimeout(600);
  const d1 = (await state()).camera.base.dist;
  assert.ok(d1 > d0, `${d0} -> ${d1}`);
});

await step('T adds text; drag snaps it to the centre', async () => {
  await p.locator('#view').focus();
  await p.keyboard.press('t');
  await p.waitForTimeout(300);
  let s = await state();
  assert.equal(s.texts.length, 1);
  await p.evaluate(() => {
    const t = window.reel.ed.doc.texts[0];
    t.anim = 'none';
    t.x = 0.3;
    t.y = 0.2;
    window.reel.ed.emit('doc');
    window.reel.renderNow();
  });
  const box = await p.evaluate(() => window.reel.studio.textBoxes[0]);
  const fb = await frameBox();
  const sx = fb.x + (box.x + box.w / 2) * fb.width;
  const sy = fb.y + (box.y + box.h / 2) * fb.height;
  await p.mouse.move(sx, sy);
  await p.mouse.down();
  await p.mouse.move(fb.x + fb.width * 0.5 + 3, sy + 30, { steps: 10 });
  await p.mouse.up();
  s = await state();
  const nb = await p.evaluate(() => (window.reel.renderNow(), window.reel.studio.textBoxes[0]));
  assert.ok(Math.abs(nb.x + nb.w / 2 - 0.5) < 0.002, 'snapped to centre: ' + (nb.x + nb.w / 2));
  assert.ok(s.texts[0].y > 0.2);
});

await step('format switch keeps the scene', async () => {
  await p.click('#format-seg [data-value="square"]');
  const s = await state();
  assert.equal(s.format.w, 1080);
  assert.equal(s.format.h, 1080);
});

await step('export PNG', async () => {
  await p.keyboard.press('Escape');
  await p.click('#export-btn');
  await p.click('#exp-kind [data-value="png"]');
  await p.click('#exp-scale [data-value="0.5"]');
  const dl = p.waitForEvent('download', { timeout: 60000 });
  await p.click('#exp-render');
  const d = await dl;
  assert.match(d.suggestedFilename(), /\.png$/);
  const path = await d.path();
  const { statSync } = await import('node:fs');
  assert.ok(statSync(path).size > 20000);
});

await step('export video (½×, 30 fps, 1.5 s)', async () => {
  await p.evaluate(() => {
    window.reel.ed.doc.format.duration = 1.5;
    window.reel.ed.emit('doc');
  });
  const kind = 'mp4';
  await p.click(`#exp-kind [data-value="${kind}"]`);
  await p.click('#exp-fps [data-value="30"]');
  const dl = p.waitForEvent('download', { timeout: 240000 });
  await p.click('#exp-render');
  const d = await dl;
  const path = await d.path();
  const { statSync } = await import('node:fs');
  console.log('   ', d.suggestedFilename(), statSync(path).size, 'bytes');
  assert.ok(statSync(path).size > 10000);
  await d.saveAs(process.env.OUT_VIDEO || '/tmp/reel-test.' + kind);
});

assert.deepEqual(errors, []);
console.log('all good');
await b.close();
