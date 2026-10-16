import * as THREE from 'three/webgpu';
import type { MaterialSpec } from '../scene/materials';
import {
  FORM_DEFAULTS,
  KIND_NAMES,
  PRIMITIVE_DEFAULTS,
  childrenOf,
  defaultMaterialsFor,
  findGroup,
  findObject,
  identity,
  matrixOf,
  newId,
  transform,
  transformOf,
  worldMatrix,
  type FormMode,
  type FormValues,
  type GlyphRef,
  type Group,
  type Kind,
  type ModelId,
  type SceneDoc,
  type SceneObject,
  type Transform,
} from './scene';

/**
 * Edits on a draft document. Every op mutates the draft it is given; the editor store clones the
 * document first, so history snapshots stay untouched.
 *
 * Selection ids name either an object or a group.
 */

export function emptyDoc(): SceneDoc {
  return { objects: [], groups: [] };
}

export function isGroup(doc: SceneDoc, id: string) {
  return doc.groups.some((g) => g.id === id);
}

/** The transform an id edits: a group's own, or an object's (relative to its group). */
export function transformRef(doc: SceneDoc, id: string): Transform | undefined {
  return findGroup(doc, id)?.t ?? findObject(doc, id)?.t;
}

export function addObject(doc: SceneDoc, o: SceneObject) {
  doc.objects.push(o);
  return o.id;
}

export function setTransform(doc: SceneDoc, id: string, patch: Partial<Transform>) {
  const t = transformRef(doc, id);
  if (t) Object.assign(t, patch);
}

export function setForm(doc: SceneDoc, id: string, patch: Partial<FormValues>) {
  const o = findObject(doc, id);
  if (o?.form) Object.assign(o.form, patch);
}

export function setGlyph(doc: SceneDoc, id: string, glyph: GlyphRef) {
  const o = findObject(doc, id);
  if (!o || (o.kind !== 'glyph' && o.kind !== 'badge')) return;
  o.glyph = { ...glyph };
  if (o.kind === 'glyph') o.name = glyph.name.replace(/-/g, ' ');
}

export function setMaterial(doc: SceneDoc, id: string, slot: string, spec: MaterialSpec) {
  const o = findObject(doc, id);
  if (o && slot in o.materials) o.materials[slot] = { ...spec };
}

export function rename(doc: SceneDoc, id: string, name: string) {
  const item = findGroup(doc, id) ?? findObject(doc, id);
  const clean = name.trim().slice(0, 48);
  if (item && clean) item.name = clean;
}

export function setHidden(doc: SceneDoc, id: string, hidden: boolean) {
  const item = findGroup(doc, id) ?? findObject(doc, id);
  if (item) item.hidden = hidden || undefined;
}

/** Removes objects and groups (a group takes its children with it); empty groups go too. */
export function remove(doc: SceneDoc, ids: string[]) {
  const gone = new Set(ids);
  doc.objects = doc.objects.filter((o) => !gone.has(o.id) && !(o.group && gone.has(o.group)));
  doc.groups = doc.groups.filter((g) => !gone.has(g.id) && doc.objects.some((o) => o.group === g.id));
}

export const DUPLICATE_OFFSET = { x: 0.1, y: -0.1, z: 0.02 };
export const NO_OFFSET = { x: 0, y: 0, z: 0 };

function cloneObject(o: SceneObject, patch: Partial<SceneObject> = {}): SceneObject {
  return { ...structuredClone(o), id: newId('obj'), ...patch };
}

/**
 * Duplicates objects and groups next to the originals (Alt-drag passes NO_OFFSET). Returns the
 * new ids, in order.
 */
export function duplicate(doc: SceneDoc, ids: string[], offset = DUPLICATE_OFFSET) {
  const out: string[] = [];
  for (const id of ids) {
    const g = findGroup(doc, id);
    if (g) {
      const ng: Group = { ...structuredClone(g), id: newId('grp'), name: `${g.name} copy` };
      ng.t.x = round(ng.t.x + offset.x);
      ng.t.y = round(ng.t.y + offset.y);
      ng.t.z = round(ng.t.z + offset.z);
      doc.groups.push(ng);
      for (const c of childrenOf(doc, g.id)) doc.objects.push(cloneObject(c, { group: ng.id }));
      out.push(ng.id);
      continue;
    }
    const o = findObject(doc, id);
    if (!o) continue;
    const c = cloneObject(o);
    // inside a group the offset is in the group's space, close enough for a nudge
    c.t.x = round(c.t.x + offset.x);
    c.t.y = round(c.t.y + offset.y);
    c.t.z = round(c.t.z + offset.z);
    doc.objects.push(c);
    out.push(c.id);
  }
  return out;
}

