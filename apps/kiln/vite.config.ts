import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  // relative asset URLs so the build works from any folder (static hosting, artifact preview)
  base: './',
  resolve: {
    // one copy of three: addons and the path tracer import 'three', the app imports 'three/webgpu'
    alias: [{ find: /^three$/, replacement: 'three/webgpu' }],
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: `${root}index.html`,
        spike: `${root}spike.html`,
      },
    },
  },
  worker: { format: 'es' },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
