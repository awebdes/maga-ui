import * as THREE from 'three/webgpu';
import { MeshBVH, SAH, acceleratedRaycast } from 'three-mesh-bvh';
import type { SceneRuntime } from '../doc/runtime';
import type { Viewport } from './viewport';

// BVH raycasts. The path tracer builds `geometry.boundsTree` with the same three-mesh-bvh, so
// whichever runs first, the other reuses it.
THREE.Mesh.prototype.raycast = acceleratedRaycast;
/** the path tracer's own options, so it reuses what picking built */
const BVH_OPTIONS = { strategy: SAH, targetLeafSize: 5 };

export interface Hit {
  /** object id */
  id: string;
  /** world point under the cursor */
  point: THREE.Vector3;
}

type BvhGeometry = THREE.BufferGeometry & { boundsTree?: MeshBVH };


/** Finds the object under a pixel. */
export class Picker {
  private rc = new THREE.Raycaster();
  private sphere = new THREE.Sphere();

  constructor(
    private view: Viewport,
    private runtime: SceneRuntime,
  ) {
    (this.rc as unknown as { firstHitOnly: boolean }).firstHitOnly = true;
  }

  /** Ray through client coordinates. */
  ray(x: number, y: number) {
    const r = this.view.canvas.getBoundingClientRect();
    this.rc.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), this.view.studio.camera);
    return this.rc.ray;
  }

  /**
   * Nearest visible object under a point. A mesh the ray may hit gets its BVH here if the tracer
   * hasn't built one yet: once per mesh, then every pick on it is a fraction of a millisecond.
   */
  pick(x: number, y: number): Hit | null {
    const ray = this.ray(x, y);
    this.runtime.root.updateMatrixWorld(true);
    const best = { d: Infinity, obj: null as THREE.Object3D | null, point: new THREE.Vector3() };
    this.runtime.root.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = m.geometry as BvhGeometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      this.sphere.copy(g.boundingSphere!).applyMatrix4(m.matrixWorld);
      if (!ray.intersectsSphere(this.sphere)) return;
      g.boundsTree ??= new MeshBVH(g, BVH_OPTIONS);
      const hit = this.rc.intersectObject(m, false)[0];
      if (hit && hit.distance < best.d) {
        best.d = hit.distance;
        best.obj = m;
        best.point.copy(hit.point);
      }
    });
    const id = this.runtime.objectIdOf(best.obj);
    return id ? { id, point: best.point } : null;
  }
}
