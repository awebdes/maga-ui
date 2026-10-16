/**
 * Direct manipulation on the stage: click selects (topmost layer, images on their alpha), drag
 * moves with snapping to the slot's 16px margins, its centre and the other layers, corners scale
 * about the centre, the knob rotates (Shift: 15° steps), Shift-drag locks an axis, Esc cancels,
 * arrows nudge (Shift ×10) as one undo step. A press slops 3px before it becomes a drag.
 */
import { findLayer, frameBounds, moveLayer, rotatable, scaleLayer, setRotation, type BannerDoc, type Frame } from '../engine';
import { kit } from '../ui/kit/core';
import type { Guide, Handle, Placement, Stage } from './stage';
import type { Editor } from './state';

type Gesture =
  | { kind: 'press'; id: string; p: Placement; sx: number; sy: number; start: Frame }
  | { kind: 'drag'; id: string; p: Placement; sx: number; sy: number; start: Frame }
  | { kind: 'scale'; id: string; p: Placement; cx: number; cy: number; d0: number }
  | { kind: 'rotate'; id: string; p: Placement; cx: number; cy: number; a0: number; rot0: number };

const SLOP = 3;
const SNAP_PX = 6;

export class Manipulator {
  private g: Gesture | null = null;
  private nudgeTimer = 0;

  constructor(
    private editor: Editor,
    private stage: Stage,
    private surface: HTMLElement,
    private hooks: { onDoubleClick: (id: string) => void; onSelectLang: (lang: Placement['lang']) => void },
  ) {
    surface.addEventListener('pointerdown', (e) => this.down(e));
    surface.addEventListener('pointermove', (e) => this.move(e));
    surface.addEventListener('pointerup', (e) => this.up(e));
    surface.addEventListener('pointercancel', () => this.cancel());
    surface.addEventListener('dblclick', (e) => this.dbl(e));
    surface.addEventListener('pointerleave', () => {
      if (!this.g && this.stage.hover) {
        this.stage.hover = null;
        this.stage.invalidate();
      }
    });
  }

  get active() {
    return this.g !== null && this.g.kind !== 'press';
  }

  private down(e: PointerEvent) {
    if (e.button !== 0 || this.editor.mode !== 'editor' || !this.editor.doc) return;
    const handle = this.stage.hitHandle(e.clientX, e.clientY);
    const sel = this.editor.selection;
    const pa = this.stage.active;
    if (handle && sel && pa) {
      e.preventDefault();
      this.startHandle(handle, sel, pa, e);
      return;
    }
    const p = this.stage.placementAt(e.clientX, e.clientY, 12);
    if (!p) {
      this.editor.select(null);
      return;
    }
    if (!p.active) this.hooks.onSelectLang(p.lang);
    const [x, y] = this.stage.toDesign(p, e.clientX, e.clientY);
    const id = this.stage.hitLayer(p, x, y);
    this.editor.select(id);
    if (!id) return;
    const f = this.stage.frameOf(id, p.lang);
    if (!f) return;
    e.preventDefault();
    this.surface.setPointerCapture(e.pointerId);
    this.g = { kind: 'press', id, p, sx: e.clientX, sy: e.clientY, start: { ...f } };
  }

  private startHandle(h: Handle, id: string, p: Placement, e: PointerEvent) {
    const f = this.stage.frameOf(id, p.lang);
    const l = this.editor.doc && findLayer(this.editor.doc, id);
    if (!f || !l) return;
    this.surface.setPointerCapture(e.pointerId);
    const [cx, cy] = this.stage.toScreen(p, f.cx, f.cy);
    this.editor.begin();
    kit.busy = true;
    if (h.kind === 'scale') this.g = { kind: 'scale', id, p, cx, cy, d0: Math.max(4, Math.hypot(e.clientX - cx, e.clientY - cy)) };
    else this.g = { kind: 'rotate', id, p, cx, cy, a0: Math.atan2(e.clientY - cy, e.clientX - cx), rot0: 'rot' in l ? l.rot : 0 };
    this.surface.dataset.gesture = h.kind;
  }

