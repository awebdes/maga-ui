import * as THREE from 'three/webgpu';
import type { BakeRequest, BakeResponse } from './mesher.worker';
import type { FormParams } from './profiles';
import type { Coverage } from '../shape/svg';

export interface BakeResult {
  geometry: THREE.BufferGeometry;
  stats: NonNullable<BakeResponse['stats']>;
  bounds: NonNullable<BakeResponse['bounds']>;
}

/** Off-main-thread meshing. The distance field is cached per shape key inside the worker. */
export class Baker {
  private worker = new Worker(new URL('./mesher.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: BakeResponse) => void }>();
  private sent = new Set<string>();

  constructor() {
    this.worker.onmessage = (e: MessageEvent<BakeResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      p.resolve(e.data);
    };
  }

  /**
   * Meshes a shape. `coverage` may be a function: it is only called when the worker doesn't hold
   * the shape's distance field yet, so cached shapes skip rasterizing.
   */
  async bake(
    key: string,
    coverage: Coverage | (() => Promise<Coverage>),
    form: FormParams,
    resolution: number,
    opts: { checkTopology?: boolean; simplify?: number } = {},
  ): Promise<BakeResult> {
    const send = async (withCoverage: boolean) => {
      const id = this.nextId++;
      const req: BakeRequest = { id, key, form, resolution, ...opts };
      if (withCoverage) {
        const c = typeof coverage === 'function' ? await coverage() : coverage;
        req.coverage = { data: c.data, w: c.w, h: c.h, px: c.px, x0: c.x0, y0: c.y0 };
        this.sent.add(key);
      }
      return new Promise<BakeResponse>((resolve) => {
        this.pending.set(id, { resolve });
        this.worker.postMessage(req);
      });
    };
    let res = await send(!this.sent.has(key));
    // the worker keeps a few fields only; resend the shape once if it was evicted
    if (!res.ok && res.error === 'Shape data missing') res = await send(true);
    if (!res.ok) {
      this.sent.delete(key);
      throw new Error(res.error ?? 'Baking failed');
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(res.positions!, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(res.normals!, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(res.uvs!, 2));
    g.setIndex(new THREE.BufferAttribute(res.indices!, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return { geometry: g, stats: res.stats!, bounds: res.bounds! };
  }

  dispose() {
    this.worker.terminate();
  }
}
