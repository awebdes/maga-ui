import * as THREE from 'three/webgpu';
import { kelvinToRgb } from './environment';

/**
 * Key light: a rectangular area light placed close to the object.
 *
 * A close, large light gives flat faces the diagonal light-to-shade gradient seen in the
 * references; lights at infinity (environment panels) shade a plane evenly. The side and top
 * lights are environment panels (`greenClayEnvironment`): the references light the right faces
 * evenly, which is what a distant panel does.
 *
 * Everything is defined relative to the camera and re-placed whenever the camera moves, so every
 * angle (and every icon in a set) is lit the same way. Placement was fitted to the reference safe
 * (`images/7.webp`) with an irradiance model: front face 2.5× brighter at the upper-left than at
 * the lower-right. Distances and sizes are in bounding radii, so the look does not depend on the
 * object's size.
 *
 * One rect light keeps light sampling cheap: the path tracer picks a light per bounce, and the
 * distant side and top lights converge faster as environment panels it importance-samples.
 */

export interface LightSpec {
  id: string;
  /** direction from the object, relative to the camera: azimuth (+ = camera right) and elevation, degrees */
  az: number;
  el: number;
  /** distance from the object center, in bounding radii */
  dist: number;
  /** size in bounding radii */
  w: number;
  h: number;
  /** radiance (three.js RectAreaLight intensity) */
  intensity: number;
  /** Kelvin; omitted = neutral */
  kelvin?: number;
}

export interface RigParams {
  /** key light direction: azimuth (deg, + = right of camera) and elevation (deg) */
  keyAz: number;
  keyEl: number;
  /** key strength multiplier */
  intensity: number;
  /** 0 = small, hard key; 1 = large, soft key. Light power stays the same. */
  softness: number;
  /** key color temperature, Kelvin */
  warmth: number;
  /** key distance from the object center, in bounding radii */
  distance: number;
}

export const DEFAULT_RIG: RigParams = { keyAz: -60, keyEl: 20, intensity: 1, softness: 0.5, warmth: 7000, distance: 1.4 };

const KEY_SIZE = 1.4; // at softness 0.5
const KEY_INTENSITY = 2.9;

/** Extra rect lights besides the key, for looks that need more than one close light. */
export const GREEN_CLAY_RIG: LightSpec[] = [];

const DEG = Math.PI / 180;

/** Key size in bounding radii for a softness value. */
export function keySize(softness: number) {
  return KEY_SIZE * (0.45 + 1.1 * Math.min(1, Math.max(0, softness)));
}

/** Key radiance for a softness value: constant power, so radiance scales with 1 / area. */
export function keyIntensity(params: Pick<RigParams, 'softness' | 'intensity'>) {
  return KEY_INTENSITY * params.intensity * (KEY_SIZE / keySize(params.softness)) ** 2;
}

/** Direction from the object toward a light, in world space, for camera-relative az/el. */
export function cameraRelativeDirection(camera: THREE.Camera, az: number, el: number, out = new THREE.Vector3()) {
  camera.updateMatrixWorld(true);
  const e = camera.matrixWorld.elements;
  // camera matrix columns: right, up, toward the viewer (the camera looks down -Z)
  const a = az * DEG;
  const b = el * DEG;
  const x = Math.sin(a) * Math.cos(b);
  const y = Math.sin(b);
  const z = Math.cos(a) * Math.cos(b);
  out.set(e[0] * x + e[4] * y + e[8] * z, e[1] * x + e[5] * y + e[9] * z, e[2] * x + e[6] * y + e[10] * z);
  return out.normalize();
}

export class LightRig {
  readonly group = new THREE.Group();
  readonly key: THREE.RectAreaLight;
  private extras = new Map<string, THREE.RectAreaLight>();
  params: RigParams = { ...DEFAULT_RIG };

  constructor(private specs: LightSpec[] = GREEN_CLAY_RIG) {
    this.group.name = 'light-rig';
    this.key = new THREE.RectAreaLight(0xffffff, 1, 1, 1);
    this.key.name = 'key';
    this.group.add(this.key);
    for (const s of specs) {
      const l = new THREE.RectAreaLight(0xffffff, 1, 1, 1);
      l.name = s.id;
      this.extras.set(s.id, l);
      this.group.add(l);
    }
  }

  set(params: Partial<RigParams>) {
    Object.assign(this.params, params);
  }

  /**
   * Places every light around `center` (world) for the given camera, scaled to `radius`.
   * Call after the camera moves, the object changes size, or the params change.
   */
  place(camera: THREE.Camera, center: THREE.Vector3, radius: number) {
    const p = this.params;
    const dir = new THREE.Vector3();

    cameraRelativeDirection(camera, p.keyAz, p.keyEl, dir);
    const size = keySize(p.softness) * radius;
    this.key.position.copy(center).addScaledVector(dir, p.distance * radius);
    this.key.width = size;
    this.key.height = size * 0.85;
    this.key.intensity = keyIntensity(p);
    const kc = kelvinToRgb(p.warmth);
    this.key.color.setRGB(kc[0], kc[1], kc[2], THREE.LinearSRGBColorSpace);
    this.key.lookAt(center);

    for (const s of this.specs) {
      const l = this.extras.get(s.id)!;
      cameraRelativeDirection(camera, s.az, s.el, dir);
      l.position.copy(center).addScaledVector(dir, s.dist * radius);
      l.width = s.w * radius;
      l.height = s.h * radius;
      l.intensity = s.intensity;
      const c = s.kelvin ? kelvinToRgb(s.kelvin) : ([1, 1, 1] as const);
      l.color.setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace);
      l.lookAt(center);
    }
    this.group.updateMatrixWorld(true);
  }

  /** Light handle positions for UI: key direction relative to the camera. */
  get keyDirection() {
    return { az: this.params.keyAz, el: this.params.keyEl };
  }
}
