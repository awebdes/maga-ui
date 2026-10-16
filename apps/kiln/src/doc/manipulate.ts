import * as THREE from 'three/webgpu';
import { findGroup, findObject, matrixOf, type SceneDoc, type Transform } from './scene';
import { setTransform } from './ops';

/**
 * Direct manipulation on the document: moves, scales and turns selections in world space, then
 * writes each item back in its own parent space (a group's children live in the group's space).
 * Gestures keep the transforms they started from and recompute from them on every pointer move,
 * so nothing drifts.
 */

export interface Start {
  id: string;
  t: Transform;
  /** world matrix of the parent group, null at the top level */
  parent: THREE.Matrix4 | null;
  /** world position at the start */
  world: THREE.Vector3;
}

const DEG = Math.PI / 180;
const round = (v: number) => Math.round(v * 1e6) / 1e6;

export function startsOf(doc: SceneDoc, ids: string[]): Start[] {
  const out: Start[] = [];
  for (const id of ids) {
    const g = findGroup(doc, id);
    const o = g ? undefined : findObject(doc, id);
    const item = g ?? o;
    if (!item) continue;
    const pg = o?.group ? findGroup(doc, o.group) : undefined;
    const parent = pg ? matrixOf(pg.t) : null;
    const world = new THREE.Vector3(item.t.x, item.t.y, item.t.z);
    if (parent) world.applyMatrix4(parent);
    out.push({ id, t: { ...item.t }, parent, world });
  }
  return out;
}

function writePosition(doc: SceneDoc, s: Start, world: THREE.Vector3, patch: Partial<Transform> = {}) {
  const p = s.parent ? world.clone().applyMatrix4(s.parent.clone().invert()) : world;
  setTransform(doc, s.id, { x: round(p.x), y: round(p.y), z: round(p.z), ...patch });
}

/** Moves every item by a world-space delta. */
export function moveBy(doc: SceneDoc, starts: Start[], delta: THREE.Vector3) {
  for (const s of starts) writePosition(doc, s, s.world.clone().add(delta));
}

/** Scales every item by `f` around a world point (a single item: its own origin). */
export function scaleBy(doc: SceneDoc, starts: Start[], center: THREE.Vector3, f: number) {
  for (const s of starts) {
    const w = s.world.clone().sub(center).multiplyScalar(f).add(center);
    writePosition(doc, s, w, { scale: round(Math.max(0.01, s.t.scale * f)) });
  }
}

/**
 * Turns every item by `deg` around a world axis through `center`: 'turn' around Y, 'tilt' around
 * Z (the facing axis). Each item also turns in place by the same angle.
 */
export function rotateBy(doc: SceneDoc, starts: Start[], center: THREE.Vector3, deg: number, axis: 'tilt' | 'turn') {
  const q = new THREE.Quaternion().setFromAxisAngle(axis === 'turn' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1), deg * DEG);
  for (const s of starts) {
    const w = s.world.clone().sub(center).applyQuaternion(q).add(center);
    writePosition(doc, s, w, { [axis]: round(wrap180(s.t[axis] + deg)) });
  }
}

/** Angle into (-180, 180]. */
export function wrap180(deg: number) {
  let a = ((deg + 180) % 360 + 360) % 360 - 180;
  if (a === -180) a = 180;
  return a;
}

export function snap(v: number, step: number) {
  return Math.round(v / step) * step;
}

/** Shift-drag: keep the dominant screen axis only. */
export function lockAxis(dx: number, dy: number): [number, number] {
  return Math.abs(dx) >= Math.abs(dy) ? [dx, 0] : [0, dy];
}

/** Ray through a pixel of a `w` × `h` view (top-left origin). */
export function pixelRay(camera: THREE.Camera, x: number, y: number, w: number, h: number) {
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), camera);
  return rc.ray;
}

/**
 * World delta that keeps a grabbed point under the cursor: both pixels are cast onto the plane
 * through `anchor` facing the camera.
 */
export function dragDelta(camera: THREE.Camera, anchor: THREE.Vector3, from: [number, number], to: [number, number], w: number, h: number) {
  const normal = camera.getWorldDirection(new THREE.Vector3());
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, anchor);
  const a = pixelRay(camera, from[0], from[1], w, h).intersectPlane(plane, new THREE.Vector3());
  const b = pixelRay(camera, to[0], to[1], w, h).intersectPlane(plane, new THREE.Vector3());
  if (!a || !b) return new THREE.Vector3();
  return b.sub(a);
}
