import * as THREE from 'three/webgpu';
import { buildMaterial, findMaterial, applyGradient, ensureWhiteColors } from '../scene/materials';
import { coinGeometry, roundedBox, capsule, ring } from '../scene/primitives';

/**
 * Primitive-only rebuild of the "safe + % + briefcase coin" reference,
 * used to judge materials, light and export before the mesher exists.
 */
export function buildSafeScene(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'safe-ref';

  const green = buildMaterial(findMaterial('green-satin'));
  const orange = buildMaterial(findMaterial('orange-gradient'));
  const grey = buildMaterial(findMaterial('coin-grey'));

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, setup?: (m: THREE.Mesh) => void) => {
    if ((mat as THREE.MeshPhysicalMaterial).vertexColors) {
      applyGradient(geo, findMaterial('orange-gradient').gradient!, findMaterial('orange-gradient').gradientAngle);
    } else {
      ensureWhiteColors(geo);
    }
    const m = new THREE.Mesh(geo, mat);
    setup?.(m);
    root.add(m);
    return m;
  };

  // body
  add(roundedBox(1.2, 1.1, 0.62, 0.13, 8), green);
  // door panel, slightly proud of the front face
  add(roundedBox(0.92, 0.84, 0.05, 0.08, 6), green, (m) => (m.position.z = 0.31));
  // dial
  add(ring(0.2, 0.034), green, (m) => (m.position.z = 0.37));
  add(coinGeometry(0.075, 0.07, 0.025, 64), green, (m) => (m.position.z = 0.37));
  add(roundedBox(0.36, 0.022, 0.03, 0.01, 2), green, (m) => (m.position.z = 0.36));
  add(roundedBox(0.022, 0.36, 0.03, 0.01, 2), green, (m) => (m.position.z = 0.36));

  // percent sign, top-right, slightly in front
  const pct = new THREE.Group();
  pct.position.set(0.62, 0.62, 0.18);
  root.add(pct);
  const dotA = new THREE.Mesh(coinGeometry(0.075, 0.07, 0.03, 64), orange);
  dotA.position.set(-0.13, 0.12, 0);
  const dotB = new THREE.Mesh(coinGeometry(0.075, 0.07, 0.03, 64), orange);
  dotB.position.set(0.13, -0.12, 0);
  const slash = new THREE.Mesh(capsule(0.04, 0.34), orange);
  slash.rotation.z = -Math.PI / 4.4;
  for (const m of [dotA, dotB, slash]) {
    applyGradient(m.geometry, findMaterial('orange-gradient').gradient!, findMaterial('orange-gradient').gradientAngle);
    pct.add(m);
  }

  // briefcase coin, bottom-left, in front
  const badge = new THREE.Group();
  badge.position.set(-0.6, -0.52, 0.42);
  root.add(badge);
  const coin = new THREE.Mesh(coinGeometry(0.27, 0.07, 0.03, 128), grey);
  ensureWhiteColors(coin.geometry);
  badge.add(coin);
  const caseBody = new THREE.Mesh(roundedBox(0.27, 0.19, 0.05, 0.02, 3), orange);
  caseBody.position.set(0, -0.02, 0.055);
  const handle = new THREE.Mesh(roundedBox(0.1, 0.05, 0.03, 0.012, 2), orange);
  handle.position.set(0, 0.095, 0.05);
  for (const m of [caseBody, handle]) {
    applyGradient(m.geometry, findMaterial('orange-gradient').gradient!, findMaterial('orange-gradient').gradientAngle);
    badge.add(m);
  }

  return root;
}
