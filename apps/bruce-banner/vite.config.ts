import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { devApi } from './vite-api.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  // relative asset URLs so the build works from any folder (static hosting, artifact preview)
  base: './',
  plugins: [devApi()],
  build: {
    target: 'es2022',
    rollupOptions: { input: { main: `${root}index.html` } },
  },
  worker: { format: 'es' },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
