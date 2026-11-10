/**
 * Editor state around the document: selection, playhead, history, autosave.
 * Every gesture edits the document live; `commit()` closes one undo step.
 */
import { evaluate, type CameraState, type Device, type DeviceState, type Key, type Project, type TargetId, type TextLayer } from './doc';

export type Why = 'doc' | 'structure' | 'time' | 'sel';
type Track<S> = { base: S; keys: Key<S>[] };

const SAVE_KEY = 'reel:project';

export class Editor {
  doc: Project;
  time = 0;
  playing = false;
  loop = true;
  sel: TargetId | null = null;
  selKey: string | null = null;
  tool: 'rotate' | 'move' = 'rotate';
  safe = false;
  private past: string[] = [];
  private future: string[] = [];
  private saved: string;
  private subs = new Set<(why: Why) => void>();
  private saveTimer = 0;

  constructor(doc: Project) {
    this.doc = doc;
    this.saved = JSON.stringify(doc);
  }

  on(fn: (why: Why) => void) {
    this.subs.add(fn);
  }
  emit(why: Why) {
    this.subs.forEach((fn) => fn(why));
  }

  /** live edit; pass commit to close the undo step right away */
  change(fn: (p: Project) => void, opts: { commit?: boolean; structure?: boolean } = {}) {
    fn(this.doc);
    this.emit(opts.structure ? 'structure' : 'doc');
    if (opts.commit) this.commit();
  }

  commit() {
    const now = JSON.stringify(this.doc);
    if (now === this.saved) return;
    this.past.push(this.saved);
    if (this.past.length > 200) this.past.shift();
    this.future = [];
    this.saved = now;
    this.persist();
  }

  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }

  undo() {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.saved);
    this.restore(prev);
  }
  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.saved);
    this.restore(next);
  }
  private restore(json: string) {
    this.doc = JSON.parse(json) as Project;
    this.saved = json;
    if (this.sel && this.sel !== 'camera' && !this.device(this.sel) && !this.text(this.sel)) this.sel = null;
    this.selKey = null;
    this.emit('structure');
    this.persist();
  }

  load(p: Project) {
    this.doc = p;
    this.past = [];
    this.future = [];
    this.saved = JSON.stringify(p);
    this.sel = p.devices[0]?.id ?? null;
    this.selKey = null;
    this.time = Math.min(this.time, p.format.duration);
    this.emit('structure');
    this.persist();
  }

  private persist() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(SAVE_KEY, this.saved);
      } catch {
        /* storage full or blocked */
      }
    }, 400);
  }
  static stored(): Project | null {
    try {
      const s = localStorage.getItem(SAVE_KEY);
      return s ? (JSON.parse(s) as Project) : null;
    } catch {
      return null;
    }
  }

  /* ---------- lookups ---------- */

  device(id: string | null): Device | null {
    return (id && this.doc.devices.find((d) => d.id === id)) || null;
  }
  text(id: string | null): TextLayer | null {
    return (id && this.doc.texts.find((d) => d.id === id)) || null;
  }
  /** animatable track of a target */
  track(id: TargetId | null): Track<DeviceState> | Track<CameraState> | null {
    if (id === 'camera') return this.doc.camera;
    return this.device(id);
  }
  deviceState(d: Device) {
    return evaluate(d.base, d.keys, this.time);
  }
  cameraState() {
    return evaluate(this.doc.camera.base, this.doc.camera.keys, this.time);
  }
  /** the key under the selection, wherever it lives */
  findKey(id: string | null): { owner: TargetId; key: Key<DeviceState> | Key<CameraState>; track: Track<DeviceState> | Track<CameraState> } | null {
    if (!id) return null;
    const c = this.doc.camera.keys.find((k) => k.id === id);
    if (c) return { owner: 'camera', key: c, track: this.doc.camera };
    for (const d of this.doc.devices) {
      const k = d.keys.find((x) => x.id === id);
      if (k) return { owner: d.id, key: k, track: d };
    }
    return null;
  }

  setTime(t: number) {
    const d = this.doc.format.duration;
    this.time = Math.min(d, Math.max(0, t));
    this.emit('time');
  }
  select(id: TargetId | null, key: string | null = null) {
    this.sel = id;
    this.selKey = key;
    this.emit('sel');
  }
}
