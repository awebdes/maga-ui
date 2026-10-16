import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { slab, disc, loop } from '../../src/scene/slab';
import { safeBodyGeometry } from '../../src/examples/safe';
import { meshTopology } from '../../src/geometry/mesher';

function check(name: string, g: THREE.BufferGeometry) {
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const idx = g.getIndex()!;
  let nan = 0;
  for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i] as number)) nan++;
  for (let i = 0; i < nrm.array.length; i++) if (!Number.isFinite(nrm.array[i] as number)) nan++;
  let flipped = 0;
  let tiny = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), f = new THREE.Vector3();
  for (let t = 0; t < idx.count; t += 3) {
    const i0 = idx.getX(t), i1 = idx.getX(t + 1), i2 = idx.getX(t + 2);
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    f.subVectors(b, a).cross(c.clone().sub(a));
    if (f.length() < 1e-9) tiny++;
    n.fromBufferAttribute(nrm, i0).add(new THREE.Vector3().fromBufferAttribute(nrm, i1)).add(new THREE.Vector3().fromBufferAttribute(nrm, i2));
    if (f.dot(n) < 0) flipped++;
  }
  const topo = meshTopology(idx.array as Uint32Array, pos.count);
  return { name, tris: idx.count / 3, nan, flipped, tiny, boundary: topo.boundary, nonManifold: topo.nonManifold };
}

describe('slab sweeps', () => {
  const cases: [string, THREE.BufferGeometry][] = [
    ['slab', slab({ width: 0.38, height: 0.062, depth: 0.045, corner: 0.031, edge: 0.018 })],
    ['disc', disc(0.207, 0.08, 0.026)],
    ['loop', loop({ width: 0.44, height: 0.44, corner: 0.22, wall: 0.046, depth: 0.07, edge: 0.016, segments: 24 })],
    ['handle', loop({ width: 0.081, height: 0.036, corner: 0.012, wall: 0.011, holeCorner: 0.003, depth: 0.022, edge: 0.005 })],
    ['safe body', safeBodyGeometry()],
  ];
  for (const [name, g] of cases) {
    it(`${name} is clean`, () => {
      const r = check(name, g);
      console.log(JSON.stringify(r));
      expect(r.nan).toBe(0);
      expect(r.flipped).toBe(0);
    });
  }
});
