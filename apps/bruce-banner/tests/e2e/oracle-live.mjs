#!/usr/bin/env node
// One-off check that the vendored legacy engine (the parity oracle) renders what the live legacy
// app exported: for each template, export a 2K PNG (RU) from bruce-banner.vercel.app and diff it
// against the oracle at the same size. Exports are not kept. Needs the live site and the proxy:
//   node tests/e2e/oracle-live.mjs [--origin https://bruce-banner.vercel.app]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer, checker } from './browser.mjs';

const arg = process.argv.indexOf('--origin');
const ORIGIN = arg > 0 ? process.argv[arg + 1] : 'https://bruce-banner.vercel.app';
const MAX_SHARE = 0.003;
const root = fileURLToPath(new URL('../../', import.meta.url));

const { server, url } = await startServer(4332);
// the live site goes through the session proxy, the local Vite page must not
const browser = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
const localBrowser = await chromium.launch();
const ck = checker();
try {
  const live = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true })).newPage();
  const local = await (await localBrowser.newContext({ viewport: { width: 800, height: 600 } })).newPage();
  await local.goto(`${url}/parity.html`);
  await local.waitForFunction(() => window.__parity?.ready, null, { timeout: 60000 });
  const templates = await local.evaluate(async () => (await import('/src/engine/index.ts')).TEMPLATES.map((t) => ({ id: t.id, label: t.label })));

  await live.goto(ORIGIN, { waitUntil: 'networkidle', timeout: 90000 });
  await live.getByRole('button', { name: /Export PNG/ }).waitFor({ timeout: 60000 });
  await live.waitForTimeout(1500);
  // 2K: long edge 2048
  await live.getByText('4K', { exact: true }).first().click();
  await live.locator('[role="option"]', { hasText: '2K' }).first().click();
  let current = 'Blank banner';
  for (const t of templates) {
    await live.getByText(current, { exact: true }).first().click();
    await live.locator('[role="option"]', { hasText: t.label }).first().click();
    current = t.label;
    await live.waitForTimeout(900);
    const [dl] = await Promise.all([live.waitForEvent('download', { timeout: 60000 }), live.getByRole('button', { name: /Export PNG/ }).click()]);
    const png = await readFile(await dl.path());
    if (process.argv.includes('--keep')) {
      await mkdir(`${root}tests/e2e/out/live`, { recursive: true });
      await writeFile(`${root}tests/e2e/out/live/${t.id}.png`, png);
    }
    const r = await local.evaluate(
      async ([id, b64, mode]) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const a = document.createElement('canvas');
        a.width = w;
        a.height = h;
        a.getContext('2d').drawImage(img, 0, 0);
        const o = new Image();
        o.src = window.__parity.legacyExport(id, 'ru', w, h, mode === 'export');
        await o.decode();
        const b = document.createElement('canvas');
        b.width = w;
        b.height = h;
        b.getContext('2d').drawImage(o, 0, 0);
        const pa = a.getContext('2d').getImageData(0, 0, w, h).data;
        const pb = b.getContext('2d').getImageData(0, 0, w, h).data;
        let bad = 0;
        for (let i = 0; i < pa.length; i += 4) {
          const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
          if (d > 16) bad++;
        }
        return { w, h, share: bad / (w * h) };
      },
      [t.id, png.toString('base64'), 'export'],
    );
    // the export path of the legacy app (pre-scaled context) is what the oracle must reproduce
    ck.check(r.share <= MAX_SHARE, `${t.id.padEnd(13)} live ${r.w}×${r.h} vs oracle (export path): ${(r.share * 100).toFixed(3)}% pixels differ`);
  }
} catch (e) {
  console.error(e);
  ck.check(false, 'live export run');
} finally {
  await browser.close();
  await localBrowser.close();
  await server.close();
}
process.exit(ck.failed ? 1 : 0);
