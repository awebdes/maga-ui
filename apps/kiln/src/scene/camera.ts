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
