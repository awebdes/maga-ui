// Screenshot helper: node tests/shot.mjs <url> <out.png> [w] [h] [script]
import { chromium } from 'playwright';
const [url = 'http://localhost:5180/', out = 'shot.png', w = '1600', h = '1000', script = ''] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const errors = [];
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(url, { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
if (script) await p.evaluate(script);
await p.waitForTimeout(1500);
await p.screenshot({ path: out });
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
await b.close();