/** Drops objects whose group is selected too, so a move doesn't apply twice. */
export function topLevel(doc: SceneDoc, ids: string[]) {
  const set = new Set(ids);
  return ids.filter((id) => {
    const o = findObject(doc, id);
    return !(o?.group && set.has(o.group));
  });
}

/** Objects an id stands for: a group's children, or the object itself. */
export function objectsOf(doc: SceneDoc, ids: string[]) {
  const out: SceneObject[] = [];
  for (const id of ids) {
    if (isGroup(doc, id)) out.push(...childrenOf(doc, id));
    else {
      const o = findObject(doc, id);
      if (o) out.push(o);
    }
  }
  return [...new Set(out)];
}

/** Takes objects out of their group, keeping where they are in the world. */
function detach(doc: SceneDoc, o: SceneObject) {
  if (!o.group) return;
  o.t = transformOf(worldMatrix(doc, o));
  o.group = undefined;
}

/**
 * Groups the given objects and groups into one new group placed at their center, so nothing
 * moves on screen. Groups don't nest: grouping groups merges their children.
 */
export function group(doc: SceneDoc, ids: string[], name = 'Group'): string | null {
  const members = objectsOf(doc, ids);
  if (members.length < 2) return null;
  const center = new THREE.Vector3();
  const m = new THREE.Matrix4();
  for (const o of members) center.add(new THREE.Vector3().setFromMatrixPosition(worldMatrix(doc, o, m)));
  center.divideScalar(members.length);
  for (const o of members) detach(doc, o);
  doc.groups = doc.groups.filter((g) => doc.objects.some((o) => o.group === g.id));
  const g: Group = { id: newId('grp'), name, t: { ...identity(), x: round(center.x), y: round(center.y), z: round(center.z) } };
  doc.groups.push(g);
  const inv = matrixOf(g.t).invert();
  for (const o of members) {
    o.t = transformOf(new THREE.Matrix4().multiplyMatrices(inv, matrixOf(o.t)));
    o.group = g.id;
  }
  return g.id;
}

/** Dissolves a group, keeping its children where they are. Returns the children ids. */
export function ungroup(doc: SceneDoc, id: string): string[] {
  const g = findGroup(doc, id);
  if (!g) return [];
  const kids = childrenOf(doc, id);
  for (const o of kids) detach(doc, o);
  doc.groups = doc.groups.filter((x) => x.id !== id);
  return kids.map((o) => o.id);
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

export interface NewObject {
  glyph?: GlyphRef;
  model?: ModelId;
  mode?: FormMode;
  t?: Partial<Transform>;
  /** accent materials (orange): satellites next to a green hero */
  accent?: boolean;
}

/** A new object of a kind with its default form and materials. */
export function makeObject(kind: Kind, opts: NewObject = {}): SceneObject {
  const form =
    kind === 'glyph' ? { ...FORM_DEFAULTS[opts.mode ?? 'soft'] } : PRIMITIVE_DEFAULTS[kind] ? { ...PRIMITIVE_DEFAULTS[kind]! } : undefined;
  const name = kind === 'glyph' && opts.glyph ? opts.glyph.name.replace(/-/g, ' ') : kind === 'model' ? (opts.model === 'briefcase' ? 'Briefcase' : 'Safe') : KIND_NAMES[kind];
  return {
    id: newId('obj'),
    name,
    kind,
    t: transform(opts.t ?? {}),
    materials: defaultMaterialsFor(kind, opts.accent),
    ...(form ? { form } : {}),
    ...(opts.glyph ? { glyph: { ...opts.glyph } } : {}),
    ...(kind === 'model' ? { model: opts.model ?? 'safe' } : {}),
  };
}

/**
 * Icon ↔ badge (the icon on a coin). The icon keeps its material: on a badge it moves to the
 * icon slot, the coin gets the coin default.
 */
export function setKind(doc: SceneDoc, id: string, kind: 'glyph' | 'badge', mode: FormMode = 'soft') {
  const o = findObject(doc, id);
  if (!o || o.kind === kind || (o.kind !== 'glyph' && o.kind !== 'badge')) return;
  if (kind === 'badge') {
    const icon = o.materials.main;
    o.kind = 'badge';
    o.form = { ...PRIMITIVE_DEFAULTS.badge! };
    o.materials = { ...defaultMaterialsFor('badge'), ...(icon ? { icon } : {}) };
  } else {
    const icon = o.materials.icon;
    o.kind = 'glyph';
    o.form = { ...FORM_DEFAULTS[mode] };
    o.materials = icon ? { main: icon } : defaultMaterialsFor('glyph');
  }
}
