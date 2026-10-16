import * as THREE from 'three/webgpu';
import { WebGPUPathTracer, TRANSMISSIVE_BACKGROUND_ENVIRONMENT } from 'three-gpu-pathtracer/webgpu';
import { paddedRowFloats, unpadRows, type FloatImage } from './view-transform';
import { patchWebGPUCompat } from './compat';

export interface StillOptions {
  width: number;
  height: number;
  samples: number;
  /** progress 0..1 by the least-converged pixel */
  onProgress?: (progress: number, samples: number) => void;
  signal?: AbortSignal;
  /** flip rows on readback if the texture origin is bottom-left */
  flipY?: boolean;
  /** log sample counts to the console */
  debug?: boolean;
}

export interface StillResult extends FloatImage {
  ms: number;
  samples: number;
}

/** Shared renderer: raster preview and the path tracer both run on it. */
export async function createRenderer(canvas?: HTMLCanvasElement): Promise<THREE.WebGPURenderer> {
  patchWebGPUCompat();
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  await renderer.init();
  return renderer;
}

export function hasWebGPUBackend(renderer: THREE.WebGPURenderer): boolean {
  return Boolean((renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend);
}

const nextTask = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Renders path-traced stills at an exact size, independent of the canvas.
 * One instance per renderer; renders are serialized.
 */
export class StillRenderer {
  readonly tracer: WebGPUPathTracer;
  private busy = false;

  constructor(private renderer: THREE.WebGPURenderer) {
    const t = new WebGPUPathTracer(renderer);
    t.synchronizeRenderSize = false;
    t.dynamicLowRes = false;
    t.renderDelay = 0;
    t.minSamples = 1;
    t.fadeDuration = 0;
    t.transmissiveBackground = TRANSMISSIVE_BACKGROUND_ENVIRONMENT;
    t.maxBounces = 12;
    this.tracer = t;
  }

  async render(scene: THREE.Scene, camera: THREE.Camera, opts: StillOptions): Promise<StillResult> {
    if (this.busy) throw new Error('A render is already running');
    this.busy = true;
    const { width, height, samples, onProgress, signal } = opts;
    const t = this.tracer;
    const t0 = performance.now();
    try {
      t.maxSamples = samples;
      t.setSize(width, height);
      t.setScene(scene, camera);
      t.reset();
      let done = 0;
      let frame = 0;
      for (;;) {
        if (signal?.aborted) throw new DOMException('Render cancelled', 'AbortError');
        t.renderSample();
        frame++;
        if (frame % 2 === 0) {
          const counts = await t.getSampleCountsAsync();
          done = counts.min;
          onProgress?.(Math.min(1, done / samples), done);
          if (opts.debug && frame % 20 === 0) {
            console.log(`[tracer] frame ${frame} min=${counts.min} avg=${counts.avg.toFixed(2)} max=${counts.max} ${Math.round(performance.now() - t0)}ms`);
          }
          if (done >= samples) break;
        } else {
          await nextTask();
        }
      }
      const target = t.target;
      if (!target) throw new Error('Path tracer produced no output');
      const backend = this.renderer.backend as unknown as {
        copyTextureToBuffer: (tex: THREE.Texture, x: number, y: number, w: number, h: number, face: number) => Promise<Float32Array>;
      };
      const raw = await backend.copyTextureToBuffer(target, 0, 0, width, height, 0);
      const img = unpadRows(raw, width, height, paddedRowFloats(width), opts.flipY ?? false);
      return { ...img, ms: performance.now() - t0, samples: done };
    } finally {
      this.busy = false;
    }
  }
}
