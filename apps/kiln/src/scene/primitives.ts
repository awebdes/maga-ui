import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Coin: lathe of a rounded rectangle profile, face toward +Z.
 * Exact silhouette, and its tangents run around the rim (concentric brushing for metals).
 */
export function coinGeometry(radius = 0.5, thickness = 0.14, edge = 0.05, segments = 128): THREE.BufferGeometry {
  const r = Math.min(edge, thickness / 2, radius);
  const h = thickness / 2;
  const pts: THREE.Vector2[] = [];
  pts.push(new THREE.Vector2(0, h));
  const arc = 12;
  // top-right corner arc: from (R - r, h) to (R, h - r)
  for (let i = 0; i <= arc; i++) {
    const a = (Math.PI / 2) * (1 - i / arc);
    pts.push(new THREE.Vector2(radius - r + r * Math.cos(a), h - r + r * Math.sin(a)));
  }
  // bottom-right corner arc: from (R, -h + r) to (R - r, -h)
  for (let i = 0; i <= arc; i++) {
    const a = -(Math.PI / 2) * (i / arc);
    pts.push(new THREE.Vector2(radius - r + r * Math.cos(a), -h + r + r * Math.sin(a)));
  }
  pts.push(new THREE.Vector2(0, -h));
  // lathe sweeps the profile in reverse order so faces point outward
  const g = new THREE.LatheGeometry(pts.reverse(), segments);
  g.rotateX(Math.PI / 2);
  return g;
}

export function roundedBox(w: number, h: number, d: number, radius: number, segments = 6) {
  return new RoundedBoxGeometry(w, h, d, segments, radius);
}

export function capsule(radius: number, length: number) {
  return new THREE.CapsuleGeometry(radius, length, 12, 48);
}

export function ring(radius: number, tube: number) {
  return new THREE.TorusGeometry(radius, tube, 32, 128);
}
