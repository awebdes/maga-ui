// App check: the Kiln editor loads on the kit; objects are picked, dragged, scaled, grouped,
// restyled and undone one by one; moves refit the path tracer instead of rebuilding it; export
// still downloads a PNG.
// Usage: node tests/e2e/app.mjs [outDir] [--quick]
import { mkdirSync, readFileSync } from 'node:fs';
import { decode } from 'fast-png';
import { startServer, launch } from './browser.mjs';

const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'tests/e2e/out/app';
// --quick: skip the editing walk-through, go straight to export
const quick = process.argv.includes('--quick');
mkdirSync(out, { recursive: true });
const { server, url } = await startServer(4320, { hmr: false });
const { browser, page, errors } = await launch({ width: 1440, height: 900 });
page.on('console', (m) => {
  if (m.type() === 'warning' || m.type() === 'error') console.log(`  page ${m.type()}:`, m.text().slice(0, 300));
});
let failed = false;
const check = (ok, msg) => {
  console.log(`${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failed = true;
};
const K = (fn, arg) => page.evaluate(fn, arg);
const status = () => K(() => window.__kiln.status());
const doc = () => K(() => window.__kiln.doc());
const selection = () => K(() => window.__kiln.editor.selection);
const rectOf = (id) => K((x) => window.__kiln.objectScreenRect(x), id);
const pause = (p) => K((x) => window.__kiln.pauseTrace(x), p);
async function waitFor(fn, timeout, label) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timeout: ${label}`);
    await page.waitForTimeout(400);
  }
}
async function drag(x0, y0, dx, dy, steps = 10, mid) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + (dx * i) / steps, y0 + (dy * i) / steps);
    await page.waitForTimeout(25);
    if (i === Math.round(steps / 2) && mid) await mid();
  }
  await page.mouse.up();
}
const byName = (d, name) => d.objects.find((o) => o.name === name);

