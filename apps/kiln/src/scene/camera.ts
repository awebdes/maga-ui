import * as THREE from 'three/webgpu';

const DEG = Math.PI / 180;

export interface CameraPreset {
  id: string;
  name: string;
  /** degrees, 0 = front, + = camera moves to the object's right */
  az: number;
  /** degrees above horizon */
  el: number;
  ortho: boolean;
}

export const CAMERA_PRESETS: CameraPreset[] = [
  { id: 'front', name: 'Front', az: 0, el: 0, ortho: true },
  { id: 'three-quarter-right', name: '¾ right', az: 25, el: 12, ortho: true },
  { id: 'three-quarter-left', name: '¾ left', az: -25, el: 12, ortho: true },
  { id: 'top', name: 'Top', az: 20, el: 38, ortho: true },
  { id: 'guide-pie', name: 'Guide · pie', az: 37.6, el: 9.3, ortho: true },
  { id: 'guide-case', name: 'Guide · case', az: 20.8, el: 11.3, ortho: true },
];

/** Direction from target to camera for azimuth/elevation in degrees. */
export function orbitDirection(az: number, el: number, out = new THREE.Vector3()) {
  const a = az * DEG;
  const e = el * DEG;
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
}

export function placeCamera(camera: THREE.Camera, az: number, el: number, target = new THREE.Vector3(), distance = 10) {
  const dir = orbitDirection(az, el);
  camera.position.copy(target).addScaledVector(dir, distance);
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
}

const _v = new THREE.Vector3();

/** View-space bounds of every vertex of the given meshes (accurate for any shape). */
export function viewBounds(camera: THREE.Camera, root: THREE.Object3D) {
  camera.updateMatrixWorld(true);
  root.updateMatrixWorld(true);
  const inv = camera.matrixWorldInverse;
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const pos = mesh.geometry.getAttribute('position');
    const m = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    // sample large meshes sparsely; the silhouette is still well covered
    const step = Math.max(1, Math.floor(pos.count / 60000));
    for (let i = 0; i < pos.count; i += step) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(m);
      min.min(_v);
      max.max(_v);
    }
  });
  return { min, max };
}

/**
 * Frames the object in an orthographic camera with `padding` (fraction of the frame on each
 * side) and a frame `aspect` (width / height). Also sets near/far to enclose the object, which
 * the path tracer requires for orthographic rays.
 */
export function fitOrtho(camera: THREE.OrthographicCamera, root: THREE.Object3D, padding = 0.15, aspect = 1) {
  const { min, max } = viewBounds(camera, root);
  const cx = (min.x + max.x) / 2;
  const cy = (min.y + max.y) / 2;
  let halfW = (max.x - min.x) / 2;
  let halfH = (max.y - min.y) / 2;
  const scale = 1 / (1 - 2 * padding);
  halfW *= scale;
  halfH *= scale;
  if (halfW / halfH > aspect) halfH = halfW / aspect;
  else halfW = halfH * aspect;
  camera.left = cx - halfW;
  camera.right = cx + halfW;
  camera.top = cy + halfH;
  camera.bottom = cy - halfH;
  const depth = max.z - min.z;
  camera.near = Math.max(0.001, -max.z - depth * 0.5 - 0.1);
  camera.far = -min.z + depth * 0.5 + 0.1;
  camera.updateProjectionMatrix();
}

/** World-space points sampled from every visible mesh (at most `max`), for framing. */
export function samplePoints(root: THREE.Object3D, max = 24000): Float32Array {
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  let total = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.visible) {
      meshes.push(m);
      total += m.geometry.getAttribute('position').count;
    }
  });
  const step = Math.max(1, Math.ceil(total / max));
  const out: number[] = [];
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += step) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      out.push(_v.x, _v.y, _v.z);
    }
  }
  return new Float32Array(out);
}

export interface Framing {
  /** world point the camera looks at */
  target: THREE.Vector3;
  /** camera distance from the target along the orbit direction */
  distance: number;
  near: number;
  far: number;
}

/**
 * Frames points in a perspective camera looking along -dir (orbit direction), with `padding` as
 * a fraction of the frame on each side. Exact for the given center: every point satisfies
 * |x| / depth ≤ tan(half fov) · (1 - 2 · padding).
 */
export function framePerspective(points: Float32Array, dir: THREE.Vector3, fovDeg: number, aspect: number, padding: number): Framing {
  const toward = dir.clone().normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), toward);
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(toward, right);
  // view-plane bounds → center
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const n = points.length / 3;
  for (let i = 0; i < n; i++) {
    const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
    const px = x * right.x + y * right.y + z * right.z;
    const py = x * up.x + y * up.y + z * up.z;
    const pz = x * toward.x + y * toward.y + z * toward.z;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
    if (pz < minZ) minZ = pz;
    if (pz > maxZ) maxZ = pz;
  }
  if (n === 0) return { target: new THREE.Vector3(), distance: 5, near: 0.1, far: 100 };
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  const ty = Math.tan(((fovDeg / 2) * Math.PI) / 180) * (1 - 2 * padding);
  const tx = ty * aspect;
  let d = 0;
  for (let i = 0; i < n; i++) {
    const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
    const px = x * right.x + y * right.y + z * right.z - cx;
    const py = x * up.x + y * up.y + z * up.z - cy;
    const pz = x * toward.x + y * toward.y + z * toward.z - cz;
    const need = Math.max(Math.abs(px) / tx, Math.abs(py) / ty) + pz;
    if (need > d) d = need;
  }
  const target = new THREE.Vector3().addScaledVector(right, cx).addScaledVector(up, cy).addScaledVector(toward, cz);
  const span = maxZ - minZ;
  return {
    target,
    distance: d,
    near: Math.max(0.01, d - (maxZ - cz) - span * 0.25 - 0.05),
    far: d + (cz - minZ) + span * 0.25 + 0.05,
  };
}
