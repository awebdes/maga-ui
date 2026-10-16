import * as THREE from 'three/webgpu';
import { applyGradient, buildMaterial, ensureWhiteColors, findMaterial, type MaterialSpec } from '../scene/materials';
import type { CameraState } from '../studio/studio';

/** Material slots of a composition. The material panel edits one slot at a time. */
export type Part = 'body' | 'accent' | 'coin';

export const PARTS: { id: Part; name: string }[] = [
  { id: 'body', name: 'Body' },
  { id: 'accent', name: 'Accent' },
  { id: 'coin', name: 'Coin' },
];

export type MaterialSet = Record<Part, MaterialSpec>;

export function defaultMaterials(): MaterialSet {
  return {
    body: { ...findMaterial('green-clay') },
    accent: { ...findMaterial('orange-gradient') },
    coin: { ...findMaterial('coin-grey') },
  };
}

/** A look-dev sample spot: a point on a surface and where the same spot is in the reference. */
export interface Spot {
  id: string;
  world: [number, number, number];
  /** pixel in the 2000 × 2000 reference */
  ref: [number, number];
  /** reference color there (median of a 15 px window) */
  hex: string;
}

export interface Example {
  id: string;
  name: string;
  root: THREE.Group;
  camera: Partial<CameraState>;
  spots?: Spot[];
}

export function partMesh(geometry: THREE.BufferGeometry, part: Part, name: string) {
  const mesh = new THREE.Mesh(geometry);
  mesh.name = name;
  mesh.userData.part = part;
  return mesh;
}

/**
 * Assigns one material per part to every mesh under `root`. Gradient materials get per-mesh
 * vertex colors across each mesh's own bounds, so every accent piece carries the full gradient.
 */
export function applyMaterials(root: THREE.Object3D, set: MaterialSet) {
  const built = new Map<Part, THREE.MeshPhysicalMaterial>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const part = (mesh.userData.part as Part | undefined) ?? 'body';
    const spec = set[part];
    let mat = built.get(part);
    if (!mat) {
      mat = buildMaterial(spec);
      built.set(part, mat);
    }
    if (spec.gradient) applyGradient(mesh.geometry, spec.gradient, spec.gradientAngle ?? 0);
    else ensureWhiteColors(mesh.geometry);
    const old = mesh.material as THREE.Material | undefined;
    if (old && old !== mat && !(Array.isArray(old))) old.dispose();
    mesh.material = mat;
  });
}

/** Which parts exist under a root, for the material panel. */
export function partsIn(root: THREE.Object3D): Part[] {
  const found = new Set<Part>();
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) found.add(((o as THREE.Mesh).userData.part as Part | undefined) ?? 'body');
  });
  return PARTS.map((p) => p.id).filter((p) => found.has(p));
}
