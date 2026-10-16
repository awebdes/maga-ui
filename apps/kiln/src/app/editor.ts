import { History } from '../doc/history';
import { findGroup, findObject, type SceneDoc } from '../doc/scene';
import { emptyDoc, isGroup } from '../doc/ops';

export interface EditorEvent {
  /** the document changed */
  doc?: boolean;
  /** the change is part of a running gesture (drag, slider): no history step yet */
  live?: boolean;
  selection?: boolean;
  /** the whole document was replaced (example, undo): reframe without gliding */
  replaced?: boolean;
}

/**
 * The editor store: the document, the selection and undo. Every edit goes through `change`
 * (one undo step) or a `begin` / `live` / `end` gesture (one undo step at the end).
 */
export class Editor {
  doc: SceneDoc = emptyDoc();
  /** selected object or group ids */
  selection: string[] = [];
  /** a group the user double-clicked into: its children select one by one */
  entered: string | null = null;
  readonly history = new History();
  private gestureStart: SceneDoc | null = null;
  private listeners = new Set<(e: EditorEvent) => void>();

  subscribe(fn: (e: EditorEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: EditorEvent) {
    this.listeners.forEach((fn) => fn(e));
  }

  /** One undoable edit on a copy of the document. */
  change(fn: (draft: SceneDoc) => void) {
    if (this.gestureStart) this.end();
    const before = this.doc;
    const next = structuredClone(before);
    fn(next);
    if (JSON.stringify(next) === JSON.stringify(before)) return;
    this.history.push(before);
    this.doc = next;
    this.pruneSelection();
    this.emit({ doc: true });
  }

  /** Starts a gesture; `live` edits follow, `end` records them as one step. */
  begin() {
    if (!this.gestureStart) this.gestureStart = this.doc;
  }

  live(fn: (draft: SceneDoc) => void) {
    this.begin();
    const next = structuredClone(this.doc);
    fn(next);
    this.doc = next;
    this.emit({ doc: true, live: true });
  }

  end() {
    const start = this.gestureStart;
    this.gestureStart = null;
    if (start && JSON.stringify(start) !== JSON.stringify(this.doc)) {
      this.history.push(start);
      this.emit({ doc: true });
    }
  }

  /** Esc mid-drag: back to where the gesture started, nothing recorded. */
  cancel() {
    const start = this.gestureStart;
    this.gestureStart = null;
    if (!start) return;
    this.doc = start;
    this.pruneSelection();
    this.emit({ doc: true });
  }

  get inGesture() {
    return this.gestureStart !== null;
  }

  /** Replaces the document (an example, a new shape). Undoable. */
  load(doc: SceneDoc) {
    this.history.push(this.doc);
    this.doc = doc;
    this.selection = [];
    this.entered = null;
    this.emit({ doc: true, selection: true, replaced: true });
  }

  undo() {
    const d = this.history.undo(this.doc);
    if (d) this.restore(d);
  }

  redo() {
    const d = this.history.redo(this.doc);
    if (d) this.restore(d);
  }

  private restore(d: SceneDoc) {
    this.gestureStart = null;
    this.doc = d;
    this.pruneSelection();
    this.emit({ doc: true, selection: true });
  }

  select(ids: string[], opts: { toggle?: boolean } = {}) {
    let next: string[];
    if (opts.toggle) {
      const set = new Set(this.selection);
      for (const id of ids) {
        if (set.has(id)) set.delete(id);
        else set.add(id);
      }
      next = [...set];
    } else next = [...ids];
    const entered = this.entered;
    // leaving a group: selecting anything outside it (or nothing) closes it
    if (this.entered && (!next.length || !next.every((id) => findObject(this.doc, id)?.group === this.entered))) this.entered = null;
    if (JSON.stringify(next) === JSON.stringify(this.selection) && entered === this.entered) return;
    this.selection = next;
    this.emit({ selection: true });
  }

  /** What a click on an object selects: its group, unless the user entered that group. */
  targetOf(objectId: string): string {
    const o = findObject(this.doc, objectId);
    if (o?.group && o.group !== this.entered) return o.group;
    return objectId;
  }

  enter(groupId: string, childId: string) {
    this.entered = groupId;
    this.selection = [childId];
    this.emit({ selection: true });
  }

  /** Every top-level item, or every child of the entered group. */
  selectAll() {
    const ids = this.entered
      ? this.doc.objects.filter((o) => o.group === this.entered).map((o) => o.id)
      : [...this.doc.groups.map((g) => g.id), ...this.doc.objects.filter((o) => !o.group).map((o) => o.id)];
    this.select(ids);
  }

  /** Esc: first leave the group, then clear. */
  escape() {
    if (this.entered) {
      const g = this.entered;
      this.entered = null;
      this.selection = [g];
    } else this.selection = [];
    this.emit({ selection: true });
  }

  /** Drops ids that no longer exist after an edit or undo. */
  private pruneSelection() {
    const keep = this.selection.filter((id) => findObject(this.doc, id) || findGroup(this.doc, id));
    if (this.entered && !isGroup(this.doc, this.entered)) this.entered = null;
    if (keep.length !== this.selection.length) {
      this.selection = keep;
      this.emit({ selection: true });
    }
  }
}
