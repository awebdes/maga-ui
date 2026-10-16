import * as THREE from 'three/webgpu';
import { RectAreaLightTexturesLib } from 'three/examples/jsm/lights/RectAreaLightTexturesLib.js';
import { LightRig, type RigParams } from '../scene/lights';
import { greenClayEnvironment, studioTexture } from '../scene/environment';
import { orbitDirection, samplePoints, framePerspective, fitOrthoPoints, placeCamera } from '../scene/camera';
import { DEFAULT_VIEW, type ViewSettings } from '../render/view-transform';

/**
 * The scene every renderer reads: content, camera, light rig, fill environment and the view
 * transform. The viewport, the idle path tracer and exports all go through one Studio, so the
 * preview, the traced viewport and the exported PNG are lit and framed the same way.
 */

export interface CameraState {
  /** orbit, degrees: 0 = front, + = camera moves to the object's right */
  az: number;
  el: number;
  ortho: boolean;
  /** vertical field of view of the perspective camera, degrees */
  fov: number;
  /** empty margin on each side, fraction of the frame */
  padding: number;
}

export const DEFAULT_CAMERA: CameraState = { az: 23, el: 4, ortho: false, fov: 20, padding: 0.14 };

interface Framing {
  ortho: boolean;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  near: number;
  far: number;
  /** orthographic left, right, top, bottom */
  bounds: [number, number, number, number];
  /** light rig placement */
  center: THREE.Vector3;
  radius: number;
}

const EMPTY_POINTS = new Float32Array([-0.5, -0.5, -0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, -0.5, -0.5]);

let ltcReady = false;
/** Raster preview needs the LTC tables for rect area lights; the path tracer doesn't. */
function initAreaLights() {
  if (ltcReady) return;
  THREE.RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
  ltcReady = true;
}

export class Studio {
  readonly scene = new THREE.Scene();
  readonly content = new THREE.Group();
  readonly rig = new LightRig();
  readonly perspective = new THREE.PerspectiveCamera(20, 1, 0.01, 100);
  readonly orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  readonly cam: CameraState = { ...DEFAULT_CAMERA };
  readonly view: ViewSettings = { ...DEFAULT_VIEW };
  /** bounding sphere of the content, for the light rig */
  readonly center = new THREE.Vector3();
  radius = 1;
  private points: Float32Array | null = null;
  private aspect = 1;
  private frozen = false;
  private current: Framing | null = null;
  private goal: Framing | null = null;

  constructor(readonly renderer: THREE.WebGPURenderer) {
    initAreaLights();
    this.scene.background = null;
    this.scene.environment = studioTexture(greenClayEnvironment());
    this.content.name = 'content';
    this.scene.add(this.content, this.rig.group);
    this.applyView();
  }

