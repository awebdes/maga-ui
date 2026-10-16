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
  // pre-bundle every three.js user up front: a dependency found mid-session re-bundles three under
  // a new hash, the page then holds two copies and three-mesh-bvh's instanceof checks fail
  optimizeDeps: {
    include: [
      'three/webgpu',
      'three-mesh-bvh',
      'three-gpu-pathtracer/webgpu',
      'three/examples/jsm/lights/RectAreaLightTexturesLib.js',
      'three/examples/jsm/geometries/RoundedBoxGeometry.js',
    ],
  },
  worker: { format: 'es' },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
