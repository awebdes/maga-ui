// Phase 0 spike check: path-traced still with transparent background, PNG8/PNG16 export.
// Usage: node tests/e2e/spike.mjs [outDir] [size] [spp]
import { mkdirSync, writeFileSync } from 'node:fs';
import { decode } from 'fast-png';
import { startServer, launch } from './browser.mjs';

const out = process.argv[2] ?? 'tests/e2e/out';
const size = Number(process.argv[3] ?? 128);
const spp = Number(process.argv[4] ?? 16);
const sceneName = process.argv[5] ?? 'safe';
mkdirSync(out, { recursive: true });

const { server, url } = await startServer();
const { browser, page, errors } = await launch();
page.on('console', (m) => {
  if (m.type() === 'log' && /\[tracer\]|\[compat\]|render |backend|mesher/.test(m.text())) console.log('  page:', m.text());
});
let failed = false;
try {
  await page.goto(`${url}/spike.html`);
  await page.waitForFunction(() => window.__spike?.ready === true, null, { timeout: 120000 });
  const webgpu = await page.evaluate(() => window.__spike.webgpu);
  console.log('webgpu backend:', webgpu);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/spike-page.png` });
  if (webgpu && sceneName === 'suite') {
    await page.evaluate(() => window.__spike.runMesherSuite());
    await page.waitForTimeout(500);
  }
  if (webgpu) {
    const stats = await page.evaluate(([s, n]) => window.__spike.renderStill(s, s, n, false, true), [size, spp]);
    console.log('stats:', JSON.stringify(stats));
    for (const depth of [8, 16]) {
      const bytes = await page.evaluate((d) => window.__spike.png(d), depth);
      const buf = Buffer.from(bytes);
      writeFileSync(`${out}/still-${sceneName}-${size}-${depth}bit.png`, buf);
      const img = decode(buf);
      const cornerA = img.data[3];
      const maxA = depth === 16 ? 65535 : 255;
      console.log(`png${depth}: ${img.width}×${img.height} depth=${img.depth} channels=${img.channels} cornerAlpha=${cornerA}/${maxA}`);
      if (img.width !== size || img.depth !== depth || img.channels !== 4 || cornerA !== 0) failed = true;
    }
    if (stats.nan > 0 || !stats.bounds) failed = true;
    await page.screenshot({ path: `${out}/spike-after.png` });
  } else {
    failed = true;
  }
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  if (errors.length) console.log(errors.join('\n'));
  await browser.close();
  await server.close();
}
console.log(failed ? 'SPIKE CHECK FAILED' : 'SPIKE CHECK PASSED');
process.exit(failed ? 1 : 0);
