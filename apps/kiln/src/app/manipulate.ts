import * as THREE from 'three/webgpu';
import { clamp, kit } from '../ui/kit/core';
import { NO_OFFSET, duplicate, topLevel } from '../doc/ops';
import { findObject } from '../doc/scene';
import { dragDelta, lockAxis, moveBy, rotateBy, scaleBy, snap, startsOf, wrap180, type Start } from '../doc/manipulate';
import type { SceneRuntime } from '../doc/runtime';
import type { Editor } from './editor';
import type { Viewport } from './viewport';
import type { Picker } from './picking';
import type { Overlay } from './overlay';
import { toScreen, worldBox, type Rect } from './bounds';

type Press =
  | { kind: 'move'; x: number; y: number; anchor: THREE.Vector3; alt: boolean; target: string | null; wasSelected: boolean }
  | { kind: 'orbit'; x: number; y: number; shift: boolean }
  | { kind: 'none' };

type Gesture =
  | { kind: 'move'; starts: Start[]; anchor: THREE.Vector3; x0: number; y0: number }
  | { kind: 'orbit'; x: number; y: number; t: number; vx: number; vy: number }
  | { kind: 'scale'; starts: Start[]; center: THREE.Vector3; cx: number; cy: number; d0: number; base: number }
  | { kind: 'tilt'; starts: Start[]; center: THREE.Vector3; cx: number; cy: number; prev: number; acc: number; sign: number; base: number };

/** pointer travel before a press becomes a drag, px */
const SLOP = 4;
const DEG = 180 / Math.PI;

const inside = (r: Rect | null, x: number, y: number, pad = 8) => !!r && x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;

/**
 * Viewport input. A press on an object selects it (its group, unless the group was entered) and
 * dragging moves the selection in the plane facing the camera, the grabbed point stays under the
 * cursor. Shift locks to one screen axis, Alt drags a copy. A press on empty space orbits, a
 * click there clears the selection. Corner handles scale, the knob tilts. Every drag is one undo
 * step; the camera holds still during it and glides to the new fit after.
 */
export class Manipulator {
  onResetView: () => void = () => {};
  private press: Press | null = null;
  private gesture: Gesture | null = null;
  private hoverQueued = false;
  private hoverAt = { x: 0, y: 0 };
  private nudging: { starts: Start[]; delta: THREE.Vector3 } | null = null;

  constructor(
    private editor: Editor,
    private runtime: SceneRuntime,
    private view: Viewport,
    private picker: Picker,
    private overlay: Overlay,
    overlaySvg: SVGSVGElement,
  ) {
    const c = view.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', (e) => this.up(e, false));
    c.addEventListener('pointercancel', (e) => this.up(e, true));
    c.addEventListener('pointerleave', () => {
      if (!this.press) overlay.hover = null;
    });
    c.addEventListener('dblclick', (e) => this.dblclick(e));
    overlay.onHandle = (e, kind) => this.handleDown(e, kind);
    // handle drags capture on the overlay's hit areas; their events bubble to the svg
    overlaySvg.addEventListener('pointermove', (e) => this.gesture && this.update(e));
    overlaySvg.addEventListener('pointerup', () => this.gesture && this.finish(false));
    overlaySvg.addEventListener('pointercancel', () => this.gesture && this.finish(true));
  }

  get active() {
    return this.gesture !== null || this.nudging !== null;
  }

