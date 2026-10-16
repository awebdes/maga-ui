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

/** What changed since the tracer last saw the scene. */
export interface SceneChanges {
  /** geometry added, removed or replaced: rebuild the BVH */
  geometry?: boolean;
  /** objects moved or were hidden: refit, no rebuild */
  transforms?: boolean;
  materials?: boolean;
  lights?: boolean;
  environment?: boolean;
  camera?: boolean;
}

/**
 * One WebGPUPathTracer for the whole app: the idle viewport accumulates into the canvas, stills
 * render at an exact size and are read back as float RGBA. Both share BVHs and compiled kernels.
 */
export class Tracer {
  readonly pt: WebGPUPathTracer;
  /** how the scene reached the tracer: e2e checks that moves refit instead of rebuilding */
  readonly stats = { setScene: 0, updateTransforms: 0, updateMaterials: 0 };
  private busy = false;
  /** viewport samples submitted and not finished on the GPU */
  private inFlight = 0;
  private sceneSet: THREE.Scene | null = null;
  private cameraSet: THREE.Camera | null = null;
  private pending: SceneChanges = { geometry: true };

  constructor(private renderer: THREE.WebGPURenderer) {
    const t = new WebGPUPathTracer(renderer);
    t.synchronizeRenderSize = false;
    t.dynamicLowRes = false;
    t.renderDelay = 0;
    t.transmissiveBackground = TRANSMISSIVE_BACKGROUND_ENVIRONMENT;
    t.maxBounces = 8;
    this.pt = t;
  }

  get rendering() {
    return this.busy;
  }

  /** Records changes; they are applied lazily before the next sample. */
  invalidate(changes: SceneChanges) {
    for (const k of Object.keys(changes) as (keyof SceneChanges)[]) if (changes[k]) this.pending[k] = true;
  }

  private sync(scene: THREE.Scene, camera: THREE.Camera) {
    const t = this.pt;
    const p = this.pending;
    if (p.geometry || this.sceneSet !== scene) {
      t.setScene(scene, camera);
      this.stats.setScene++;
      this.sceneSet = scene;
      this.cameraSet = camera;
    } else {
      if (this.cameraSet !== camera) {
        t.setCamera(camera);
        this.cameraSet = camera;
      } else if (p.camera) t.updateCamera();
      if (p.transforms) {
        t.updateTransforms();
        this.stats.updateTransforms++;
      }
      if (p.materials) {
        t.updateMaterials();
        this.stats.updateMaterials++;
      }
      if (p.lights) t.updateLights();
      if (p.environment) t.updateEnvironment();
    }
    this.pending = {};
  }

  /** Starts (or restarts) progressive tracing into the canvas at a fraction of its size. */
  beginViewport(scene: THREE.Scene, camera: THREE.Camera, opts: { width: number; height: number; maxSamples: number }) {
    const t = this.pt;
    t.maxSamples = opts.maxSamples;
    t.minSamples = 3;
    t.fadeDuration = 320;
    t.setSize(Math.max(8, Math.round(opts.width)), Math.max(8, Math.round(opts.height)));
    this.sync(scene, camera);
    t.reset();
  }

  /**
   * One viewport frame: accumulate and present. At most two samples wait on the GPU: a slow GPU
   * (or SwiftShader) otherwise queues samples faster than it runs them, and the page stops getting
   * frames for its own UI.
   */
  stepViewport() {
    if (this.busy || this.inFlight >= 2) return;
    this.pt.renderSample();
    const queue = (this.renderer.backend as unknown as { device?: GPUDevice }).device?.queue;
    if (!queue) return;
    this.inFlight++;
    const done = () => this.inFlight--;
    queue.onSubmittedWorkDone().then(done, done);
  }

  async sampleCount() {
    const c = await this.pt.getSampleCountsAsync();
    return c;
  }

  /** Renders a still at an exact size, independent of the canvas. */
  async still(scene: THREE.Scene, camera: THREE.Camera, opts: StillOptions): Promise<StillResult> {
    if (this.busy) throw new Error('A render is already running');
    this.busy = true;
    const { width, height, samples, onProgress, signal } = opts;
    const t = this.pt;
    const t0 = performance.now();
    try {
      t.maxSamples = samples;
      t.minSamples = 1;
      t.fadeDuration = 0;
      t.setSize(width, height);
      this.invalidate({ camera: true, lights: true, environment: true });
      this.sync(scene, camera);
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
      // the viewport restarts from scratch after a still
      this.invalidate({ camera: true });
    }
  }
}

/** Stills only (spike and look-dev pages). */
export class StillRenderer {
  private tracer: Tracer;
  constructor(renderer: THREE.WebGPURenderer) {
    this.tracer = new Tracer(renderer);
  }
  get pt() {
    return this.tracer.pt;
  }
  render(scene: THREE.Scene, camera: THREE.Camera, opts: StillOptions) {
    this.tracer.invalidate({ geometry: true });
    return this.tracer.still(scene, camera, opts);
  }
}
