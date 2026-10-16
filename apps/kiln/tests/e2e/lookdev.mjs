// Look-dev check: renders an example with the production studio and compares sample spots with
// the reference image (ΔE76 and CIEDE2000), then writes ours | reference side by side.
// Usage: node tests/e2e/lookdev.mjs --out dir --size 384 --spp 64 [--ref path/to/7.webp] [--white]
//        [--rig '{"keyAz":-50}'] [--materials '{"body":{...}}'] [--view '{"exposure":1.1}']
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { startServer, launch } from './browser.mjs';

const { values: args } = parseArgs({
  options: {
    out: { type: 'string', default: 'tests/e2e/out/lookdev' },
    size: { type: 'string', default: '384' },
    spp: { type: 'string', default: '64' },
    ref: { type: 'string' },
    white: { type: 'boolean', default: false },
    rig: { type: 'string' },
    materials: { type: 'string' },
    view: { type: 'string' },
    camera: { type: 'string' },
    port: { type: 'string', default: '4319' },
    tag: { type: 'string', default: '' },
    // JavaScript run in the page before rendering, with `L` = window.__lookdev (debugging aid)
    pre: { type: 'string' },
  },
});
const size = Number(args.size);
const spp = Number(args.spp);
mkdirSync(args.out, { recursive: true });

// --- color math (sRGB D65) ---
const eotf = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
function lab(rgb8) {
  const [r, g, b] = rgb8.map((v) => eotf(v / 255));
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const de76 = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
function de2000(c1, c2) {
  const [L1, a1, b1] = lab(c1), [L2, a2, b2] = lab(c2);
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h1p = ((Math.atan2(b1, a1p) / rad) + 360) % 360, h2p = ((Math.atan2(b2, a2p) / rad) + 360) % 360;
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dh = h2p - h1p;
  if (C1p * C2p === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh / 2) * rad);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) hbp = Math.abs(h1p - h2p) <= 180 ? (h1p + h2p) / 2 : h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2), Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

// no HMR: editing sources while a long render runs must not reload the page
const { server, url } = await startServer(Number(args.port), { hmr: false });
const { browser, page, errors } = await launch({ width: 800, height: 800 });
let failed = false;
try {
  await page.goto(`${url}/lookdev.html`);
  await page.waitForFunction(() => window.__lookdev?.ready === true, null, { timeout: 120000 });
  if (args.rig) await page.evaluate((r) => window.__lookdev.setRig(r), JSON.parse(args.rig));
  if (args.materials) await page.evaluate((m) => window.__lookdev.setMaterials(m), JSON.parse(args.materials));
  if (args.view) await page.evaluate((v) => window.__lookdev.setView(v), JSON.parse(args.view));
  if (args.camera) await page.evaluate((c) => window.__lookdev.setCamera(c), JSON.parse(args.camera));
  if (args.pre) console.log('pre:', await page.evaluate((code) => new Function('L', code)(window.__lookdev), args.pre));
  const t0 = Date.now();
  const res = await page.evaluate(([s, n, w]) => window.__lookdev.render(s, n, { white: w }), [size, spp, args.white]);
  console.log(`rendered ${size}² @${res.samples} spp in ${((Date.now() - t0) / 1000).toFixed(1)} s, NaN ${res.nan}, negative ${res.neg}`);
  const tag = args.tag ? `-${args.tag}` : '';
  const name = `${args.white ? 'white' : 'safe'}-${size}-${spp}${tag}`;
  writeFileSync(`${args.out}/${name}.png`, Buffer.from(await page.evaluate(() => window.__lookdev.png(8))));
  const refUrl = args.ref ? `data:image/webp;base64,${readFileSync(args.ref).toString('base64')}` : null;
  const refColors = refUrl ? await page.evaluate(([u, s]) => window.__lookdev.sampleRef(u, s), [refUrl, res.spots]) : null;
  const rows = [];
  for (const [i, s] of res.spots.entries()) {
    const lin = s.linear;
    const ours = lin ? await page.evaluate((c) => window.__lookdev.display(c), lin) : null;
    // 'center' is a probe for replaced content, not a reference spot
    const ref = refColors && s.id !== 'center' ? refColors[i] : null;
    rows.push({
      spot: s.id,
      px: `${s.x.toFixed(0)},${s.y.toFixed(0)}`,
      linear: lin ? lin.map((v) => v.toFixed(3)).join(' ') : '—',
      ours: ours ? hex(ours) : '—',
      ref: ref ? hex(ref) : s.hex,
      dE76: ours && ref ? de76(ours, ref).toFixed(1) : '—',
      dE00: ours && ref ? de2000(ours, ref).toFixed(1) : '—',
    });
  }
  console.table(rows);
  const d00 = rows.map((r) => Number(r.dE00)).filter((v) => !Number.isNaN(v));
  if (d00.length) console.log(`mean ΔE00 ${(d00.reduce((a, b) => a + b, 0) / d00.length).toFixed(1)}, max ${Math.max(...d00).toFixed(1)}`);
  writeFileSync(`${args.out}/${name}.json`, JSON.stringify({ args, res, rows }, null, 2));
  if (refUrl) {
    const bytes = await page.evaluate(([u, s]) => window.__lookdev.compare(u, s), [refUrl, res.spots]);
    writeFileSync(`${args.out}/${name}-vs-ref.png`, Buffer.from(bytes));
  }
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  if (errors.length) console.log(errors.join('\n'));
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
