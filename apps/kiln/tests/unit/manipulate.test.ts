import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { safeDoc } from '../../src/doc/examples';
import { findObject, worldMatrix, type SceneDoc } from '../../src/doc/scene';
import { dragDelta, lockAxis, moveBy, rotateBy, scaleBy, startsOf, wrap180 } from '../../src/doc/manipulate';

const worldPos = (d: SceneDoc, id: string) => new THREE.Vector3().setFromMatrixPosition(worldMatrix(d, findObject(d, id)!));

describe('manipulation', () => {
  it('moves a grouped child by a world delta, whatever the group transform', () => {
    const d = safeDoc();
    const g = d.groups[0];
    g.t.turn = 40;
    g.t.scale = 0.5;
    const coin = d.objects.find((o) => o.name === 'Coin')!;
    const before = worldPos(d, coin.id);
    const delta = new THREE.Vector3(0.1, -0.05, 0.2);
    moveBy(d, startsOf(d, [coin.id]), delta);
    expect(worldPos(d, coin.id).sub(before).distanceTo(delta)).toBeLessThan(1e-5);
  });

  it('scales a multi-selection about its center', () => {
    const d = safeDoc();
    const [safe, pct] = d.objects;
    const starts = startsOf(d, [safe.id, pct.id]);
    const c = starts[0].world.clone().add(starts[1].world).multiplyScalar(0.5);
    scaleBy(d, starts, c, 2);
    const a = worldPos(d, safe.id);
    const b = worldPos(d, pct.id);
    expect(a.distanceTo(b)).toBeCloseTo(starts[0].world.distanceTo(starts[1].world) * 2, 5);
    expect(findObject(d, pct.id)!.t.scale).toBeCloseTo(2, 6);
  });

  it('a single item scales and turns in place', () => {
    const d = safeDoc();
    const pct = d.objects[1];
    const p = worldPos(d, pct.id);
    const s = startsOf(d, [pct.id]);
    scaleBy(d, s, s[0].world, 1.5);
    rotateBy(d, startsOf(d, [pct.id]), p, 30, 'tilt');
    expect(worldPos(d, pct.id).distanceTo(p)).toBeLessThan(1e-6);
    expect(findObject(d, pct.id)!.t.tilt).toBeCloseTo(30, 6);
  });

  it('turning a pair rotates positions around Y', () => {
    const d = safeDoc();
    const [safe, pct] = d.objects;
    const s = startsOf(d, [safe.id, pct.id]);
    rotateBy(d, s, new THREE.Vector3(), 90, 'turn');
    const p = worldPos(d, pct.id);
    // (x, z) → (z, -x) for +90° around Y
    expect(p.x).toBeCloseTo(s[1].world.z, 5);
    expect(p.z).toBeCloseTo(-s[1].world.x, 5);
    expect(findObject(d, pct.id)!.t.turn).toBeCloseTo(90, 6);
  });

  it('keeps the grabbed point under the cursor', () => {
    const cam = new THREE.PerspectiveCamera(20, 1.6, 0.1, 50);
    cam.position.set(1.2, 0.4, 4);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    const anchor = new THREE.Vector3(0.3, 0.2, 0.1);
    const w = 1600;
    const h = 1000;
    const from = anchor.clone().project(cam);
    const px: [number, number] = [((from.x + 1) / 2) * w, ((1 - from.y) / 2) * h];
    const to: [number, number] = [px[0] + 140, px[1] - 60];
    const moved = anchor.clone().add(dragDelta(cam, anchor, px, to, w, h)).project(cam);
    expect(((moved.x + 1) / 2) * w).toBeCloseTo(to[0], 3);
    expect(((1 - moved.y) / 2) * h).toBeCloseTo(to[1], 3);
  });

  it('wraps angles and locks the dominant axis', () => {
    expect(wrap180(190)).toBe(-170);
    expect(wrap180(-180)).toBe(180);
    expect(wrap180(540)).toBe(180);
    expect(lockAxis(12, -3)).toEqual([12, 0]);
    expect(lockAxis(2, -9)).toEqual([0, -9]);
  });
});
