import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { LightRig, DEFAULT_RIG, keyIntensity, keySize, cameraRelativeDirection } from '../../src/scene/lights';
import { acesFilmic, viewPixel, linearToSrgb } from '../../src/render/view-transform';
import { placeCamera } from '../../src/scene/camera';

describe('light rig', () => {
  it('places the key relative to the camera, whatever the orbit', () => {
    const rig = new LightRig();
    const center = new THREE.Vector3(0.2, -0.1, 0.3);
    const local: THREE.Vector3[] = [];
    for (const az of [0, 35, -60, 140]) {
      const cam = new THREE.PerspectiveCamera(20, 1, 0.1, 100);
      placeCamera(cam, az, 10, center, 6);
      rig.place(cam, center, 0.9);
      // key position in camera space, relative to the object center
      const rel = rig.key.position.clone().sub(center).applyQuaternion(cam.quaternion.clone().invert());
      local.push(rel);
    }
    for (const v of local) expect(v.distanceTo(local[0])).toBeLessThan(1e-6);
    // upper left, in front of the object
    expect(local[0].x).toBeLessThan(0);
    expect(local[0].y).toBeGreaterThan(0);
    expect(local[0].z).toBeGreaterThan(0);
    expect(local[0].length()).toBeCloseTo(DEFAULT_RIG.distance * 0.9, 6);
  });

  it('aims the key at the object', () => {
    const rig = new LightRig();
    const cam = new THREE.PerspectiveCamera(20, 1, 0.1, 100);
    placeCamera(cam, 23, 4, new THREE.Vector3(), 6);
    rig.place(cam, new THREE.Vector3(), 1);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(rig.key.quaternion);
    const toCenter = rig.key.position.clone().negate().normalize();
    expect(forward.dot(toCenter)).toBeGreaterThan(0.9999);
  });

  it('keeps key power constant when softness changes', () => {
    const power = (s: number) => keyIntensity({ softness: s, intensity: 1 }) * keySize(s) ** 2;
    expect(power(0)).toBeCloseTo(power(1), 6);
    expect(keySize(1)).toBeGreaterThan(keySize(0));
  });

  it('camera-relative directions are unit length', () => {
    const cam = new THREE.PerspectiveCamera();
    placeCamera(cam, 40, 20, new THREE.Vector3(), 5);
    expect(cameraRelativeDirection(cam, -60, 20).length()).toBeCloseTo(1, 6);
  });
});

describe('view transform', () => {
  it('filmic matches the three.js ACES fit at known points', () => {
    const out = [0, 0, 0];
    acesFilmic(0, 0, 0, out);
    expect(out[0]).toBeCloseTo(0, 3);
    // mid grey 0.18 lands near 0.21 display-linear in this fit (it divides by 0.6 first)
    acesFilmic(0.18, 0.18, 0.18, out);
    expect(out[1]).toBeGreaterThan(0.19);
    expect(out[1]).toBeLessThan(0.24);
    // highlights roll off below 1 instead of clipping
    acesFilmic(4, 4, 4, out);
    expect(out[0]).toBeLessThan(1);
    expect(out[0]).toBeGreaterThan(0.9);
  });

  it('standard is a clamp plus sRGB', () => {
    const out = [0, 0, 0];
    viewPixel(0.5, 2, -1, { transform: 'standard', exposure: 1 }, out);
    expect(out[0]).toBeCloseTo(linearToSrgb(0.5), 6);
    expect(out[1]).toBe(1);
    expect(out[2]).toBe(0);
  });

  it('exposure scales before the curve', () => {
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    viewPixel(0.2, 0.2, 0.2, { transform: 'filmic', exposure: 2 }, a);
    viewPixel(0.4, 0.4, 0.4, { transform: 'filmic', exposure: 1 }, b);
    expect(a[0]).toBeCloseTo(b[0], 6);
  });
});
