import * as THREE from 'three/webgpu';
import { arc, sweep, slab, disc, loop, type ProfilePoint } from '../scene/slab';
import { partMesh, type Example } from './parts';

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

export function buildSafe(): Example {
  const root = new THREE.Group();
  root.name = 'safe';

  root.add(partMesh(safeBodyGeometry(), 'body', 'safe-body'));

  // dial: thick ring, hub, four spokes
  const dial = new THREE.Group();
  dial.name = 'dial';
  dial.position.set(0, 0, D);
  const ring = partMesh(loop({ width: 0.44, height: 0.44, corner: 0.22, wall: 0.046, depth: 0.07, edge: 0.016, segments: 24 }), 'body', 'dial-ring');
  ring.position.z = 0.03;
  const hub = partMesh(disc(0.076, 0.06, 0.024, 0.004), 'body', 'dial-hub');
  hub.position.z = 0.025;
  dial.add(ring, hub);
  for (const rot of [0, Math.PI / 2]) {
    const spoke = partMesh(slab({ width: 0.37, height: 0.017, depth: 0.026, corner: 0.0085, edge: 0.006 }), 'body', 'dial-spoke');
    spoke.rotation.z = rot;
    spoke.position.z = 0.008;
    dial.add(spoke);
  }
  root.add(dial);

  // percent sign, top right, just in front of the body
  const pct = new THREE.Group();
  pct.name = 'percent';
  pct.position.set(0.656, 0.478, 0.36);
  const dotA = partMesh(disc(0.059, 0.045, 0.018), 'accent', 'percent-dot');
  dotA.position.set(-0.101, 0.098, 0);
  const dotB = partMesh(disc(0.059, 0.045, 0.018), 'accent', 'percent-dot');
  dotB.position.set(0.101, -0.098, 0);
  const slash = partMesh(slab({ width: 0.38, height: 0.062, depth: 0.045, corner: 0.031, edge: 0.018 }), 'accent', 'percent-slash');
  slash.rotation.z = Math.PI / 4;
  pct.add(dotA, dotB, slash);
  root.add(pct);

  // coin with a briefcase, bottom left, in front
  const badge = new THREE.Group();
  badge.name = 'badge';
  badge.position.set(-0.4, -0.42, 0.45);
  const coin = partMesh(disc(0.207, 0.08, 0.026), 'coin', 'coin');
  const caseBody = partMesh(slab({ width: 0.24, height: 0.183, depth: 0.03, corner: 0.014, edge: 0.008 }), 'accent', 'briefcase');
  caseBody.position.set(-0.005, -0.012, 0.053);
  const handle = partMesh(
    loop({ width: 0.081, height: 0.036, corner: 0.012, wall: 0.011, holeCorner: 0.003, depth: 0.022, edge: 0.005 }),
    'accent',
    'briefcase-handle',
  );
  handle.position.set(-0.005, 0.0915, 0.051);
  badge.add(coin, caseBody, handle);
  root.add(badge);

  return {
    id: 'safe',
    name: 'Safe',
    root,
    camera: { az: 23, el: 2, fov: 20, padding: 0.15, ortho: false },
    spots: [
      { id: 'front UL', world: [-0.324, 0.337, D], ref: [579, 662], hex: '#79D037' },
      { id: 'front mid', world: [0.273, 0.215, D], ref: [1138, 786], hex: '#45B217' },
      { id: 'front LR', world: [0.329, -0.355, D], ref: [1190, 1366], hex: '#269009' },
      { id: 'side', world: [0.5, -0.03, -0.015], ref: [1480, 1035], hex: '#9ADD5B' },
      { id: 'coin', world: [-0.5, -0.283, 0.49], ref: [341, 1293], hex: '#E3E5E2' },
      { id: '% dot', world: [0.555, 0.576, 0.3825], ref: [1381, 414], hex: '#FD6500' },
      { id: 'briefcase', world: [-0.405, -0.432, 0.518], ref: [445, 1438], hex: '#FF7100' },
    ],
  };
}
