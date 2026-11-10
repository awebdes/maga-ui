// Renders one frame at full format size through the export path and saves the PNG.
// node tests/frame.mjs <out.png> <time> [template] [extra-js]
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const [out = 'frame.png', time = '3', template = '', extra = ''] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()));
await p.goto('http://localhost:5180/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);
const data = await p.evaluate(async ({ time, template, extra }) => {
  const { ed, studio } = window.reel;
  if (template) document.querySelector(`[data-template="${template}"]`).click();
  await new Promise((r) => setTimeout(r, 300));
  if (extra) eval(extra);
  await Promise.all(ed.doc.texts.map((x) => document.fonts.load(`${x.weight} 40px "${x.font}"`, x.text)));
  studio.invalidateLayers();
  const t = Number(time);
  const p = ed.doc;
  studio.setSize(p.format.w / 2, p.format.h / 2);
  studio.render(p, t, { frame: 1 });
  return studio.renderer.domElement.toDataURL('image/png');
}, { time, template, extra });
writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'ok');
await b.close();
