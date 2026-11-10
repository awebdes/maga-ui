/**
 * Direct manipulation in the frame.
 *   device: drag turns it (Shift: one axis, 15° steps; ⌥: roll), Space / right button / Move tool moves it
 *   text: drag moves it, snaps to the centre lines
 *   empty space: drag orbits the camera, Shift drag pans, wheel dollies, ⌥ wheel changes lens (framing kept)
 * When the object already has keys, every gesture writes a key at the playhead.
 */
import * as THREE from 'three';
import { kit } from '@kit/core';
import { lensFov, writeState, type CameraState, type DeviceState, type Vec3 } from './doc';
import type { Editor } from './editor';
import type { Studio } from './studio';

type Mode = 'rotate' | 'roll' | 'move' | 'text' | 'orbit' | 'pan';

export class Viewport {
  readonly canvas = document.getElementById('view') as HTMLCanvasElement;
  readonly frame = document.getElementById('frame')!;
  private wrap = document.getElementById('frame-wrap')!;
  private overlay = document.getElementById('overlay')!;
  private hud = document.getElementById('hud')!;
  private meta = document.getElementById('frame-meta')!;
  hover: string | null = null;
  space = false;
  private guides: { v: boolean; h: boolean } = { v: false, h: false };
  private cssW = 1;
  private cssH = 1;
  private wheelTimer = 0;
  dragging = false;

  constructor(
    private ed: Editor,
    private studio: Studio,
    private hooks: { invalidate: () => void },
  ) {
    new ResizeObserver(() => this.fit()).observe(this.wrap);
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => !this.dragging && this.hoverAt(e));
    this.canvas.addEventListener('pointerleave', () => {
      if (this.hover) {
        this.hover = null;
        this.drawOverlay();
      }
    });
    this.canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /* ---------- layout ---------- */

  fit() {
    const r = this.wrap.getBoundingClientRect();
    const { w, h } = this.ed.doc.format;
    const pad = 8;
    const s = Math.min((r.width - pad * 2) / w, (r.height - pad * 2 - 18) / h);
    this.cssW = Math.max(40, Math.floor(w * s));
    this.cssH = Math.max(40, Math.floor(h * s));
    this.frame.style.width = this.cssW + 'px';
    this.frame.style.height = this.cssH + 'px';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const k = Math.min(dpr, 2600 / Math.max(this.cssW, this.cssH));
    this.studio.setSize(this.cssW * k, this.cssH * k);
    const ratio = gcdRatio(w, h);
    this.meta.textContent = `${w} × ${h} · ${ratio} · ${this.ed.doc.format.fps} fps · ${this.ed.doc.format.duration.toFixed(1)} s`;
    this.meta.style.bottom = `${(r.height - this.cssH) / 2 - 22}px`;
    this.hooks.invalidate();
  }

  /* ---------- picking ---------- */

  private frameXY(e: { clientX: number; clientY: number }) {
    const r = this.canvas.getBoundingClientRect();
    return { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height };
  }

