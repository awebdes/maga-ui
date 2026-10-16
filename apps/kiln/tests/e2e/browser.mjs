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
  // Chromium 141's Dawn lazily clears 3D float storage textures through a 2D view, which fails
  // validation for the path tracer's LUT. The LUT is fully written by a compute pass anyway.
  '--disable-dawn-features=lazy_clear_resource_on_first_use',
];

export async function startServer(port = 4317) {
  const server = await createServer({
    root,
    configFile: `${root}vite.config.ts`,
    server: { port, strictPort: true, host: '127.0.0.1' },
    logLevel: 'error',
  });
  await server.listen();
  return { server, url: `http://127.0.0.1:${port}` };
}

export async function launch({ width = 1440, height = 900 } = {}) {
  const browser = await chromium.launch({ args: WEBGPU_FLAGS });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return { browser, page, errors };
}
