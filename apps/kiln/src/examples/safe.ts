import * as THREE from 'three/webgpu';
import { arc, sweep, slab, disc, loop, type ProfilePoint } from '../scene/slab';
import type { Spot } from './parts';

/**
 * Faithful rebuild of the reference "safe + % + briefcase coin" (images/7.webp).
 * Units: the safe's front face is 1 × 1, depth 0.62, front face at z = 0.31.
 * Positions were measured on the reference at az 23°.
 */

const H = 0.5;
const D = 0.31;

/** Safe body: rounded box with a door separated from the frame by a U groove. */
export function safeBodyGeometry() {
  const outerCorner = 0.09;
  const backEdge = 0.04;
  const frontEdge = 0.035;
  const outer = (pts: ProfilePoint[]) => pts.map((p) => ({ ...p, r: outerCorner - (H - p.w) }));
  // the door has its own, larger corner radius (0.087 at the groove)
  const door = (pts: ProfilePoint[]) => pts.map((p) => ({ ...p, r: 0.087 - (0.435 - p.w) }));
  const profile = [
    ...outer(arc(H - backEdge, -D + backEdge, backEdge, -90, 0, 6)),
    ...outer(arc(H - frontEdge, D - frontEdge, frontEdge, 0, 90, 8)),
    // frame lip into the groove, U groove, rounded door edge
    ...door(arc(0.446, D - 0.006, 0.006, 90, 180, 4)),
    ...door(arc(0.434, D - 0.016, 0.006, 0, -180, 8, true)),
    ...door(arc(0.416, D - 0.012, 0.012, 0, 90, 6)),
  ];
  return sweep(profile, { width: 1, height: 1, corner: outerCorner, segments: 16, capStart: true, capEnd: true });
}

/** Safe body with the dial: the "safe" model object, all in the `main` slot, body center at the origin. */
export function buildSafeModel(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'safe-model';
  g.add(slotMesh(safeBodyGeometry(), 'main', 'safe-body'));
  const dial = new THREE.Group();
  dial.name = 'dial';
  dial.position.set(0, 0, D);
  const ring = slotMesh(loop({ width: 0.44, height: 0.44, corner: 0.22, wall: 0.046, depth: 0.07, edge: 0.016, segments: 24 }), 'main', 'dial-ring');
  ring.position.z = 0.03;
  const hub = slotMesh(disc(0.076, 0.06, 0.024, 0.004), 'main', 'dial-hub');
  hub.position.z = 0.025;
  dial.add(ring, hub);
  for (const rot of [0, Math.PI / 2]) {
    const spoke = slotMesh(slab({ width: 0.37, height: 0.017, depth: 0.026, corner: 0.0085, edge: 0.006 }), 'main', 'dial-spoke');
    spoke.rotation.z = rot;
    spoke.position.z = 0.008;
    dial.add(spoke);
  }
  g.add(dial);
  return g;
}

/** Briefcase from the reference coin: body and handle, `main` slot, body center at the origin. */
export function buildBriefcase(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'briefcase-model';
  const body = slotMesh(slab({ width: 0.24, height: 0.183, depth: 0.03, corner: 0.014, edge: 0.008 }), 'main', 'briefcase');
  const handle = slotMesh(loop({ width: 0.081, height: 0.036, corner: 0.012, wall: 0.011, holeCorner: 0.003, depth: 0.022, edge: 0.005 }), 'main', 'briefcase-handle');
  handle.position.set(0, 0.1035, -0.002);
  g.add(body, handle);
  return g;
}

function slotMesh(geometry: THREE.BufferGeometry, slot: string, name: string) {
  const m = new THREE.Mesh(geometry);
  m.name = name;
  m.userData.slot = slot;
  return m;
}

/** Look-dev sample spots on the safe composition (body at the origin). */
export const SAFE_SPOTS: Spot[] = [
  { id: 'front UL', world: [-0.324, 0.337, D] as [number, number, number], ref: [579, 662] as [number, number], hex: '#79D037' },
  { id: 'front mid', world: [0.273, 0.215, D] as [number, number, number], ref: [1138, 786] as [number, number], hex: '#45B217' },
  { id: 'front LR', world: [0.329, -0.355, D] as [number, number, number], ref: [1190, 1366] as [number, number], hex: '#269009' },
  { id: 'side', world: [0.5, -0.03, -0.015] as [number, number, number], ref: [1480, 1035] as [number, number], hex: '#9ADD5B' },
  { id: 'coin', world: [-0.5, -0.283, 0.49] as [number, number, number], ref: [341, 1293] as [number, number], hex: '#E3E5E2' },
  { id: '% dot', world: [0.555, 0.576, 0.3825] as [number, number, number], ref: [1381, 414] as [number, number], hex: '#FD6500' },
  { id: 'briefcase', world: [-0.405, -0.432, 0.518] as [number, number, number], ref: [445, 1438] as [number, number], hex: '#FF7100' },
];