  private hitText(fx: number, fy: number, layer: 'front' | 'behind') {
    const boxes = this.studio.textBoxes;
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      const t = this.ed.text(b.id);
      if (!t || t.layer !== layer || !t.visible) continue;
      const px = 8 / this.cssW;
      const py = 8 / this.cssH;
      if (fx >= b.x - px && fx <= b.x + b.w + px && fy >= b.y - py && fy <= b.y + b.h + py) return b.id;
    }
    return null;
  }

  private hitAt(fx: number, fy: number): { kind: 'device' | 'text'; id: string } | null {
    const front = this.hitText(fx, fy, 'front');
    if (front) return { kind: 'text', id: front };
    const dev = this.studio.pick(fx * 2 - 1, 1 - fy * 2);
    if (dev) return { kind: 'device', id: dev };
    const behind = this.hitText(fx, fy, 'behind');
    if (behind) return { kind: 'text', id: behind };
    return null;
  }

  private hoverAt(e: PointerEvent) {
    const { fx, fy } = this.frameXY(e);
    const hit = this.hitAt(fx, fy);
    const id = hit?.id ?? null;
    this.canvas.classList.toggle('on-device', !!hit);
    this.canvas.classList.toggle('move-tool', this.ed.tool === 'move' || this.space);
    if (id !== this.hover) {
      this.hover = id;
      this.drawOverlay();
    }
  }

  /** device under a client point, for drops */
  deviceAt(clientX: number, clientY: number) {
    const { fx, fy } = this.frameXY({ clientX, clientY });
    if (fx < 0 || fy < 0 || fx > 1 || fy > 1) return null;
    return this.studio.pick(fx * 2 - 1, 1 - fy * 2);
  }

  /* ---------- drag ---------- */

  private down(e: PointerEvent) {
    const ed = this.ed;
    this.canvas.focus({ preventScroll: true });
    if (ed.playing) return;
    const { fx, fy } = this.frameXY(e);
    const hit = this.hitAt(fx, fy);
    let mode: Mode;
    const altBtn = e.button === 1 || e.button === 2;
    if (hit?.kind === 'device') {
      if (ed.sel !== hit.id) ed.select(hit.id);
      mode = ed.tool === 'move' || this.space || altBtn ? 'move' : e.altKey ? 'roll' : 'rotate';
    } else if (hit?.kind === 'text') {
      if (ed.sel !== hit.id) ed.select(hit.id);
      mode = 'text';
    } else {
      mode = e.shiftKey || altBtn || this.space ? 'pan' : 'orbit';
    }
    const id = hit?.id ?? 'camera';
    const dev = hit?.kind === 'device' ? ed.device(id) : null;
    const tx = hit?.kind === 'text' ? ed.text(id) : null;
    const d0: DeviceState | null = dev ? JSON.parse(JSON.stringify(ed.deviceState(dev))) : null;
    const c0: CameraState = JSON.parse(JSON.stringify(ed.cameraState()));
    const t0 = tx ? { x: tx.x, y: tx.y } : null;
    const box0 = tx ? this.studio.textBoxes.find((b) => b.id === tx.id) : null;
    const devOrigin = d0 ? new THREE.Vector3(...d0.pos) : null;
    const camTarget = new THREE.Vector3(...c0.target);
    const startP = devOrigin ? this.studio.planePoint(fx, fy, devOrigin) : this.studio.planePoint(fx, fy, camTarget);
    // pan in the start camera's plane: world units per css pixel at the target's distance
    const camQ = this.studio.camera.quaternion.clone();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camQ);
    const upV = new THREE.Vector3(0, 1, 0).applyQuaternion(camQ);
    const perPx = (2 * c0.dist * Math.tan(((lensFov(c0.lens) / 2) * Math.PI) / 180)) / this.cssH;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    this.canvas.setPointerCapture(e.pointerId);
    this.dragging = true;
    kit.busy = true;

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      this.canvas.classList.add('is-dragging');
      const shift = ev.shiftKey;
      let readout = '';
      if ((mode === 'rotate' || mode === 'roll') && dev && d0) {
        const k = 0.36;
        let rx = d0.rot[0];
        let ry = d0.rot[1];
        let rz = d0.rot[2];
        if (mode === 'roll') rz = d0.rot[2] - dx * k;
        else if (shift) {
          if (Math.abs(dx) > Math.abs(dy)) ry = snap(d0.rot[1] + dx * k, 15);
          else rx = snap(d0.rot[0] + dy * k, 15);
        } else {
          ry = d0.rot[1] + dx * k;
          rx = d0.rot[0] + dy * k;
        }
        rx = Math.max(-90, Math.min(90, rx));
        ed.change(() => writeState(ed.device(id)!, ed.time, { rot: [round1(rx), round1(ry), round1(rz)] }));
        readout = mode === 'roll' ? `Roll ${fmtDeg(rz)}` : `Turn ${fmtDeg(ry)} · Tilt ${fmtDeg(rx)}`;
      } else if (mode === 'move' && dev && d0 && devOrigin && startP) {
        const { fx: nx, fy: ny } = this.frameXY(ev);
        const p = this.studio.planePoint(nx, ny, devOrigin);
        if (p) {
          const delta = p.sub(startP);
          if (shift) {
            const ax = Math.abs(delta.x) >= Math.abs(delta.y) ? 'x' : 'y';
            if (ax === 'x') delta.y = 0;
            else delta.x = 0;
            delta.z = 0;
          }
          const pos: Vec3 = [round3(d0.pos[0] + delta.x), round3(d0.pos[1] + delta.y), round3(d0.pos[2] + delta.z)];
          ed.change(() => writeState(ed.device(id)!, ed.time, { pos }));
          readout = `X ${pos[0].toFixed(2)} · Y ${pos[1].toFixed(2)}`;
        }
      } else if (mode === 'text' && tx && t0) {
        const ddx = dx / this.cssW;
        const ddy = dy / this.cssH;
        let x = t0.x + ddx;
        let y = t0.y + ddy;
        this.guides = { v: false, h: false };
        if (box0 && !shift) {
          const cx = box0.x + box0.w / 2 + ddx;
          const cy = box0.y + box0.h / 2 + ddy;
          if (Math.abs(cx - 0.5) * this.cssW < 6) {
            x += 0.5 - cx;
            this.guides.v = true;
          }
          if (Math.abs(cy - 0.5) * this.cssH < 6) {
            y += 0.5 - cy;
            this.guides.h = true;
          }
        }
        ed.change(() => {
          const t = ed.text(id)!;
          t.x = round3(x);
          t.y = round3(y);
        });
        readout = `X ${(x * 100).toFixed(0)}% · Y ${(y * 100).toFixed(0)}%`;
      } else if (mode === 'orbit') {
        const yaw = round1(c0.yaw - dx * 0.3);
        const pitch = round1(Math.max(-85, Math.min(85, c0.pitch + dy * 0.3)));
        ed.change(() => writeState(ed.doc.camera, ed.time, { yaw: shift ? snap(yaw, 15) : yaw, pitch }));
        readout = `Orbit ${fmtDeg(yaw)} · Height ${fmtDeg(pitch)}`;
      } else if (mode === 'pan') {
        const delta = right.clone().multiplyScalar(-dx * perPx).add(upV.clone().multiplyScalar(dy * perPx));
        const target: Vec3 = [round3(c0.target[0] + delta.x), round3(c0.target[1] + delta.y), round3(c0.target[2] + delta.z)];
        ed.change(() => writeState(ed.doc.camera, ed.time, { target }));
        readout = `Pan ${target[0].toFixed(2)}, ${target[1].toFixed(2)}`;
      }
      const tr = mode === 'text' ? null : ed.track(mode === 'orbit' || mode === 'pan' ? 'camera' : id);
      const keyed = tr && tr.keys.length > 0;
      this.showHud(ev, readout + (keyed ? ` <span class="k">◆ ${ed.time.toFixed(2)} s</span>` : ''));
    };
    const up = () => {
      this.canvas.removeEventListener('pointermove', move);
      this.canvas.removeEventListener('pointerup', up);
      this.canvas.removeEventListener('pointercancel', up);
      this.canvas.classList.remove('is-dragging');
      this.dragging = false;
      kit.busy = false;
      this.hud.hidden = true;
      this.guides = { v: false, h: false };
      if (moved) ed.commit();
      else if (!hit) ed.select(null);
      this.drawOverlay();
    };
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    const ed = this.ed;
    if (ed.playing) return;
    const c = ed.cameraState();
    // trackpad pinch arrives as ctrl+wheel: treat like a dolly
    const dyN = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    let readout = '';
    if (e.altKey) {
      const lens = Math.max(14, Math.min(200, c.lens * Math.exp(-dyN * 0.002)));
      const k = Math.tan(((lensFov(c.lens) / 2) * Math.PI) / 180) / Math.tan(((lensFov(lens) / 2) * Math.PI) / 180);
      ed.change(() => writeState(ed.doc.camera, ed.time, { lens: Math.round(lens), dist: round3(c.dist * k) }));
      readout = `Lens ${Math.round(lens)} mm`;
    } else if (e.shiftKey && ed.device(ed.sel)) {
      const d = ed.device(ed.sel)!;
      const s = ed.deviceState(d);
      const scale = round3(Math.max(0.2, Math.min(3, s.scale * Math.exp(-dyN * 0.0015))));
      ed.change(() => writeState(d, ed.time, { scale }));
      readout = `Size ${scale.toFixed(2)}×`;
    } else {
      const dist = round3(Math.max(1, Math.min(40, c.dist * Math.exp(dyN * (e.ctrlKey ? 0.006 : 0.0012)))));
      ed.change(() => writeState(ed.doc.camera, ed.time, { dist }));
      readout = `Distance ${dist.toFixed(2)}`;
    }
    this.showHud(e, readout);
    clearTimeout(this.wheelTimer);
    this.wheelTimer = window.setTimeout(() => {
      this.hud.hidden = true;
      ed.commit();
    }, 450);
  }

  private showHud(e: { clientX: number; clientY: number }, html: string) {
    if (!html) return;
    this.hud.hidden = false;
    this.hud.innerHTML = html;
    this.hud.style.left = e.clientX + 'px';
    this.hud.style.top = e.clientY + 'px';
  }

  /* ---------- overlay ---------- */

  drawOverlay() {
    const ed = this.ed;
    const W = this.cssW;
    const H = this.cssH;
    let html = '';
    const box = (b: { x: number; y: number; w: number; h: number }, cls: string, label = '') =>
      `<div class="sel-box ${cls}" style="left:${b.x * W}px;top:${b.y * H}px;width:${b.w * W}px;height:${b.h * H}px"><i></i>${label ? `<span class="sel-label">${esc(label)}</span>` : ''}</div>`;
    if (!ed.playing) {
      for (const id of new Set([this.hover, ed.sel])) {
        if (!id || id === 'camera') continue;
        const sel = id === ed.sel;
        const dev = ed.device(id);
        if (dev) {
          const b = this.studio.bounds(id);
          if (b) html += box(b, sel ? '' : 'hover', sel ? dev.name : '');
        } else {
          const tb = this.studio.textBoxes.find((x) => x.id === id);
          if (tb) html += box(tb, 'text' + (sel ? '' : ' hover'));
        }
      }
    }
    if (this.guides.v) html += `<div class="guide v" style="left:${W / 2}px"></div>`;
    if (this.guides.h) html += `<div class="guide h" style="top:${H / 2}px"></div>`;
    if (ed.safe) {
      const { w, h } = ed.doc.format;
      if (h / w > 1.5) {
        html += `<div class="safe top" style="height:${H * 0.13}px"><span>Profile · progress bar</span></div>`;
        html += `<div class="safe bottom" style="height:${H * 0.2}px"><span>Caption · reply bar</span></div>`;
      } else {
        html += `<div class="sel-box text" style="left:${W * 0.05}px;top:${H * 0.05}px;width:${W * 0.9}px;height:${H * 0.9}px"><i></i></div>`;
      }
    }
    this.overlay.innerHTML = html;
  }
}

const snap = (v: number, s: number) => Math.round(v / s) * s;
const round1 = (v: number) => Math.round(v * 10) / 10;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const fmtDeg = (v: number) => `${Math.round(v)}°`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
function gcdRatio(w: number, h: number) {
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const d = g(w, h);
  const a = w / d;
  const b = h / d;
  return a > 50 ? (w / h).toFixed(2) : `${a}:${b}`;
}