try {
  const t0 = Date.now();
  await page.goto(`${url}/index.html`);
  await page.waitForFunction(() => window.__kiln?.ready === true, null, { timeout: 180000 });
  console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)} s, webgpu=${await K(() => window.__kiln.webgpu)}`);
  for (const id of ['#brand-btn', '#export-btn', '#layers', '#dock', '#mat-btn', '#orb', '#cam-seg', '#status']) {
    check(await page.locator(id).isVisible(), `island ${id} visible`);
  }
  let d = await doc();
  check(d.objects.length === 4 && d.groups.length === 1, `Safe opens as 4 objects in 1 group (${d.objects.map((o) => o.name).join(', ')})`);
  check((await page.locator('.layer').count()) === 5, 'objects island lists 4 objects and the group');

  // SwiftShader traces on the CPU: a smaller viewport trace keeps frames short enough to screenshot
  await K(() => window.__kiln.setTraceScale(0.3));
  await page.mouse.move(720, 450);
  const traced = await waitFor(async () => {
    const s = await status();
    return s.state === 'tracing' && s.spp >= 2 ? s : null;
  }, 240000, 'viewport tracing');
  check(Boolean(traced), `viewport traces when idle (${traced.spp} spp)`);
  await waitFor(async () => (await status()).spp >= 8, 240000, '8 spp');
  // docs screenshot: the raster preview (a 0.3-scale SwiftShader trace reads as noise), no hover
  await pause(true);
  await page.mouse.move(1150, 640);
  await K(() => window.__kiln.setTraceScale(0.3));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/app-safe.png` });

  if (!quick) {
    // ---- pick the % in the viewport and drag it ----
    const pct = byName(d, '%');
    const r = await rectOf(pct.id);
    await page.mouse.click(r.x + r.w * 0.2, r.y + r.h * 0.25);
    check(JSON.stringify(await selection()) === JSON.stringify([pct.id]), 'click in the viewport selects the %');
    check(await page.locator('#selbar').isVisible(), 'selection bar shows');
    const cam0 = await K(() => window.__kiln.camera());
    let camMid = null;
    const stats0 = await K(() => window.__kiln.tracerStats());
    await drag(r.x + r.w * 0.2, r.y + r.h * 0.25, -140, 70, 12, async () => {
      camMid = await K(() => window.__kiln.camera());
      await page.screenshot({ path: `${out}/app-drag.png` });
    });
    check(camMid?.frozen && JSON.stringify(camMid.position) === JSON.stringify(cam0.position), 'camera holds still during the drag');
    d = await doc();
    const moved = byName(d, '%').t;
    check(moved.x < pct.t.x - 0.1 && moved.y < pct.t.y - 0.03, `drag moves the % (x ${pct.t.x} → ${moved.x.toFixed(3)}, y ${pct.t.y} → ${moved.y.toFixed(3)})`);
    // the next trace refits transforms, no BVH rebuild
    await pause(false);
    await page.mouse.move(720, 120);
    await waitFor(async () => (await status()).spp >= 2, 240000, 'trace after the move');
    const stats1 = await K(() => window.__kiln.tracerStats());
    check(stats1.setScene === stats0.setScene && stats1.updateTransforms > stats0.updateTransforms, `move refits the tracer (setScene ${stats0.setScene}→${stats1.setScene}, updateTransforms ${stats0.updateTransforms}→${stats1.updateTransforms})`);
    await pause(true);

    // ---- scale from a corner ----
    const h = await page.locator('.ov-hit-se').boundingBox();
    await drag(h.x + h.width / 2, h.y + h.height / 2, 40, 40, 8);
    d = await doc();
    const scaled = byName(d, '%').t.scale;
    check(scaled > 1.1, `corner handle scales the % (${scaled.toFixed(2)}×)`);
    await page.screenshot({ path: `${out}/app-select.png` });

    // ---- undo both, one step each ----
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    d = await doc();
    check(byName(d, '%').t.x === pct.t.x && byName(d, '%').t.scale === 1, 'two undos restore the % position and size');

    // ---- add a coin ----
    await page.click('#add-btn');
    await page.click('#add-menu [data-add="coin"]');
    d = await doc();
    const added = d.objects[d.objects.length - 1];
    check(d.objects.length === 5 && added.kind === 'coin', 'Add → Coin adds one object');
    check(JSON.stringify(await selection()) === JSON.stringify([added.id]), 'the new coin is selected');

    // ---- shift-click the safe in the list, group, ungroup ----
    const safe = byName(d, 'Safe');
    await page.click(`.layer[data-id="${safe.id}"]`, { modifiers: ['Shift'] });
    check((await selection()).length === 2, 'shift-click in the list adds to the selection');
    await page.keyboard.press('Control+g');
    d = await doc();
    check(d.groups.length === 2 && byName(d, 'Safe').group === (await selection())[0], '⌘G groups the coin with the safe');
    await page.keyboard.press('Control+Shift+g');
    d = await doc();
    check(d.groups.length === 1 && !byName(d, 'Safe').group, '⇧⌘G ungroups');

    // ---- one object's material ----
    await page.click(`.layer[data-id="${added.id}"]`);
    await page.click('#mat-btn');
    await page.waitForTimeout(400);
    await page.click('.swatch[data-id="sky-clay"]');
    d = await doc();
    const others = d.objects.filter((o) => o.id !== added.id).map((o) => Object.values(o.materials)[0].id);
    check(d.objects.find((o) => o.id === added.id).materials.main.id === 'sky-clay' && !others.includes('sky-clay'), 'a swatch restyles only the selected object');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/app-materials.png` });
    await page.click('#mat-btn');

    // ---- hide it from the list ----
    await page.hover(`.layer[data-id="${added.id}"]`);
    await page.click(`.layer[data-id="${added.id}"] .layer-eye`);
    d = await doc();
    check(d.objects.find((o) => o.id === added.id).hidden === true, 'the eye hides an object');

    // ---- House: an icon object, its form, then a new icon from the library ----
    await page.click('#brand-btn');
    await page.click('#brand-menu [data-example="house"]');
    await waitFor(async () => (await status()).final, 180000, 'final mesh for house');
    d = await doc();
    const house = byName(d, 'House');
    const hr = await rectOf(house.id);
    await page.mouse.click(hr.x + hr.w * 0.45, hr.y + hr.h * 0.7);
    check(JSON.stringify(await selection()) === JSON.stringify([house.id]), 'click selects the house icon');
    await page.click('#form-seg button[data-value="inflate"]');
    await waitFor(async () => (await status()).final, 180000, 'final mesh after inflate');
    d = await doc();
    check(byName(d, 'House').form.mode === 'inflate' && byName(d, 'Person').form.mode === 'soft', 'Inflate changes the house only');
    await page.keyboard.press('Escape');
    await page.keyboard.press('a');
    await page.click('#add-menu [data-add="icon"]');
    await page.locator('.glyph-cell[data-name="credit-card"]').click();
    await waitFor(async () => (await status()).final, 180000, 'final mesh for the new icon');
    d = await doc();
    check(d.objects.length === 5 && d.objects[4].glyph?.ref === 'phosphor:credit-card', 'the library adds a credit card icon');
    await pause(false);
    await page.mouse.move(720, 120);
    await waitFor(async () => (await status()).spp >= 6, 240000, 'house traced');
    await pause(true);
    await page.mouse.move(1150, 640);
    await K(() => window.__kiln.setTraceScale(0.3));
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}/app-house.png` });
  }

  // ---- export 128² draft through the sheet and catch the download ----
  await K(() => window.__kiln.exporter.setSizeOverride(128));
  await page.click('#export-btn');
  await page.click('#exp-quality button[data-value="64"]');
  await page.click('#exp-render');
  await page.locator('#exp-download').waitFor({ state: 'visible', timeout: 600000 });
  await pause(true);
  await page.mouse.move(1300, 300);
  await page.screenshot({ path: `${out}/app-export.png` });
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.locator('#exp-download').click()]);
  const file = `${out}/${download.suggestedFilename()}`;
  await download.saveAs(file);
  const png = decode(readFileSync(file));
  check(png.width === 128 && png.height === 128, `download is 128×128 (${download.suggestedFilename()})`);
  check(png.channels === 4 && png.data[3] === 0, 'transparent corners');
  let opaque = 0;
  for (let i = 3; i < png.data.length; i += 4) if (png.data[i] > 250) opaque++;
  const total = png.width * png.height;
  check(opaque > total * 0.1, `objects fill the frame (${((opaque / total) * 100).toFixed(0)}% opaque)`);
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  if (errors.length) console.log(errors.join('\n'));
  if (errors.some((e) => !/favicon/.test(e))) failed = true;
  await browser.close();
  await server.close();
}
console.log(failed ? 'APP CHECK FAILED' : 'APP CHECK PASSED');
process.exit(failed ? 1 : 0);
