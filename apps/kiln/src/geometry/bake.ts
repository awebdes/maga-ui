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

  async bake(
    key: string,
    coverage: Coverage,
    form: FormParams,
    resolution: number,
    opts: { checkTopology?: boolean; simplify?: number } = {},
  ): Promise<BakeResult> {
    const id = this.nextId++;
    const req: BakeRequest = { id, key, form, resolution, ...opts };
    if (!this.sent.has(key)) {
      req.coverage = { data: coverage.data, w: coverage.w, h: coverage.h, px: coverage.px, x0: coverage.x0, y0: coverage.y0 };
      this.sent.add(key);
    }
    const res = await new Promise<BakeResponse>((resolve) => {
      this.pending.set(id, { resolve });
      this.worker.postMessage(req);
    });
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