  get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.cam.ortho ? this.orthographic : this.perspective;
  }

  /** Replaces the content. The previous children are returned so the caller can dispose them. */
  setContent(...objects: THREE.Object3D[]): THREE.Object3D[] {
    const old = [...this.content.children];
    this.content.clear();
    if (objects.length) this.content.add(...objects);
    this.contentChanged();
    return old;
  }

  /** Call after the content's geometry or transforms change. */
  contentChanged() {
    this.points = null;
  }

  setCamera(c: Partial<CameraState>) {
    Object.assign(this.cam, c);
  }

  setRig(p: Partial<RigParams>) {
    this.rig.set(p);
  }

  setView(v: Partial<ViewSettings>) {
    Object.assign(this.view, v);
    this.applyView();
  }

  private applyView() {
    this.renderer.toneMapping = this.view.transform === 'filmic' ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = this.view.exposure;
  }

  private measure() {
    let pts = samplePoints(this.content);
    // nothing visible: frame a unit box at the origin, so the camera holds a sane pose
    if (!pts.length) pts = EMPTY_POINTS;
    this.points = pts;
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < pts.length; i += 3) box.expandByPoint(v.set(pts[i], pts[i + 1], pts[i + 2]));
    if (box.isEmpty()) {
      this.center.set(0, 0, 0);
      this.radius = 1;
      return pts;
    }
    box.getCenter(this.center);
    let r2 = 0;
    for (let i = 0; i < pts.length; i += 3) r2 = Math.max(r2, v.set(pts[i], pts[i + 1], pts[i + 2]).distanceToSquared(this.center));
    this.radius = Math.max(1e-3, Math.sqrt(r2));
    return pts;
  }

  /**
   * Frames the active camera for an aspect (width / height) and re-places the light rig.
   * `glide` eases from the current framing to the new one (see `step`); a frozen studio keeps its
   * framing, so the camera holds still while objects are dragged.
   */
  frame(aspect: number, glide = false) {
    this.aspect = aspect;
    if (this.frozen) return;
    const goal = this.computeFraming(aspect);
    if (glide && this.current && this.current.ortho === goal.ortho) {
      this.goal = goal;
      return;
    }
    this.current = goal;
    this.goal = null;
    this.apply(goal);
  }

  /** Re-places the light rig on the current framing (after a rig change). */
  refreshRig() {
    const f = this.current;
    if (f) this.rig.place(this.camera, f.center, f.radius);
  }

  /** Holds the framing while the user drags objects; `unfreeze` lets it glide to the new fit. */
  freeze() {
    this.frozen = true;
  }

  unfreeze(glide = true) {
    this.frozen = false;
    this.frame(this.aspect, glide);
  }

  get isFrozen() {
    return this.frozen;
  }

  /** Advances a glide. Returns true while the camera is still moving. */
  step(dt: number): boolean {
    const { current: c, goal: g } = this;
    if (!c || !g) return false;
    const k = 1 - Math.exp(-dt / 0.11);
    const lerp = (a: number, b: number) => a + (b - a) * k;
    c.pos.lerp(g.pos, k);
    c.target.lerp(g.target, k);
    c.center.lerp(g.center, k);
    c.radius = lerp(c.radius, g.radius);
    c.near = Math.min(c.near, g.near);
    c.far = Math.max(c.far, g.far);
    for (let i = 0; i < 4; i++) c.bounds[i] = lerp(c.bounds[i], g.bounds[i]);
    const done = c.pos.distanceTo(g.pos) < 1e-4 * g.radius && c.target.distanceTo(g.target) < 1e-4 * g.radius && Math.abs(c.radius - g.radius) < 1e-4;
    if (done) {
      this.current = g;
      this.goal = null;
    }
    this.apply(this.current!);
    return !done;
  }

  private computeFraming(aspect: number): Framing {
    const pts = this.points ?? this.measure();
    const { az, el, fov, padding } = this.cam;
    const dir = orbitDirection(az, el);
    if (this.cam.ortho) {
      const cam = this.orthographic;
      placeCamera(cam, az, el, this.center, this.radius * 8);
      fitOrthoPoints(cam, pts, padding, aspect);
      return {
        ortho: true,
        pos: cam.position.clone(),
        target: this.center.clone(),
        near: cam.near,
        far: cam.far,
        bounds: [cam.left, cam.right, cam.top, cam.bottom],
        center: this.center.clone(),
        radius: this.radius,
      };
    }
    const f = framePerspective(pts, dir, fov, aspect, padding);
    return {
      ortho: false,
      pos: f.target.clone().addScaledVector(dir, f.distance),
      target: f.target.clone(),
      near: f.near,
      far: f.far,
      bounds: [0, 0, 0, 0],
      center: this.center.clone(),
      radius: this.radius,
    };
  }

  private apply(f: Framing) {
    const { az, fov } = this.cam;
    if (f.ortho) {
      const cam = this.orthographic;
      cam.position.copy(f.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(f.target);
      [cam.left, cam.right, cam.top, cam.bottom] = f.bounds;
      cam.near = f.near;
      cam.far = f.far;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
    } else {
      const cam = this.perspective;
      cam.fov = fov;
      cam.aspect = this.aspect;
      cam.near = f.near;
      cam.far = f.far;
      cam.position.copy(f.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(f.target);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
    }
    this.rig.place(this.camera, f.center, f.radius);
    // the environment's side and top panels follow the camera like the key does
    this.scene.environmentRotation.set(0, (az * Math.PI) / 180, 0);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** Pixel position of a world point in a frame of the given size (top-left origin). */
  project(p: THREE.Vector3, width: number, height: number) {
    const v = p.clone().project(this.camera);
    return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height };
  }
}
