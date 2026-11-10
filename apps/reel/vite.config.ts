import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const kit = fileURLToPath(new URL('../kiln/src/ui/kit', import.meta.url));

export default defineConfig({
  // relative asset URLs so the build works from any folder (static hosting, artifact preview)
  base: './',
  resolve: { alias: { '@kit': kit } },
  server: { fs: { allow: ['..'] } },
  build: { target: 'es2022' },
  test: { environment: 'node' },
});
