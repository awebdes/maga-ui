// App check: the Kiln shell loads on the kit, edits go through the UI, export downloads a PNG.
// Usage: node tests/e2e/app.mjs [outDir]
import { mkdirSync, readFileSync } from 'node:fs';
import { decode } from 'fast-png';
import { startServer, launch } from './browser.mjs';

const out = process.argv[2] ?? 'tests/e2e/out/app';
// --quick: skip the shape edits, go straight to export
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
const status = () => page.evaluate(() => window.__kiln.status());
async function waitFor(fn, timeout, label) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timeout: ${label}`);
    await page.waitForTimeout(500);
  }
}

try {
  const t0 = Date.now();
  await page.goto(`${url}/index.html`);
  await page.waitForFunction(() => window.__kiln?.ready === true, null, { timeout: 180000 });
  console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)} s, webgpu=${await page.evaluate(() => window.__kiln.webgpu)}`);
  for (const id of ['#brand-btn', '#export-btn', '#glyph-btn', '#dock', '#mat-btn', '#orb', '#cam-seg', '#status']) {
    check(await page.locator(id).isVisible(), `island ${id} visible`);
  }
  // SwiftShader traces on the CPU: a smaller viewport trace keeps frames short enough to screenshot
  await page.evaluate(() => window.__kiln.setTraceScale(0.3));
  await page.mouse.move(720, 450);
  // idle tracing kicks in after 300 ms
  const traced = await waitFor(async () => {
    const s = await status();
    return s.state === 'tracing' && s.spp >= 2 ? s : null;
  }, 240000, 'viewport tracing');
  check(Boolean(traced), `viewport traces when idle (${traced.spp} spp)`);
  await waitFor(async () => (await status()).spp >= 8, 240000, '8 spp');
  await page.evaluate(() => window.__kiln.pauseTrace(true));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/app-safe.png` });
  await page.evaluate(() => window.__kiln.pauseTrace(false));

  if (!quick) {
  // pick a glyph through the shape library
  await page.evaluate(() => window.__kiln.pauseTrace(true));
  await page.click('#glyph-btn');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/app-shapes.png` });
  await page.evaluate(() => window.__kiln.pauseTrace(false));
  await page.locator('.glyph-cell[aria-label="credit card"]').click();
  await waitFor(async () => (await status()).final, 120000, 'final mesh for credit card');
  check((await page.evaluate(() => window.__kiln.state.shape.scene)) === 'glyph', 'glyph replaces the safe');
  // form: inflate
  await page.keyboard.press('Escape');
  await page.click('#form-seg button[data-value="inflate"]');
  await waitFor(async () => (await status()).final, 120000, 'final mesh after inflate');
  check((await page.evaluate(() => window.__kiln.state.shape.form)) === 'inflate', 'form switched to inflate');
  await page.mouse.move(720, 450);
  await waitFor(async () => (await status()).spp >= 6, 240000, 'glyph traced');
  await page.evaluate(() => window.__kiln.pauseTrace(true));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/app-glyph.png` });

  // the two glyph-based examples
  await page.evaluate(() => window.__kiln.pauseTrace(false));
  for (const ex of ['house', 'pin']) {
    await page.click('#brand-btn');
    await page.click(`#brand-menu [data-example="${ex}"]`);
    await page.waitForTimeout(1000);
    await waitFor(async () => (await status()).final, 180000, `final mesh for ${ex}`);
    await page.mouse.move(720, 450);
    await waitFor(async () => (await status()).spp >= 6, 240000, `${ex} traced`);
    await page.evaluate(() => window.__kiln.pauseTrace(true));
    await page.mouse.move(700, 440);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}/app-${ex}.png` });
    await page.evaluate(() => window.__kiln.pauseTrace(false));
    check((await page.evaluate(() => window.__kiln.state.shape.scene)) === ex, `example ${ex} opens`);
  }
  await page.evaluate(() => window.__kiln.pauseTrace(true));

  // materials panel (tracer still paused: the panel animates over a still frame)
  await page.click('#mat-btn');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/app-materials.png` });
  await page.click('#mat-btn');
  }

  // export 128² draft through the sheet and catch the download
  await page.evaluate(() => window.__kiln.exporter.setSizeOverride(128));
  await page.click('#export-btn');
  await page.click('#exp-quality button[data-value="64"]');
  await page.click('#exp-render');
  await page.locator('#exp-download').waitFor({ state: 'visible', timeout: 600000 });
  await page.evaluate(() => window.__kiln.pauseTrace(true));
  await page.mouse.move(1300, 300);
  await page.screenshot({ path: `${out}/app-export.png` });
  const href = await page.locator('#exp-download').getAttribute('href');
  console.log('download link:', href?.slice(0, 40), await page.locator('#exp-download').getAttribute('download'));
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.locator('#exp-download').click()]);
  const file = `${out}/${download.suggestedFilename()}`;
  await download.saveAs(file);
  const png = decode(readFileSync(file));
  check(png.width === 128 && png.height === 128, `download is 128×128 (${download.suggestedFilename()})`);
  check(png.channels === 4 && png.data[3] === 0, 'transparent corners');
  let opaque = 0;
  for (let i = 3; i < png.data.length; i += 4) if (png.data[i] > 250) opaque++;
  const total = png.width * png.height;
  check(opaque > total * 0.1, `object fills the frame (${((opaque / total) * 100).toFixed(0)}% opaque)`);
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
