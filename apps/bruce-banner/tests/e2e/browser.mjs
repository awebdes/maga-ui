// Shared helpers: start Vite on localhost and launch Chromium (Playwright 1.56.1, the build
// preinstalled at /opt/pw-browsers). Banners are Canvas 2D: no GPU flags needed.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

export async function startServer(port = 4330, { hmr = false, env = {} } = {}) {
  Object.assign(process.env, env);
  const server = await createServer({
    root,
    configFile: `${root}vite.config.ts`,
    server: { port, strictPort: true, host: '127.0.0.1', ...(hmr ? {} : { hmr: false, watch: null }) },
    logLevel: 'error',
  });
  await server.listen();
  return { server, url: `http://127.0.0.1:${port}` };
}

export async function launch({ width = 1440, height = 900, scale = 1 } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // Google Fonts (the UI face) is not reachable from the test browser; that is not an app error
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com|ERR_TUNNEL|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return { browser, context, page, errors };
}

/** Prints a check line and records failure. */
export function checker() {
  let failed = 0;
  const check = (ok, msg) => {
    console.log(`${ok ? '✓' : '✗'} ${msg}`);
    if (!ok) failed++;
  };
  return { check, get failed() { return failed; } };
}