  private down(e: PointerEvent) {
    if (e.button !== 0 || this.view.exporting || this.gesture) return;
    const { editor } = this;
    this.view.canvas.focus({ preventScroll: true });
    this.view.canvas.setPointerCapture(e.pointerId);
    kit.busy = true;
    this.overlay.hover = null;
    const hit = this.picker.pick(e.clientX, e.clientY);
    if (hit) {
      const target = editor.targetOf(hit.id);
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        editor.select([target], { toggle: true });
        this.press = { kind: 'none' };
        return;
      }
      const wasSelected = editor.selection.includes(target);
      if (!wasSelected) editor.select([target]);
      this.press = { kind: 'move', x: e.clientX, y: e.clientY, anchor: hit.point.clone(), alt: e.altKey, target, wasSelected };
      return;
    }
    // inside the selection box but between its parts (the dots of a %): still a move
    if (editor.selection.length && inside(this.overlay.selRect, e.clientX, e.clientY)) {
      const anchor = worldBox(this.runtime, editor.selection).getCenter(new THREE.Vector3());
      this.press = { kind: 'move', x: e.clientX, y: e.clientY, anchor, alt: e.altKey, target: null, wasSelected: true };
      return;
    }
    this.press = { kind: 'orbit', x: e.clientX, y: e.clientY, shift: e.shiftKey };
  }

  private move(e: PointerEvent) {
    if (this.gesture) {
      this.update(e);
      return;
    }
    const p = this.press;
    if (!p) {
      this.queueHover(e.clientX, e.clientY);
      return;
    }
    if (p.kind === 'none' || Math.hypot(e.clientX - p.x, e.clientY - p.y) < SLOP) return;
    if (p.kind === 'move') this.beginMove(p);
    else this.gesture = { kind: 'orbit', x: p.x, y: p.y, t: performance.now(), vx: 0, vy: 0 };
    this.update(e);
  }

  private up(_e: PointerEvent, cancelled: boolean) {
    const p = this.press;
    this.press = null;
    if (this.gesture) this.finish(cancelled);
    else if (p && !cancelled) {
      // a click: on empty space it clears, on one of several selected it narrows to that one
      if (p.kind === 'orbit' && !p.shift) this.editor.select([]);
      else if (p.kind === 'move' && p.wasSelected && p.target && this.editor.selection.length > 1) this.editor.select([p.target]);
    }
    kit.busy = false;
  }

  private dblclick(e: MouseEvent) {
    const hit = this.picker.pick(e.clientX, e.clientY);
    if (!hit) {
      this.onResetView();
      return;
    }
    const o = findObject(this.editor.doc, hit.id);
    if (o?.group && this.editor.entered !== o.group) this.editor.enter(o.group, o.id);
  }

  private beginMove(p: Extract<Press, { kind: 'move' }>) {
    const { editor } = this;
    editor.begin();
    this.view.freeze();
    this.overlay.mode = 'move';
    if (p.alt) {
      let copies: string[] = [];
      editor.live((d) => (copies = duplicate(d, topLevel(d, editor.selection), NO_OFFSET)));
      editor.select(copies);
    }
    const ids = topLevel(editor.doc, editor.selection);
    this.gesture = { kind: 'move', starts: startsOf(editor.doc, ids), anchor: p.anchor, x0: p.x, y0: p.y };
    this.view.canvas.style.cursor = 'grabbing';
  }

  private handleDown(e: PointerEvent, kind: 'scale' | 'tilt') {
    if (e.button !== 0 || this.gesture || this.view.exporting) return;
    const { editor } = this;
    const ids = topLevel(editor.doc, editor.selection);
    if (!ids.length) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const starts = startsOf(editor.doc, ids);
    // one item turns and scales around its own origin, several around their common center
    const center = starts.length === 1 ? starts[0].world.clone() : worldBox(this.runtime, ids).getCenter(new THREE.Vector3());
    const c = toScreen(this.view, center);
    editor.begin();
    this.view.freeze();
    kit.busy = true;
    this.overlay.mode = kind;
    if (kind === 'scale') {
      const base = starts[0].t.scale;
      this.gesture = { kind: 'scale', starts, center, cx: c.x, cy: c.y, d0: Math.max(8, Math.hypot(e.clientX - c.x, e.clientY - c.y)), base };
      this.overlay.readout = `${Math.round(base * 100)}%`;
    } else {
      // the screen direction of a positive tilt depends on which way the object faces
      const node = this.runtime.objectNode(ids[0]);
      const facing = starts.length === 1 && node ? new THREE.Vector3(0, 0, 1).transformDirection(node.matrixWorld) : new THREE.Vector3(0, 0, 1);
      const toCamera = this.view.studio.camera.position.clone().sub(center);
      const a = Math.atan2(e.clientY - c.y, e.clientX - c.x) * DEG;
      this.gesture = { kind: 'tilt', starts, center, cx: c.x, cy: c.y, prev: a, acc: 0, sign: facing.dot(toCamera) >= 0 ? -1 : 1, base: starts[0].t.tilt };
      this.overlay.readout = `${Math.round(starts[0].t.tilt)}°`;
    }
  }

  private update(e: PointerEvent) {
    const g = this.gesture;
    if (!g) return;
    const { editor, view } = this;
    switch (g.kind) {
      case 'orbit': {
        const dx = e.clientX - g.x;
        const dy = e.clientY - g.y;
        const now = performance.now();
        const dt = Math.max(1, now - g.t);
        g.vx = (dx / dt) * 1000;
        g.vy = (dy / dt) * 1000;
        g.x = e.clientX;
        g.y = e.clientY;
        g.t = now;
        view.orbitAz.jump(view.orbitAz.value - dx * 0.35);
        view.orbitEl.jump(clamp(view.orbitEl.value + dy * 0.3, -15, 70));
        break;
      }
      case 'move': {
        let dx = e.clientX - g.x0;
        let dy = e.clientY - g.y0;
        if (e.shiftKey) [dx, dy] = lockAxis(dx, dy);
        const r = view.canvas.getBoundingClientRect();
        const from: [number, number] = [g.x0 - r.left, g.y0 - r.top];
        const delta = dragDelta(view.studio.camera, g.anchor, from, [from[0] + dx, from[1] + dy], r.width, r.height);
        editor.live((d) => moveBy(d, g.starts, delta));
        break;
      }
      case 'scale': {
        let f = clamp(Math.hypot(e.clientX - g.cx, e.clientY - g.cy) / g.d0, 0.05, 20);
        if (e.shiftKey) f = Math.max(0.05, snap(g.base * f, 0.05)) / g.base;
        editor.live((d) => scaleBy(d, g.starts, g.center, f));
        this.overlay.readout = `${Math.round(g.base * f * 100)}%`;
        break;
      }
      case 'tilt': {
        const a = Math.atan2(e.clientY - g.cy, e.clientX - g.cx) * DEG;
        g.acc += wrap180(a - g.prev);
        g.prev = a;
        let deg = g.sign * g.acc;
        if (e.shiftKey) deg = g.starts.length === 1 ? snap(g.base + deg, 15) - g.base : snap(deg, 15);
        editor.live((d) => rotateBy(d, g.starts, g.center, deg, 'tilt'));
        this.overlay.readout = `${Math.round(wrap180(g.base + deg))}°`;
        break;
      }
    }
  }

  private finish(cancelled: boolean) {
    const g = this.gesture;
    this.gesture = null;
    if (!g) return;
    if (g.kind === 'orbit') {
      // momentum: glide on with the release velocity
      if (performance.now() - g.t < 80) {
        const { orbitAz, orbitEl } = this.view;
        orbitAz.set(orbitAz.value - g.vx * 0.35 * 0.18);
        orbitEl.set(clamp(orbitEl.value + g.vy * 0.3 * 0.18, -15, 70));
      }
    } else {
      if (cancelled) this.editor.cancel();
      else this.editor.end();
      this.view.unfreeze();
      this.overlay.mode = null;
      this.overlay.readout = '';
    }
    this.view.canvas.style.cursor = '';
    kit.busy = false;
  }

  /** Esc during a drag puts everything back. Returns true when there was something to cancel. */
  cancel() {
    if (this.gesture && this.gesture.kind !== 'orbit') {
      this.press = null;
      this.finish(true);
      return true;
    }
    return false;
  }

  /**
   * Arrow keys move the selection along the screen, [ and ] along depth; one undo step per key
   * hold (see endNudge). `dz` is world Z, the composition's front.
   */
  nudge(dx: number, dy: number, dz: number, big: boolean) {
    const { editor } = this;
    if (this.gesture) return false;
    if (!this.nudging) {
      const ids = topLevel(editor.doc, editor.selection);
      if (!ids.length) return false;
      editor.begin();
      this.view.freeze();
      this.nudging = { starts: startsOf(editor.doc, ids), delta: new THREE.Vector3() };
    }
    const step = big ? 0.1 : 0.01;
    const q = this.view.studio.camera.quaternion;
    const { starts, delta } = this.nudging;
    delta
      .addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(q), dx * step)
      .addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(q), dy * step)
      .add(new THREE.Vector3(0, 0, dz * step));
    editor.live((d) => moveBy(d, starts, delta));
    return true;
  }

  endNudge() {
    if (!this.nudging) return;
    this.nudging = null;
    this.editor.end();
    this.view.unfreeze();
  }

  private queueHover(x: number, y: number) {
    this.hoverAt = { x, y };
    if (this.hoverQueued) return;
    this.hoverQueued = true;
    requestAnimationFrame(() => {
      this.hoverQueued = false;
      if (this.press || this.gesture || this.view.exporting) return;
      const { x: hx, y: hy } = this.hoverAt;
      const hit = this.picker.pick(hx, hy);
      const target = hit ? this.editor.targetOf(hit.id) : null;
      this.overlay.hover = target;
      const onSelection = (target && this.editor.selection.includes(target)) || (!hit && inside(this.overlay.selRect, hx, hy));
      this.view.canvas.style.cursor = onSelection ? 'move' : target ? 'pointer' : '';
    });
  }
}
