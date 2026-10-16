#!/usr/bin/env node
// Pulls the brand files and the legacy banner engine out of the production build of the old
// Bruce Banner (Toolcraft) at bruce-banner.vercel.app:
//   src/brand/img/*.png|svg   illustrations, cards, logos (two logos are inline SVG in the bundle)
//   src/brand/fonts/*         Squad (licensed, Fontfabric) and the Source Sans 3 subsets it shipped
//   tests/legacy/engine.js    the banner engine slice (templates, copy, Canvas 2D renderer) as an
//                             ES module: the parity oracle for src/engine. Toolcraft's runtime is
//                             not copied.
// Both folders are gitignored while the repo is public. Run through the session proxy:
//   NODE_USE_ENV_PROXY=1 node scripts/vendor-legacy.mjs [--origin https://bruce-banner.vercel.app]
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const argOrigin = process.argv.indexOf('--origin');
const ORIGIN = (argOrigin > 0 ? process.argv[argOrigin + 1] : 'https://bruce-banner.vercel.app').replace(/\/$/, '');

// the deploy build runs this too: a dropped connection retries instead of failing the build
async function get(path, as = 'text', attempt = 1) {
  const url = path.startsWith('http') ? path : ORIGIN + path;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    return as === 'bytes' ? new Uint8Array(await res.arrayBuffer()) : await res.text();
  } catch (e) {
    if (attempt >= 4) throw e;
    await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    return get(path, as, attempt + 1);
  }
}

/** `money-loan-xU2yxWFH.png` → `money-loan.png`; Vite hashes are 8 base64url chars. */
export function cleanName(file) {
  const m = /^(.+)-([A-Za-z0-9_-]{8})\.(\w+)$/.exec(file);
  return m ? `${m[1]}.${m[3]}` : file;
}

async function main() {
  console.log(`origin ${ORIGIN}`);
  const html = await get('/');
  const entry = /<script[^>]+src="(\/assets\/index-[^"]+\.js)"/.exec(html)?.[1];
  if (!entry) throw new Error('entry script not found in index.html');
  const entryJs = await get(entry);
  const bootName = /app-bootstrap-[A-Za-z0-9_-]+\.js/.exec(entryJs)?.[0];
  if (!bootName) throw new Error('app-bootstrap chunk not found in the entry script');
  const boot = await get(`/assets/${bootName}`);
  console.log(`bundle ${bootName} ${(boot.length / 1024).toFixed(0)} KB`);

  // the banner slice: from the first asset constant to the CSS-module object of the canvas component
  const firstAsset = boot.indexOf('/assets/card-humo-a-');
  const start = boot.lastIndexOf('var ', firstAsset);
  const cssModule = boot.indexOf('={canvas:`_canvas_');
  const end = boot.lastIndexOf('var ', cssModule);
  if (firstAsset < 0 || start < 0 || cssModule < 0 || end <= start) throw new Error('banner slice markers not found');
  let slice = boot.slice(start, end);

  // assets referenced by the slice
  const files = [...new Set(slice.match(/\/assets\/[A-Za-z0-9_.-]+\.(?:png|ttf|woff2)/g) ?? [])];
  const manifest = { origin: ORIGIN, bundle: bootName, fetchedAt: new Date().toISOString(), files: {} };
  await mkdir(join(root, 'src/brand/img'), { recursive: true });
  await mkdir(join(root, 'src/brand/fonts'), { recursive: true });
  for (const path of files) {
    const file = path.slice('/assets/'.length);
    const clean = cleanName(file);
    const dir = /\.(ttf|woff2)$/.test(file) ? 'fonts' : 'img';
    const bytes = await get(path, 'bytes');
    await writeFile(join(root, 'src/brand', dir, clean), bytes);
    manifest.files[`${dir}/${clean}`] = { from: path, bytes: bytes.length };
    slice = slice.split(path).join(`/src/brand/${dir}/${clean}`);
    console.log(`  ${dir}/${clean} ${(bytes.length / 1024).toFixed(0)} KB`);
  }

  // the two logos the bundle inlines as data URIs
  for (const id of ['logo-mastercard', 'logo-visa']) {
    const v = new RegExp(`"${id}":([A-Za-z_$][\\w$]*)`).exec(slice)?.[1];
    const uri = v && new RegExp(`[,\\s]${v.replace('$', '\\$')}=\`(data:image/svg\\+xml,[^\`]+)\``).exec(slice)?.[1];
    if (!uri) throw new Error(`${id} not found`);
    const svg = decodeURIComponent(uri.slice('data:image/svg+xml,'.length));
    await writeFile(join(root, 'src/brand/img', `${id}.svg`), svg);
    manifest.files[`img/${id}.svg`] = { from: `inline ${v}`, bytes: svg.length };
    console.log(`  img/${id}.svg (inline ${v})`);
  }
  await writeFile(join(root, 'src/brand/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  // style references for the image model (GEMINI_STYLE_REFS=1), read by server/handlers.ts
  await mkdir(join(root, 'server/refs'), { recursive: true });
  for (const f of ['money-loan.png', 'deposit-time.png', 'mortgage.png']) await copyFile(join(root, 'src/brand/img', f), join(root, 'server/refs', f));
  console.log('  server/refs: 3 style references');

  // the oracle module: the slice plus named exports
  const names = ['J5', 'qDe', 'z5', 'fOe', 'Y5', 'YDe', '$De', 'g7', 'h7', 'v7', '_Oe', 'a7', 'c7', 'f7', 'd7'];
  for (const n of names) {
    if (!new RegExp(`(?:var |function |[,\\s])${n.replace('$', '\\$')}(?:=|\\()`).test(slice)) throw new Error(`legacy symbol ${n} missing`);
  }
  await mkdir(join(root, 'tests/legacy'), { recursive: true });
  const header = `// Generated by scripts/vendor-legacy.mjs from ${ORIGIN}/assets/${bootName} on ${manifest.fetchedAt}.\n// The legacy Bruce Banner engine (Toolcraft build), kept verbatim as the parity oracle. Do not edit.\n/* eslint-disable */\n`;
  await writeFile(join(root, 'tests/legacy/engine.js'), `${header}${slice}\nexport { ${names.join(', ')} };\n`);
  console.log(`tests/legacy/engine.js ${(slice.length / 1024).toFixed(0)} KB, exports ${names.join(' ')}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
