import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  // relative asset URLs so the build works from any folder (static hosting, artifact preview)
  base: './',
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
