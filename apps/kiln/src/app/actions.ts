import * as THREE from 'three/webgpu';
import { clamp } from '../ui/kit/core';
import { addObject, duplicate, group, isGroup, makeObject, remove, rename, setHidden, topLevel, ungroup, type NewObject } from '../doc/ops';
import { findGroup, findObject, worldMatrix, type GlyphRef, type Kind, type Transform } from '../doc/scene';
import type { SceneRuntime } from '../doc/runtime';
import type { Editor } from './editor';
import type { Viewport } from './viewport';
import { worldBox } from './bounds';

const round = (v: number) => Math.round(v * 1e4) / 1e4;

/** Commands shared by the keyboard, the selection bar, the layers list and the menus. */
export class Actions {
  constructor(
    private editor: Editor,
    private runtime: SceneRuntime,
    private view: Viewport,
  ) {}

  /**
   * Where a new object lands: lower right, in front of what is already there, at satellite size.
   * An empty scene gets it at the origin, full size.
   */
  private placement(): Partial<Transform> {
    const { doc } = this.editor;
    const ids = [...doc.groups.map((g) => g.id), ...doc.objects.filter((o) => !o.group).map((o) => o.id)];
    const box = worldBox(this.runtime, ids);
    if (box.isEmpty()) return {};
    const center = box.getCenter(new THREE.Vector3());
    const r = Math.max(0.2, box.getSize(new THREE.Vector3()).length() / 2);
    const cam = this.view.studio.camera;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const toward = cam.getWorldDirection(new THREE.Vector3()).negate();
    const p = center.addScaledVector(right, 0.6 * r).addScaledVector(up, -0.36 * r).addScaledVector(toward, 0.45 * r);
    // adding several in a row: step off the ones already there
    const m = new THREE.Matrix4();
    const taken = doc.objects.map((o) => new THREE.Vector3().setFromMatrixPosition(worldMatrix(doc, o, m)));
    for (let i = 0; i < 12 && taken.some((q) => q.distanceTo(p) < 0.06 * r); i++) p.add(new THREE.Vector3(0.09, -0.09, 0.03).multiplyScalar(r));
    return { x: round(p.x), y: round(p.y), z: round(p.z), scale: round(clamp((0.4 * r) / 0.8, 0.08, 4)) };
  }

  add(kind: Kind, opts: NewObject = {}) {
    const { editor } = this;
    const o = makeObject(kind, { accent: editor.doc.objects.length > 0, ...opts, t: this.placement() });
    editor.change((d) => addObject(d, o));
    editor.select([o.id]);
    return o.id;
  }

  addGlyph(glyph: GlyphRef) {
    return this.add('glyph', { glyph });
  }

  duplicate() {
    const { editor } = this;
    const ids = topLevel(editor.doc, editor.selection);
    if (!ids.length) return;
    let out: string[] = [];
    editor.change((d) => (out = duplicate(d, ids)));
    editor.select(out);
  }

  remove() {
    const { editor } = this;
    if (!editor.selection.length) return;
    const ids = [...editor.selection];
    editor.change((d) => remove(d, ids));
    editor.select([]);
  }

  /** Groups two or more items; groups don't nest, grouping groups merges them. */
  group() {
    const { editor } = this;
    const ids = topLevel(editor.doc, editor.selection);
    if (ids.length < 2) return;
    let gid: string | null = null;
    editor.change((d) => (gid = group(d, ids, `Group ${d.groups.length + 1}`)));
    if (gid) editor.select([gid]);
  }

  ungroup() {
    const { editor } = this;
    const gids = editor.selection.filter((id) => isGroup(editor.doc, id));
    if (!gids.length) return;
    const kids: string[] = [];
    editor.change((d) => gids.forEach((g) => kids.push(...ungroup(d, g))));
    editor.select(kids);
  }

  canGroup() {
    return topLevel(this.editor.doc, this.editor.selection).length >= 2;
  }

  canUngroup() {
    return this.editor.selection.some((id) => isGroup(this.editor.doc, id));
  }

  /** Hides the items, or shows them when all are hidden already. */
  toggleHidden(ids: string[]) {
    const { doc } = this.editor;
    const hidden = (id: string) => (findGroup(doc, id) ?? findObject(doc, id))?.hidden === true;
    const hide = !ids.every(hidden);
    this.editor.change((d) => ids.forEach((id) => setHidden(d, id, hide)));
  }

  rename(id: string, name: string) {
    this.editor.change((d) => rename(d, id, name));
  }
}
