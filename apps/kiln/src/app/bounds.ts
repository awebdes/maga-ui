import * as THREE from 'three/webgpu';
import type { SceneRuntime } from '../doc/runtime';
import type { Viewport } from './viewport';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const corner = new THREE.Vector3();

/** Visits the 8 corners of every visible mesh box under the given objects or groups, in world space. */
function eachCorner(runtime: SceneRuntime, ids: string[], fn: (p: THREE.Vector3) => void) {
  runtime.root.updateMatrixWorld(true);
  for (const id of ids) {
    const node = runtime.objectNode(id);
    if (!node) continue;
    // a hidden object or group draws no box
    let shown = true;
    for (let p: THREE.Object3D | null = node; p; p = p.parent) if (!p.visible) shown = false;
    if (!shown) continue;
    node.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox!;
      for (let i = 0; i < 8; i++) {
        corner.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(m.matrixWorld);
        fn(corner);
      }
    });
  }
}

/** World bounds of objects or groups (empty when nothing is visible). */
export function worldBox(runtime: SceneRuntime, ids: string[], out = new THREE.Box3()) {
  out.makeEmpty();
  eachCorner(runtime, ids, (p) => out.expandByPoint(p));
  return out;
}

/** Client-pixel rectangle of objects or groups as the camera sees them, or null when nothing shows. */
export function screenRect(runtime: SceneRuntime, view: Viewport, ids: string[]): Rect | null {
  const cam = view.studio.camera;
  const r = view.canvas.getBoundingClientRect();
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  eachCorner(runtime, ids, (p) => {
    p.project(cam);
    const x = r.left + ((p.x + 1) / 2) * r.width;
    const y = r.top + ((1 - p.y) / 2) * r.height;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  });
  if (x0 === Infinity) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Client pixel of a world point. */
export function toScreen(view: Viewport, p: THREE.Vector3) {
  const r = view.canvas.getBoundingClientRect();
  const v = p.clone().project(view.studio.camera);
  return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
}
