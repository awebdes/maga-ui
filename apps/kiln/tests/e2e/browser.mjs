// Shared helpers: start Vite on localhost (a secure context, required for WebGPU) and
// launch Chromium with SwiftShader WebGPU so path tracing runs without a GPU.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

export const WEBGPU_FLAGS = [
  '--enable-unsafe-webgpu',
  '--enable-unsafe-swiftshader',
  '--enable-features=Vulkan',
  '--use-vulkan=swiftshader',
  '--use-webgpu-adapter=swiftshader',
  '--use-angle=swiftshader',
  // No --disable-dawn-features=lazy_clear_resource_on_first_use: it hides Dawn's lazy-clear bug
  // on 3D storage textures but leaves every other GPU allocation uninitialized, and the path
  // tracer then accumulates garbage. src/render/compat.ts zero-fills 3D storage textures instead.
];

export async function startServer(port = 4317, { hmr = true } = {}) {
  const server = await createServer({
    root,
    configFile: `${root}vite.config.ts`,
    server: { port, strictPort: true, host: '127.0.0.1', ...(hmr ? {} : { hmr: false, watch: null }) },
    logLevel: 'error',
  });
  await server.listen();
  return { server, url: `http://127.0.0.1:${port}` };
}

export async function launch({ width = 1440, height = 900 } = {}) {
  const browser = await chromium.launch({ args: WEBGPU_FLAGS });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return { browser, page, errors };
}
