import { $, odo, tick, Spring } from '../ui/kit/core';
import { createRenderer, hasWebGPUBackend, Tracer, type SceneChanges } from '../render/tracer';
import { Studio } from '../studio/studio';
import type * as THREE from 'three/webgpu';

export const VIEWS: Record<string, { az: number; el: number }> = {
  'three-quarter-right': { az: 23, el: 4 },
  front: { az: 0, el: 2 },
  'three-quarter-left': { az: -23, el: 4 },
  top: { az: 20, el: 34 },
};
export const VIEWPORT_PADDING = 0.2;
const TRACE_SAMPLES = 64;

/**
 * The canvas: raster preview while things move, progressive path tracing once they stop. Owns
 * the orbit springs and the framing glide; other modules hook into every frame through
 * `frameHooks` (the selection overlay redraws there, after the camera moved).
 */
export class Viewport {
  readonly orbitAz = new Spring(23, { stiffness: 140, damping: 22 });
  readonly orbitEl = new Spring(4, { stiffness: 140, damping: 22 });
  /** viewport trace size as a fraction of the CSS size */
  traceScale = 0.6;
  /** e2e: hold the tracer so screenshots can grab a frame */
  tracePaused = false;
  /** an export owns the tracer */
  exporting = false;
  /** meshes are being built: hold tracing, show it in the status chip */
  meshing = false;
  /** a new document is loading: keep the last frame on screen until its meshes land */
  hold = false;
  /** samples of the last traced frame */
  lastCount = 0;
  readonly frameHooks: ((cameraMoved: boolean) => void)[] = [];

  private needsRaster = true;
  private changedAt = performance.now();
  private tracing = false;
  private traceDone = false;
  private countPending = false;
  private statusEl = $('#status')!;
  private statusText = $('#status-text')!;
  private statusSpp = $('#status-spp')!;

  private constructor(
    readonly canvas: HTMLCanvasElement,
    readonly renderer: THREE.WebGPURenderer,
    readonly studio: Studio,
    readonly tracer: Tracer | null,
    readonly webgpu: boolean,
  ) {}

  static async create(canvas: HTMLCanvasElement) {
    const renderer = await createRenderer(canvas);
    const webgpu = hasWebGPUBackend(renderer);
    const studio = new Studio(renderer);
    studio.setCamera({ padding: VIEWPORT_PADDING });
    const v = new Viewport(canvas, renderer, studio, webgpu ? new Tracer(renderer) : null, webgpu);
    v.start();
    return v;
  }

  aspect() {
    return this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
  }

  /** Something changed: raster now, trace again once things settle. */
  invalidate(changes: SceneChanges = {}) {
    this.tracer?.invalidate(changes);
    this.needsRaster = true;
    this.changedAt = performance.now();
    this.tracing = false;
    this.traceDone = false;
    this.lastCount = 0;
  }

  /** Content moved or changed shape: re-measure and frame it again (gliding, unless a jump is asked for). */
  reframe(glide = true) {
    this.studio.contentChanged();
    this.studio.frame(this.aspect(), glide);
    this.invalidate({ camera: true, lights: true });
  }

  /** Holds the framing while objects are dragged. */
  freeze() {
    this.studio.freeze();
  }

  /** Lets the camera glide to the new fit. */
  unfreeze() {
    if (!this.studio.isFrozen) return;
    this.studio.contentChanged();
    this.studio.unfreeze(true);
    this.invalidate({ camera: true, lights: true });
  }

  orbitTo(az: number, el: number) {
    this.orbitAz.set(az);
    this.orbitEl.set(el);
  }

  jumpTo(az: number, el: number) {
    this.orbitAz.jump(az);
    this.orbitEl.jump(el);
  }

  setStatus(mode: 'raster' | 'tracing' | 'done' | 'busy', spp = 0) {
    this.statusEl.dataset.state = mode;
    this.statusText.textContent = mode === 'busy' ? 'Building mesh' : mode === 'raster' ? 'Preview' : mode === 'tracing' ? 'Tracing' : 'Traced';
    if (mode === 'tracing' || mode === 'done') odo(this.statusSpp, `${spp} spp`);
    else this.statusSpp.textContent = '';
  }

  get statusState() {
    return this.statusEl.dataset.state;
  }

  private resize() {
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight, false);
    this.studio.frame(this.aspect());
    this.invalidate({ camera: true, lights: true, environment: true });
  }

  private start() {
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    tick((dt) => this.frame(dt));
  }

  private frame(dt: number) {
    const { studio } = this;
    this.orbitAz.step(dt);
    this.orbitEl.step(dt);
    let moved = false;
    if (studio.cam.az !== this.orbitAz.value || studio.cam.el !== this.orbitEl.value) {
      studio.setCamera({ az: this.orbitAz.value, el: this.orbitEl.value });
      studio.frame(this.aspect());
      this.invalidate({ camera: true, lights: true, environment: true });
      moved = true;
    }
    if (studio.step(dt)) {
      this.invalidate({ camera: true, lights: true });
      moved = true;
    }
    for (const fn of this.frameHooks) fn(moved);
    if (this.exporting || this.hold) return;
    if (this.needsRaster) {
      studio.render();
      this.needsRaster = false;
      this.setStatus(this.meshing ? 'busy' : 'raster');
      return;
    }
    const t = this.tracer;
    if (!t || this.meshing || this.traceDone || this.tracePaused || performance.now() - this.changedAt < 300) return;
    if (!this.tracing) {
      // a fraction of the CSS size: converges fast, the fade hides the switch from raster
      t.beginViewport(studio.scene, studio.camera, {
        width: this.canvas.clientWidth * this.traceScale,
        height: this.canvas.clientHeight * this.traceScale,
        maxSamples: TRACE_SAMPLES,
      });
      this.tracing = true;
      this.lastCount = 0;
      this.setStatus('tracing', 0);
    }
    t.stepViewport();
    if (!this.countPending) {
      this.countPending = true;
      t.sampleCount().then((c) => {
        this.countPending = false;
        if (!this.tracing) return;
        this.lastCount = c.min;
        if (c.min >= TRACE_SAMPLES) {
          this.traceDone = true;
          this.setStatus('done', TRACE_SAMPLES);
        } else this.setStatus('tracing', Math.max(this.lastCount, Math.floor(c.avg)));
      });
    }
  }
}
