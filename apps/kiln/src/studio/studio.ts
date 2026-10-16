import * as THREE from 'three/webgpu';
import { RectAreaLightTexturesLib } from 'three/examples/jsm/lights/RectAreaLightTexturesLib.js';
import { LightRig, type RigParams } from '../scene/lights';
import { greenClayEnvironment, studioTexture } from '../scene/environment';
import { orbitDirection, samplePoints, framePerspective, fitOrtho, placeCamera } from '../scene/camera';
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
    const pts = samplePoints(this.content);
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

  /** Frames the active camera for an aspect (width / height) and re-places the light rig. */
  frame(aspect: number) {
    const pts = this.points ?? this.measure();
    const { az, el, fov, padding } = this.cam;
    const dir = orbitDirection(az, el);
    if (this.cam.ortho) {
      const cam = this.orthographic;
      placeCamera(cam, az, el, this.center, this.radius * 8);
      fitOrtho(cam, this.content, padding, aspect);
    } else {
      const cam = this.perspective;
      const f = framePerspective(pts, dir, fov, aspect, padding);
      cam.fov = fov;
      cam.aspect = aspect;
      cam.near = f.near;
      cam.far = f.far;
      cam.position.copy(f.target).addScaledVector(dir, f.distance);
      cam.up.set(0, 1, 0);
      cam.lookAt(f.target);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
    }
    this.rig.place(this.camera, this.center, this.radius);
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