  private move(e: PointerEvent) {
    const g = this.g;
    if (!g) {
      this.hoverAt(e);
      return;
    }
    if (g.kind === 'press') {
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < SLOP) return;
      this.g = { ...g, kind: 'drag' };
      this.editor.begin();
      kit.busy = true;
      this.surface.dataset.gesture = 'drag';
    }
    const cur = this.g!;
    if (cur.kind === 'drag') this.drag(cur, e);
    else if (cur.kind === 'scale') {
      const f = Math.max(0.15, Math.min(6, Math.hypot(e.clientX - cur.cx, e.clientY - cur.cy) / cur.d0));
      this.editor.live((d) => scaleLayer(d, cur.id, f), { fromStart: true });
    } else if (cur.kind === 'rotate') {
      let deg = cur.rot0 + ((Math.atan2(e.clientY - cur.cy, e.clientX - cur.cx) - cur.a0) * 180) / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      else if (Math.abs(deg - Math.round(deg / 90) * 90) < 2.5) deg = Math.round(deg / 90) * 90;
      this.editor.live((d) => setRotation(d, cur.id, deg), { fromStart: true });
    }
  }

  private drag(g: Extract<Gesture, { kind: 'drag' }>, e: PointerEvent) {
    let dx = (e.clientX - g.sx) / g.p.zoom;
    let dy = (e.clientY - g.sy) / g.p.zoom;
    if (e.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    const snapped = this.snap(g, dx, dy, e.altKey);
    this.stage.guides = snapped.guides;
    this.editor.live((d) => moveLayer(d, g.id, snapped.dx, snapped.dy), { fromStart: true });
  }

  /** Snaps the moving frame's edges and centre to the slot margins, its centre and other layers. */
  private snap(g: Extract<Gesture, { kind: 'drag' }>, dx: number, dy: number, off: boolean) {
    const doc = this.editor.doc as BannerDoc;
    const guides: Guide[] = [];
    if (off) return { dx, dy, guides };
    const th = SNAP_PX / g.p.zoom;
    const b = frameBounds({ ...g.start, cx: g.start.cx + dx, cy: g.start.cy + dy });
    const xs = [b.x, (b.x + b.right) / 2, b.right];
    const ys = [b.y, (b.y + b.bottom) / 2, b.bottom];
    const W = doc.format.w;
    const H = doc.format.h;
    const lineX = [16, W / 2, W - 16];
    const lineY = [16, H / 2, H - 16];
    const lay = this.editor.layout(g.p.lang);
    for (const l of doc.layers) {
      if (l.id === g.id || l.hidden || l.kind === 'glow') continue;
      const f = lay?.frames[l.id];
      if (!f) continue;
      const o = frameBounds(f);
      lineX.push(o.x, (o.x + o.right) / 2, o.right);
      lineY.push(o.y, (o.y + o.bottom) / 2, o.bottom);
    }
    const best = (vals: number[], lines: number[]) => {
      let pick: { d: number; at: number } | null = null;
      for (const v of vals) for (const at of lines) {
        const d = at - v;
        if (Math.abs(d) <= th && (!pick || Math.abs(d) < Math.abs(pick.d))) pick = { d, at };
      }
      return pick;
    };
    const sx = best(xs, lineX);
    const sy = best(ys, lineY);
    if (sx) {
      dx += sx.d;
      guides.push({ axis: 'x', at: sx.at });
    }
    if (sy) {
      dy += sy.d;
      guides.push({ axis: 'y', at: sy.at });
    }
    return { dx, dy, guides };
  }

  private up(e: PointerEvent) {
    const g = this.g;
    this.g = null;
    if (this.surface.hasPointerCapture(e.pointerId)) this.surface.releasePointerCapture(e.pointerId);
    delete this.surface.dataset.gesture;
    kit.busy = false;
    if (!g || g.kind === 'press') return;
    this.stage.guides = [];
    this.editor.end();
    this.stage.invalidate();
  }

  /** Esc mid-gesture: back to where it started, nothing recorded. */
  cancel() {
    if (!this.g) return false;
    const was = this.g.kind;
    this.g = null;
    delete this.surface.dataset.gesture;
    kit.busy = false;
    this.stage.guides = [];
    if (was !== 'press') this.editor.cancel();
    this.stage.invalidate();
    return was !== 'press';
  }

  private dbl(e: MouseEvent) {
    if (this.editor.mode !== 'editor') return;
    const p = this.stage.placementAt(e.clientX, e.clientY);
    if (!p) return;
    const [x, y] = this.stage.toDesign(p, e.clientX, e.clientY);
    const id = this.stage.hitLayer(p, x, y);
    const l = id && this.editor.doc ? findLayer(this.editor.doc, id) : null;
    if (l && (l.kind === 'text' || l.kind === 'badge' || l.kind === 'badgeRow' || l.kind === 'stat')) this.hooks.onDoubleClick(l.id);
  }

  private hoverAt(e: PointerEvent) {
    if (this.editor.mode !== 'editor') return;
    const handle = this.stage.hitHandle(e.clientX, e.clientY);
    let cursor = '';
    let hover: string | null = null;
    if (handle) cursor = handle.kind === 'rotate' ? 'grab' : 'nwse-resize';
    else {
      const p = this.stage.placementAt(e.clientX, e.clientY);
      if (p) {
        const [x, y] = this.stage.toDesign(p, e.clientX, e.clientY);
        hover = this.stage.hitLayer(p, x, y);
        cursor = hover ? 'move' : 'default';
      }
    }
    this.surface.style.cursor = cursor;
    if (hover !== this.stage.hover) {
      this.stage.hover = hover;
      this.stage.invalidate();
    }
  }

  /** Arrow keys: move the selection 1 design px (Shift 10); a burst is one undo step. */
  nudge(dx: number, dy: number) {
    const id = this.editor.selection;
    if (!id || !this.editor.doc) return;
    this.editor.begin();
    this.editor.live((d) => moveLayer(d, id, dx, dy));
    clearTimeout(this.nudgeTimer);
    this.nudgeTimer = window.setTimeout(() => this.editor.end(), 600);
  }

  /** Rotation by keyboard ([ and ]), one step per press. */
  rotateBy(deg: number) {
    const id = this.editor.selection;
    const l = id && this.editor.doc ? findLayer(this.editor.doc, id) : null;
    if (!l || !rotatable(l) || !('rot' in l)) return;
    this.editor.change((d) => setRotation(d, l.id, l.rot + deg));
  }
}
