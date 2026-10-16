import * as THREE from 'three/webgpu';
import { findMaterial, type MaterialSpec } from '../scene/materials';

/**
 * The scene document: plain JSON, the one source of truth for a composition. THREE objects are
 * derived from it (src/doc/runtime.ts); undo keeps copies of it (src/doc/history.ts).
 *
 * Uploaded SVG text lives in an asset table outside the document (`GlyphRef.ref`), so copies of
 * the document stay small while a drag rewrites it every frame.
 */

export type Kind = 'glyph' | 'badge' | 'coin' | 'tile' | 'pill' | 'plate' | 'percent' | 'model';
export type FormMode = 'extrude' | 'soft' | 'inflate';
export type ModelId = 'safe' | 'briefcase';

export interface Transform {
  x: number;
  y: number;
  z: number;
  /** degrees around X: lays a plate flat */
  pitch: number;
  /** degrees around Y */
  turn: number;
  /** degrees around the object's facing axis Z */
  tilt: number;
  scale: number;
}

export interface GlyphRef {
  /** display name: the Phosphor name or the uploaded file name */
  name: string;
  /** asset key: `phosphor:<name>` or `upload:<hash>` */
  ref: string;
}

/** Dock values in percent. Glyphs use all four; primitives use depth and roundness. */
export interface FormValues {
  mode: FormMode;
  depth: number;
  roundness: number;
  puff: number;
}

export interface SceneObject {
  id: string;
  name: string;
  kind: Kind;
  glyph?: GlyphRef;
  form?: FormValues;
  model?: ModelId;
  t: Transform;
  /** material per slot, see SLOTS */
  materials: Record<string, MaterialSpec>;
  /** id of the group the object belongs to (one level) */
  group?: string;
  hidden?: boolean;
}

export interface Group {
  id: string;
  name: string;
  t: Transform;
  hidden?: boolean;
}

export interface SceneDoc {
  objects: SceneObject[];
  groups: Group[];
}

/** Material slots each kind exposes in the material panel; the first is the primary one. */
export const SLOTS: Record<Kind, { id: string; name: string }[]> = {
  glyph: [{ id: 'main', name: 'Surface' }],
  coin: [{ id: 'main', name: 'Surface' }],
  tile: [{ id: 'main', name: 'Surface' }],
  plate: [{ id: 'main', name: 'Surface' }],
  percent: [{ id: 'main', name: 'Surface' }],
  model: [{ id: 'main', name: 'Surface' }],
  badge: [
    { id: 'coin', name: 'Coin' },
    { id: 'icon', name: 'Icon' },
  ],
  pill: [
    { id: 'track', name: 'Track' },
    { id: 'knob', name: 'Knob' },
  ],
};

export const KIND_NAMES: Record<Kind, string> = {
  glyph: 'Icon',
  badge: 'Badge',
  coin: 'Coin',
  tile: 'Tile',
  pill: 'Toggle',
  plate: 'Plate',
  percent: '%',
  model: 'Model',
};

/** Default form per kind (percent values, as the dock shows them). */
export const FORM_DEFAULTS: Record<FormMode, FormValues> = {
  extrude: { mode: 'extrude', depth: 22, roundness: 22, puff: 0 },
  soft: { mode: 'soft', depth: 26, roundness: 100, puff: 0 },
  inflate: { mode: 'inflate', depth: 30, roundness: 100, puff: 70 },
};

export const PRIMITIVE_DEFAULTS: Partial<Record<Kind, FormValues>> = {
  coin: { mode: 'extrude', depth: 18, roundness: 65, puff: 0 },
  badge: { mode: 'extrude', depth: 24, roundness: 40, puff: 0 },
  tile: { mode: 'extrude', depth: 14, roundness: 70, puff: 0 },
  plate: { mode: 'extrude', depth: 12, roundness: 80, puff: 0 },
  percent: { mode: 'extrude', depth: 11, roundness: 80, puff: 0 },
  pill: { mode: 'extrude', depth: 17, roundness: 80, puff: 0 },
};

export const identity = (): Transform => ({ x: 0, y: 0, z: 0, pitch: 0, turn: 0, tilt: 0, scale: 1 });

export function transform(p: Partial<Transform>): Transform {
  return { ...identity(), ...p };
}

/** Default Green clay materials for a kind's slots. */
export function defaultMaterialsFor(kind: Kind, accent = false): Record<string, MaterialSpec> {
  const green = () => ({ ...findMaterial('green-clay') });
  const orange = () => ({ ...findMaterial('orange-gradient') });
  const white = () => ({ ...findMaterial('coin-grey') });
  switch (kind) {
    case 'badge':
      return { coin: white(), icon: orange() };
    case 'pill':
      return { track: white(), knob: green() };
    case 'coin':
      return { main: white() };
    case 'percent':
      return { main: orange() };
    default:
      return { main: accent ? orange() : green() };
  }
}

let counter = 0;
/** Short unique ids: readable in tests, unique within a session and across pasted documents. */
export function newId(prefix: string) {
  counter++;
  return `${prefix}-${Date.now().toString(36).slice(-4)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

const DEG = Math.PI / 180;

/** Local matrix of a transform. Rotation order: turn (Y), then pitch (X), then tilt (Z). */
export function matrixOf(t: Transform, out = new THREE.Matrix4()) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(t.pitch * DEG, t.turn * DEG, t.tilt * DEG, 'YXZ'));
  return out.compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(t.scale, t.scale, t.scale));
}

/** Inverse of matrixOf for a uniformly scaled matrix. */
export function transformOf(m: THREE.Matrix4): Transform {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  m.decompose(p, q, s);
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  return {
    x: r(p.x),
    y: r(p.y),
    z: r(p.z),
    pitch: r(e.x / DEG),
    turn: r(e.y / DEG),
    tilt: r(e.z / DEG),
    scale: r((s.x + s.y + s.z) / 3),
  };
}

export function applyTransform(obj: THREE.Object3D, t: Transform) {
  obj.position.set(t.x, t.y, t.z);
  obj.rotation.set(t.pitch * DEG, t.turn * DEG, t.tilt * DEG, 'YXZ');
  obj.scale.setScalar(t.scale);
}

export function findObject(doc: SceneDoc, id: string) {
  return doc.objects.find((o) => o.id === id);
}

export function findGroup(doc: SceneDoc, id: string) {
  return doc.groups.find((g) => g.id === id);
}

export function childrenOf(doc: SceneDoc, groupId: string) {
  return doc.objects.filter((o) => o.group === groupId);
}

/** World matrix of an object: its group's transform, then its own. */
export function worldMatrix(doc: SceneDoc, o: SceneObject, out = new THREE.Matrix4()) {
  matrixOf(o.t, out);
  const g = o.group ? findGroup(doc, o.group) : undefined;
  if (g) out.premultiply(matrixOf(g.t));
  return out;
}
