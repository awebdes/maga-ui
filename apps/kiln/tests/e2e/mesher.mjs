// Phase 0 mesher check: six hard SVGs through rasterize → field → surface nets, in the browser worker.
// Usage: node tests/e2e/mesher.mjs [outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { startServer, launch } from './browser.mjs';

const out = process.argv[2] ?? 'tests/e2e/out';
mkdirSync(out, { recursive: true });
const { server, url } = await startServer(4318);
const { browser, page, errors } = await launch();
let failed = false;
try {
  await page.goto(`${url}/spike.html`);
  await page.waitForFunction(() => window.__spike?.ready === true, null, { timeout: 120000 });
  const rows = await page.evaluate(() => window.__spike.runMesherSuite());
  console.table(rows.map(({ name, mode, resolution, fieldMs, meshMs, simplifyMs, rawTriangles, triangles, closed }) => ({ name, mode, resolution, fieldMs, meshMs, simplifyMs, rawTriangles, triangles, closed })));
  writeFileSync(`${out}/mesher-rows.json`, JSON.stringify(rows, null, 2));
  for (const r of rows) if (!r.closed) failed = true;
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/mesher-suite.png` });
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  if (errors.length) console.log(errors.slice(0, 5).join('\n'));
  await browser.close();
  await server.close();
}
console.log(failed ? 'MESHER CHECK FAILED' : 'MESHER CHECK PASSED');
process.exit(failed ? 1 : 0);
