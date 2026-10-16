import * as THREE from 'three/webgpu';
import { slab, disc } from '../scene/slab';
import { partMesh, type Part } from './parts';

/** Flat % sign facing +Z: two dots and a slash, about 0.4 across at scale 1. */
export function percentSign(part: Part = 'accent', scale = 1) {
  const g = new THREE.Group();
  g.name = 'percent';
  const s = scale;
  const dotA = partMesh(disc(0.059 * s, 0.045 * s, 0.018 * s), part, 'percent-dot');
  dotA.position.set(-0.101 * s, 0.098 * s, 0);
  const dotB = partMesh(disc(0.059 * s, 0.045 * s, 0.018 * s), part, 'percent-dot');
  dotB.position.set(0.101 * s, -0.098 * s, 0);
  const slash = partMesh(slab({ width: 0.38 * s, height: 0.062 * s, depth: 0.045 * s, corner: 0.031 * s, edge: 0.018 * s }), part, 'percent-slash');
  slash.rotation.z = Math.PI / 4;
  g.add(dotA, dotB, slash);
  return g;
}

/** Coin facing +Z with its front face at z = depth / 2. */
export function coin(radius: number, depth: number, part: Part = 'coin') {
  return partMesh(disc(radius, depth, Math.min(radius * 0.12, depth * 0.35)), part, 'coin');
}

/** Toggle: capsule track with a knob at the left. Faces +Z. */
export function toggle(width: number, height: number) {
  const g = new THREE.Group();
  g.name = 'toggle';
  const depth = height * 0.42;
  const track = partMesh(slab({ width, height, depth, corner: height / 2, edge: depth * 0.4 }), 'coin', 'toggle-track');
  const r = height * 0.42;
  const knob = partMesh(disc(r, depth * 1.35, r * 0.35), 'body', 'toggle-knob');
  knob.position.set(-width / 2 + height / 2, 0, depth * 0.35);
  g.add(track, knob);
  return g;
}

/** Rounded square tile facing +Z. */
export function tile(size: number, depth: number, part: Part = 'accent') {
  return partMesh(slab({ width: size, height: size, depth, corner: size * 0.16, edge: depth * 0.35 }), part, 'tile');
}
