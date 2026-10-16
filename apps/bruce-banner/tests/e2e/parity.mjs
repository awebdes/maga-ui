#!/usr/bin/env node
// Parity gate: src/engine in compat mode against the legacy engine (tests/legacy/engine.js) for
// 15 templates × RU/UZ/EN × ×1/×2/×3, same fonts, same images, same canvas size. Writes a
// «было | стало» sheet (legacy vs fixed mode) to tests/e2e/out/parity-sheet.png.
// Needs `npm run vendor` first (brand files and the legacy engine are not in git).
import { mkdir, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startServer, launch, checker } from './browser.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = `${root}tests/e2e/out`;

// a box may differ in at most this share of its pixels (|Δ| > 16 in any channel)
const MAX_BOX_SHARE = 0.002;
// and no differing blob may be larger than this share of the banner
const MAX_BLOB_SHARE = 0.0004;

try {
  await access(`${root}tests/legacy/engine.js`);
} catch {
  console.error('tests/legacy/engine.js is missing: run `npm run vendor` first');
  process.exit(2);
}

const { server, url } = await startServer(4331);
const { browser, page, errors } = await launch();
const ck = checker();
const { check } = ck;
let failures = 0;
try {
  await page.goto(`${url}/parity.html`);
  await page.waitForFunction(() => window.__parity && (window.__parity.ready || window.__parity.error), null, { timeout: 60000 });
  const state = await page.evaluate(() => ({ ready: window.__parity.ready, error: window.__parity.error, missing: window.__parity.fonts?.missing ?? [] }));
  check(state.ready, `parity page ready${state.error ? `: ${state.error}` : ''}`);
  check(state.missing.length === 0, `brand fonts loaded${state.missing.length ? ` (missing ${state.missing.join(', ')})` : ''}`);

  const rows = await page.evaluate(() => window.__parity.run());
  const bad = rows.filter((r) => r.maxBox > MAX_BOX_SHARE || r.blobShare > MAX_BLOB_SHARE);
  const worst = [...rows].sort((a, b) => b.maxBox - a.maxBox).slice(0, 5);
  console.log(`\n${rows.length} renders compared; worst boxes:`);
  for (const r of worst) console.log(`  ${r.id.padEnd(13)} ${r.lang} ×${r.n}  box ${(r.maxBox * 100).toFixed(3)}%  blob ${r.blob}px  total ${(r.total * 100).toFixed(4)}%`);
  check(bad.length === 0, `compat render matches the legacy engine (${rows.length - bad.length}/${rows.length} within ${MAX_BOX_SHARE * 100}% per box, blob ≤ ${MAX_BLOB_SHARE * 100}%)`);
  for (const r of bad.slice(0, 12)) console.log(`    ✗ ${r.id} ${r.lang} ×${r.n}: box ${(r.maxBox * 100).toFixed(3)}% blob ${r.blob}px ${JSON.stringify(r.boxes)}`);

  await mkdir(out, { recursive: true });
  const sheet = await page.evaluate(() => window.__parity.sheet(2));
  await writeFile(`${out}/parity-sheet.png`, Buffer.from(sheet.split(',')[1], 'base64'));
  console.log(`sheet → tests/e2e/out/parity-sheet.png`);
  if (process.argv.includes('--pairs')) {
    for (const r of bad.slice(0, 4)) {
      const p = await page.evaluate(([id, lang, n]) => window.__parity.pair(id, lang, n), [r.id, r.lang, r.n]);
      for (const k of ['legacy', 'ours', 'fixed']) await writeFile(`${out}/pair-${r.id}-${r.lang}-x${r.n}-${k}.png`, Buffer.from(p[k].split(',')[1], 'base64'));
    }
  }
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  await server.close();
}
process.exit(ck.failed + failures ? 1 : 0);
