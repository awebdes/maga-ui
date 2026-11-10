/**
 * Right panel. Rebuilt when the selection changes, otherwise values refresh in place so a slider
 * under the pointer never gets replaced mid-drag.
 */
import { $, toast } from '@kit/core';
import { initComponents, initFs, initSeg } from '@kit/components';
import {
  CAMERA_MOTIONS,
  CAMERA_SHOTS,
  DEVICE_MOTIONS,
  MODELS,
  POSES,
  applyCameraMotion,
  applyDeviceMotion,
  lensFov,
  writeState,
  type BgKind,
  type CameraState,
  type Device,
  type DeviceState,
  type EnvPreset,
  type TextAnim,
  type TextLayer,
} from './doc';
import type { Editor } from './editor';
import { allMedia, getMedia, type Media } from './media';
import { FONTS } from './layers2d';

const PALETTES: { kind: BgKind; a: string; b: string; c: string; angle: number }[] = [
  { kind: 'mesh', a: '#3b30ff', b: '#07070c', c: '#b04bff', angle: 210 },
  { kind: 'radial', a: '#2b2f3a', b: '#0b0c10', c: '#5b7cff', angle: 0 },
  { kind: 'linear', a: '#5b2cff', b: '#1f8bff', c: '#ffffff', angle: 160 },
  { kind: 'mesh', a: '#ff7a59', b: '#2a0f2f', c: '#ffbf3c', angle: 140 },
  { kind: 'radial', a: '#ffe3cf', b: '#ff9b6a', c: '#ffffff', angle: 0 },
  { kind: 'linear', a: '#eef1f6', b: '#cfd6e4', c: '#ffffff', angle: 180 },
  { kind: 'mesh', a: '#00c389', b: '#04140f', c: '#0aa5ff', angle: 60 },
  { kind: 'solid', a: '#0b0b0d', b: '#0b0b0d', c: '#ffffff', angle: 0 },
  { kind: 'solid', a: '#f4f2ee', b: '#f4f2ee', c: '#ffffff', angle: 0 },
  { kind: 'mesh', a: '#ff4f9a', b: '#1a0b2e', c: '#5b7cff', angle: 300 },
  { kind: 'linear', a: '#111827', b: '#3b82f6', c: '#ffffff', angle: 200 },
  { kind: 'mesh', a: '#d9f99d', b: '#f8fafc', c: '#a5f3fc', angle: 30 },
];

function paletteCss(p: (typeof PALETTES)[number]) {
  if (p.kind === 'solid') return p.a;
  if (p.kind === 'linear') return `linear-gradient(${p.angle}deg, ${p.a}, ${p.b})`;
  if (p.kind === 'radial') return `radial-gradient(circle at 50% 40%, ${p.a}, ${p.b})`;
  return `radial-gradient(circle at 20% 20%, ${p.a}, transparent 70%), radial-gradient(circle at 80% 80%, ${p.c}, transparent 70%), ${p.b}`;
}

const thumbCache = new WeakMap<object, string>();
function thumbOf(m: Media) {
  if (m.kind === 'image' && m.url) return m.url;
  const cached = thumbCache.get(m.el);
  if (cached) return cached;
  const cv = document.createElement('canvas');
  cv.width = 90;
  cv.height = Math.round((90 * Math.min(m.h, m.w * 2.17)) / m.w);
  const c = cv.getContext('2d')!;
  try {
    c.drawImage(m.el, 0, 0, m.w, Math.min(m.h, m.w * 2.17), 0, 0, cv.width, cv.height);
  } catch {
    /* video not ready */
  }
  const url = cv.toDataURL('image/jpeg', 0.8);
  if (m.kind === 'image') thumbCache.set(m.el, url);
  return url;
}

type Refresh = () => void;

export class Inspector {
  private body = $('#insp-body')!;
  private tabs = initSeg($('#insp-tabs')!);
  private tab: 'sel' | 'scene' = 'sel';
  private builtFor = '';
  private refreshers: Refresh[] = [];

  constructor(
    private ed: Editor,
    private hooks: { pickMedia: (deviceId: string) => void; duplicate: (id: string) => void; remove: (id: string) => void },
  ) {
    $('#insp-tabs')!.addEventListener('change', (e) => {
      this.tab = (e as CustomEvent).detail.value;
      this.render(true);
    });
  }

  showTab(t: 'sel' | 'scene') {
    this.tab = t;
    this.tabs.set(t, { silent: true });
    this.render(true);
  }

  render(force = false) {
    const ed = this.ed;
    const d = ed.device(ed.sel);
    const key = [this.tab, ed.sel, d?.model, ed.doc.bg.kind, ed.doc.devices.length, ed.doc.texts.length].join('|');
    if (!force && key === this.builtFor) {
      this.refreshers.forEach((r) => r());
      return;
    }
    this.builtFor = key;
    this.refreshers = [];
    const scroll = this.body.scrollTop;
    this.body.innerHTML = '';
    if (this.tab === 'scene') this.buildScene();
    else if (ed.sel === 'camera') this.buildCamera();
    else if (d) this.buildDevice(d);
    else if (ed.text(ed.sel)) this.buildText(ed.text(ed.sel)!);
    else this.buildEmpty();
    initComponents(this.body);
    this.refreshers.forEach((r) => r());
    this.body.scrollTop = scroll;
  }

  /* ---------- builders ---------- */

  private sec(title: string, extra?: HTMLElement) {
    const s = document.createElement('section');
    s.className = 'sec';
    const h = document.createElement('div');
    h.className = 'sec-head';
    h.innerHTML = `<span class="caps"></span>`;
    h.firstElementChild!.textContent = title;
    if (extra) h.append(extra);
    s.append(h);
    this.body.append(s);
    return s;
  }

  private slider(
    parent: HTMLElement,
    label: string,
    o: { min: number; max: number; step: number; def?: number; fmt?: string },
    get: () => number,
    set: (v: number) => void,
    keyed?: () => boolean,
  ) {
    const el = document.createElement('div');
    el.className = 'fs split';
    Object.assign(el.dataset, { min: o.min, max: o.max, step: o.step, value: get(), default: o.def ?? get(), label, format: o.fmt ?? 'int' });
    parent.append(el);
    const api = initFs(el);
    el.addEventListener('input', (e) => set((e as CustomEvent).detail.value));
    el.addEventListener('change', () => this.ed.commit());
    this.refreshers.push(() => {
      if (!el.classList.contains('is-dragging')) api.set(get(), { silent: true });
      if (keyed) el.classList.toggle('is-keyed', keyed());
    });
    return el;
  }

  private seg(parent: HTMLElement, items: { v: string; label: string; tip?: string }[], get: () => string, set: (v: string) => void, label = '') {
    const el = document.createElement('div');
    el.className = 'seg';
    el.setAttribute('aria-label', label);
    items.forEach((it) => {
      const b = document.createElement('button');
      b.dataset.value = it.v;
      b.textContent = it.label;
      if (it.tip) b.dataset.tip = it.tip;
      if (it.v === get()) b.setAttribute('aria-checked', 'true');
      el.append(b);
    });
    parent.append(el);
    const api = initSeg(el);
    el.addEventListener('change', (e) => set((e as CustomEvent).detail.value));
    this.refreshers.push(() => api.set(get(), { silent: true }));
    return el;
  }

  private chips(parent: HTMLElement, items: { v: string; label: string; tip?: string }[], on: (v: string) => void, active?: () => string | null) {
    const wrap = document.createElement('div');
    wrap.className = 'chips';
    items.forEach((it) => {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = it.label;
      if (it.tip) b.dataset.tip = it.tip;
      b.addEventListener('click', () => on(it.v));
      wrap.append(b);
      if (active) this.refreshers.push(() => b.setAttribute('aria-pressed', String(active() === it.v)));
    });
    parent.append(wrap);
    return wrap;
  }

  private color(parent: HTMLElement, label: string, get: () => string, set: (v: string, final: boolean) => void) {
    const el = document.createElement('label');
    el.className = 'color-field';
    el.innerHTML = `<span class="dot"></span><span class="lbl"></span><span class="mono grow" style="margin-left:auto;text-align:right"></span><input type="color">`;
    el.querySelector('.lbl')!.textContent = label;
    const input = el.querySelector('input')!;
    input.addEventListener('input', () => set(input.value, false));
    input.addEventListener('change', () => set(input.value, true));
    parent.append(el);
    this.refreshers.push(() => {
      const v = get();
      el.style.setProperty('--c', v);
      el.querySelector('.mono')!.textContent = v;
      if (document.activeElement !== input) input.value = v.slice(0, 7);
    });
    return el;
  }

  private button(parent: HTMLElement, label: string, icon: string, on: () => void, cls = 'cell ghost') {
    const b = document.createElement('button');
    b.className = cls;
    b.innerHTML = `${icon ? `<svg class="i i-sm"><use href="#${icon}"/></svg>` : ''}<span></span>`;
    b.querySelector('span')!.textContent = label;
    b.addEventListener('click', on);
    parent.append(b);
    return b;
  }

  private hint(parent: HTMLElement, text: string) {
    const p = document.createElement('p');
    p.className = 'sec-hint';
    p.textContent = text;
    parent.append(p);
    return p;
  }

  /* ---------- device ---------- */

  private buildDevice(d0: Device) {
    const ed = this.ed;
    const id = d0.id;
    const dev = () => ed.device(id)!;
    const st = () => ed.deviceState(dev());
    const write = (patch: Partial<DeviceState>) => ed.change(() => writeState(dev(), ed.time, patch));
    const keyedHere = () => dev().keys.length > 0;

    const actions = document.createElement('div');
    actions.className = 'row';
    this.button(actions, '', 'i-dup', () => this.hooks.duplicate(id), 'cell clear icon-btn sm').dataset.tip = 'Duplicate · ⌘D';
    this.button(actions, '', 'i-trash', () => this.hooks.remove(id), 'cell clear icon-btn sm').dataset.tip = 'Delete';
    const s1 = this.sec('Device', actions);
    this.chips(
      s1,
      MODELS.map((m) => ({ v: m.id, label: m.label })),
      (v) =>
        ed.change(
          () => {
            const d = dev();
            d.model = v as Device['model'];
            d.finish = MODELS.find((m) => m.id === v)!.finishes[0].hex;
          },
          { commit: true, structure: true },
        ),
      () => dev().model,
    );
    const fin = document.createElement('div');
    fin.className = 'finishes';
    const model = MODELS.find((m) => m.id === d0.model)!;
    model.finishes.forEach((f) => {
      const b = document.createElement('button');
      b.className = 'finish';
      b.style.setProperty('--c', f.hex);
      b.dataset.tip = f.name;
      b.setAttribute('aria-label', f.name);
      b.addEventListener('click', () => ed.change(() => (dev().finish = f.hex), { commit: true }));
      this.refreshers.push(() => b.setAttribute('aria-pressed', String(dev().finish.toLowerCase() === f.hex)));
      fin.append(b);
    });
    const custom = document.createElement('label');
    custom.className = 'color-in';
    custom.dataset.tip = 'Custom finish';
    custom.innerHTML = '<input type="color">';
    const ci = custom.querySelector('input')!;
    ci.addEventListener('input', () => ed.change(() => (dev().finish = ci.value)));
    ci.addEventListener('change', () => ed.commit());
    fin.append(custom);
    s1.append(fin);

    // screen
    const s2 = this.sec('Screen');
    const tile = document.createElement('div');
    tile.className = 'media-tile';
    tile.innerHTML = `<span class="thumb"></span><span class="meta"><b></b><span></span></span><svg class="i i-sm"><use href="#i-upload"/></svg>`;
    tile.dataset.tip = 'Replace · or drop a file on the device';
    tile.addEventListener('click', () => this.hooks.pickMedia(id));
    s2.append(tile);
    const strip = document.createElement('div');
    strip.className = 'media-strip';
    const fillStrip = () => {
      strip.innerHTML = '';
      const add = document.createElement('button');
      add.className = 'add';
      add.innerHTML = '<svg class="i i-sm"><use href="#i-plus"/></svg>';
      add.dataset.tip = 'Upload image or video';
      add.addEventListener('click', () => this.hooks.pickMedia(id));
      strip.append(add);
      allMedia().forEach((m) => {
        const b = document.createElement('button');
        b.style.backgroundImage = `url("${thumbOf(m)}")`;
        b.dataset.tip = m.name;
        b.setAttribute('aria-pressed', String(dev().media === m.id));
        b.addEventListener('click', () => ed.change(() => (dev().media = m.id), { commit: true }));
        strip.append(b);
      });
    };
    fillStrip();
    s2.append(strip);
    this.refreshers.push(() => {
      const m = getMedia(dev().media);
      (tile.querySelector('.thumb') as HTMLElement).style.backgroundImage = m ? `url("${thumbOf(m)}")` : '';
      tile.querySelector('b')!.textContent = m ? m.name : 'No screen';
      tile.querySelector('.meta span')!.textContent = m ? `${m.kind === 'video' ? 'Video' : 'Image'} · ${m.w}×${m.h}` : 'Upload a screenshot or a recording';
      strip.querySelectorAll('button:not(.add)').forEach((b, i) => b.setAttribute('aria-pressed', String(allMedia()[i]?.id === dev().media)));
      if (strip.children.length !== allMedia().length + 1) fillStrip();
    });
    const g2 = document.createElement('div');
    g2.className = 'grid2';
    s2.append(g2);
    this.slider(g2, 'Glow', { min: 0, max: 2, step: 0.05, def: 1, fmt: 'x' }, () => dev().glow, (v) => ed.change(() => (dev().glow = v)));
    this.slider(g2, 'Glare', { min: 0, max: 1, step: 0.01, def: 0.35 }, () => dev().glare, (v) => ed.change(() => (dev().glare = v)));
    this.slider(s2, 'Scroll', { min: 0, max: 1, step: 0.005, def: 0 }, () => st().scroll, (v) => write({ scroll: v }), keyedHere);

    // pose
    const s3 = this.sec('Pose');
    this.chips(s3, POSES.map((p) => ({ v: p.id, label: p.label })), (v) => {
      const p = POSES.find((x) => x.id === v)!;
      write({ rot: [...p.rot] });
      ed.commit();
    });
    const g3 = document.createElement('div');
    g3.className = 'grid2';
    s3.append(g3);
    const rotSet = (i: number) => (v: number) => {
      const r = [...st().rot] as DeviceState['rot'];
      r[i] = v;
      write({ rot: r });
    };
    const posSet = (i: number) => (v: number) => {
      const p = [...st().pos] as DeviceState['pos'];
      p[i] = v;
      write({ pos: p });
    };
    this.slider(g3, 'Turn', { min: -360, max: 360, step: 1, def: 0, fmt: 'deg' }, () => st().rot[1], rotSet(1), keyedHere);
    this.slider(g3, 'Tilt', { min: -90, max: 90, step: 1, def: 0, fmt: 'deg' }, () => st().rot[0], rotSet(0), keyedHere);
    this.slider(g3, 'Roll', { min: -180, max: 180, step: 1, def: 0, fmt: 'deg' }, () => st().rot[2], rotSet(2), keyedHere);
    this.slider(g3, 'Size', { min: 0.2, max: 3, step: 0.01, def: 1, fmt: 'x' }, () => st().scale, (v) => write({ scale: v }), keyedHere);
    this.slider(g3, 'X', { min: -4, max: 4, step: 0.01, def: 0 }, () => st().pos[0], posSet(0), keyedHere);
    this.slider(g3, 'Y', { min: -4, max: 4, step: 0.01, def: 0 }, () => st().pos[1], posSet(1), keyedHere);
    this.slider(g3, 'Depth', { min: -6, max: 4, step: 0.01, def: 0 }, () => st().pos[2], posSet(2), keyedHere);
    if (d0.model === 'laptop') this.slider(g3, 'Lid', { min: 0, max: 135, step: 1, def: 105, fmt: 'deg' }, () => dev().lid, (v) => ed.change(() => (dev().lid = v)));
    this.hint(s3, 'Drag the device to turn it, hold Space to move. Shift snaps to 15°, ⌥ drag rolls.');

    // motion
    const clear = document.createElement('button');
    clear.className = 'cell clear sm';
    clear.textContent = 'Clear keys';
    clear.addEventListener('click', () => ed.change(() => (dev().keys = []), { commit: true }));
    this.refreshers.push(() => (clear.hidden = !dev().keys.length));
    const s4 = this.sec('Motion', clear);
    const grid = document.createElement('div');
    grid.className = 'btn-grid';
    s4.append(grid);
    DEVICE_MOTIONS.forEach((m) => {
      const b = this.button(grid, m.label, 'i-spark', () => {
        ed.change(() => applyDeviceMotion(dev(), m.id, ed.doc.format.duration, ed.time), { commit: true });
        toast(`${m.label}: keys added`, 'Edit them on the timeline');
      });
      b.dataset.tip = m.sub;
    });
    const g4 = document.createElement('div');
    g4.className = 'grid3';
    s4.append(g4);
    this.slider(g4, 'Float', { min: 0, max: 0.2, step: 0.005, def: 0 }, () => dev().float.amp, (v) => ed.change(() => (dev().float.amp = v)));
    this.slider(g4, 'Cycles', { min: 1, max: 4, step: 1, def: 1 }, () => dev().float.cycles, (v) => ed.change(() => (dev().float.cycles = v)));
    this.slider(g4, 'Spin', { min: -3, max: 3, step: 1, def: 0 }, () => dev().spin, (v) => ed.change(() => (dev().spin = v)));
    this.hint(s4, 'Float and Spin repeat a whole number of times per clip, so the video loops without a seam.');
  }

  /* ---------- camera ---------- */

  private buildCamera() {
    const ed = this.ed;
    const cam = () => ed.doc.camera;
    const st = () => ed.cameraState();
    const write = (patch: Partial<CameraState>) => ed.change(() => writeState(cam(), ed.time, patch));
    const keyed = () => cam().keys.length > 0;
    const s1 = this.sec('Shot');
    this.chips(s1, CAMERA_SHOTS.map((s) => ({ v: s.id, label: s.label })), (v) => {
      write(CAMERA_SHOTS.find((s) => s.id === v)!.s);
      ed.commit();
    });
    const g = document.createElement('div');
    g.className = 'grid2';
    s1.append(g);
    this.slider(
      g,
      'Lens',
      { min: 14, max: 200, step: 1, def: 50 },
      () => st().lens,
      (v) => {
        // dolly zoom: the subject keeps its size, perspective changes
        const s = st();
        const k = Math.tan(((lensFov(s.lens) / 2) * Math.PI) / 180) / Math.tan(((lensFov(v) / 2) * Math.PI) / 180);
        write({ lens: v, dist: s.dist * k });
      },
      keyed,
    );
    this.slider(g, 'Distance', { min: 1, max: 40, step: 0.05, def: 5.2 }, () => st().dist, (v) => write({ dist: v }), keyed);
    this.slider(g, 'Orbit', { min: -180, max: 180, step: 1, def: 0, fmt: 'deg' }, () => st().yaw, (v) => write({ yaw: v }), keyed);
    this.slider(g, 'Height', { min: -80, max: 80, step: 1, def: 0, fmt: 'deg' }, () => st().pitch, (v) => write({ pitch: v }), keyed);
    this.slider(g, 'Roll', { min: -45, max: 45, step: 1, def: 0, fmt: 'deg' }, () => st().roll, (v) => write({ roll: v }), keyed);
    this.slider(g, 'Pan X', { min: -4, max: 4, step: 0.01, def: 0 }, () => st().target[0], (v) => write({ target: [v, st().target[1], st().target[2]] }), keyed);
    this.slider(g, 'Pan Y', { min: -4, max: 4, step: 0.01, def: 0 }, () => st().target[1], (v) => write({ target: [st().target[0], v, st().target[2]] }), keyed);
    this.hint(s1, 'Lens keeps the framing: longer lens, flatter perspective. In the frame: drag empty space to orbit, scroll to dolly, ⌥ scroll for lens, ⇧ drag to pan.');
    const clear = document.createElement('button');
    clear.className = 'cell clear sm';
    clear.textContent = 'Clear keys';
    clear.addEventListener('click', () => ed.change(() => (cam().keys = []), { commit: true }));
    this.refreshers.push(() => (clear.hidden = !cam().keys.length));
    const s2 = this.sec('Motion', clear);
    const grid = document.createElement('div');
    grid.className = 'btn-grid';
    s2.append(grid);
    CAMERA_MOTIONS.forEach((m) => {
      const b = this.button(grid, m.label, 'i-spark', () => {
        ed.change(() => applyCameraMotion(cam(), m.id, ed.doc.format.duration), { commit: true });
        toast(`${m.label}: keys added`, 'Edit them on the timeline');
      });
      b.dataset.tip = m.sub;
    });
  }

  /* ---------- text ---------- */

  private buildText(t0: TextLayer) {
    const ed = this.ed;
    const id = t0.id;
    const tx = () => ed.text(id)!;
    const set = (fn: (t: TextLayer) => void, commit = false) => ed.change(() => fn(tx()), { commit });
    const actions = document.createElement('div');
    actions.className = 'row';
    this.button(actions, '', 'i-dup', () => this.hooks.duplicate(id), 'cell clear icon-btn sm').dataset.tip = 'Duplicate · ⌘D';
    this.button(actions, '', 'i-trash', () => this.hooks.remove(id), 'cell clear icon-btn sm').dataset.tip = 'Delete';
    const s1 = this.sec('Text', actions);
    const area = document.createElement('textarea');
    area.className = 'field area';
    area.rows = 2;
    area.value = t0.text;
    area.addEventListener('input', () => set((t) => ((t.text = area.value), (t.name = area.value.split('\n')[0].slice(0, 24) || 'Text'))));
    area.addEventListener('change', () => ed.commit());
    s1.append(area);
    this.chips(s1, FONTS.map((f) => ({ v: f.id, label: f.label })), (v) => set((t) => (t.font = v), true), () => tx().font);
    this.seg(
      s1,
      [300, 400, 500, 600, 700, 800].map((w) => ({ v: String(w), label: String(w) })),
      () => String(tx().weight),
      (v) => set((t) => (t.weight = Number(v)), true),
      'Weight',
    );
    const g = document.createElement('div');
    g.className = 'grid3';
    s1.append(g);
    this.slider(g, 'Size', { min: 0.01, max: 0.4, step: 0.002, def: 0.05 }, () => tx().size, (v) => set((t) => (t.size = v)));
    this.slider(g, 'Track', { min: -0.1, max: 0.3, step: 0.005, def: 0 }, () => tx().tracking, (v) => set((t) => (t.tracking = v)));
    this.slider(g, 'Lead', { min: 0.7, max: 1.8, step: 0.01, def: 1.08 }, () => tx().leading, (v) => set((t) => (t.leading = v)));
    const row = document.createElement('div');
    row.className = 'grid2';
    s1.append(row);
    this.color(row, 'Color', () => tx().color, (v, f) => set((t) => (t.color = v), f));
    this.seg(
      row,
      [
        { v: 'left', label: 'L' },
        { v: 'center', label: 'C' },
        { v: 'right', label: 'R' },
      ],
      () => tx().align,
      (v) => set((t) => (t.align = v as TextLayer['align']), true),
      'Align',
    );
    this.seg(
      s1,
      [
        { v: 'front', label: 'In front' },
        { v: 'behind', label: 'Behind devices' },
      ],
      () => tx().layer,
      (v) => set((t) => (t.layer = v as TextLayer['layer']), true),
      'Layer',
    );
    const g2 = document.createElement('div');
    g2.className = 'grid2';
    s1.append(g2);
    this.slider(g2, 'X', { min: 0, max: 1, step: 0.002, def: 0.5 }, () => tx().x, (v) => set((t) => (t.x = v)));
    this.slider(g2, 'Y', { min: 0, max: 1, step: 0.002, def: 0.5 }, () => tx().y, (v) => set((t) => (t.y = v)));
    this.hint(s1, 'Drag the text in the frame; it snaps to the centre lines.');

    const s2 = this.sec('Animate in');
    this.seg(
      s2,
      (['none', 'fade', 'rise', 'blur', 'type', 'pop'] as TextAnim[]).map((a) => ({ v: a, label: a === 'none' ? 'Off' : a[0].toUpperCase() + a.slice(1) })),
      () => tx().anim,
      (v) => set((t) => (t.anim = v as TextAnim), true),
      'Animation',
    );
    const g3 = document.createElement('div');
    g3.className = 'grid2';
    s2.append(g3);
    this.slider(g3, 'Start', { min: 0, max: ed.doc.format.duration, step: 0.05, def: 0.2, fmt: 'int' }, () => tx().start, (v) => set((t) => (t.start = v)));
    this.slider(g3, 'Length', { min: 0.1, max: 4, step: 0.05, def: 0.8 }, () => tx().dur, (v) => set((t) => (t.dur = v)));
  }

  /* ---------- scene ---------- */

  private buildScene() {
    const ed = this.ed;
    const p = () => ed.doc;
    const s1 = this.sec('Background');
    this.seg(
      s1,
      [
        { v: 'solid', label: 'Solid' },
        { v: 'linear', label: 'Linear' },
        { v: 'radial', label: 'Radial' },
        { v: 'mesh', label: 'Mesh' },
        { v: 'transparent', label: 'None' },
      ],
      () => p().bg.kind,
      (v) => ed.change((d) => (d.bg.kind = v as BgKind), { commit: true, structure: true }),
      'Background',
    );
    const pal = document.createElement('div');
    pal.className = 'palettes';
    PALETTES.forEach((x) => {
      const b = document.createElement('button');
      b.className = 'palette';
      b.style.setProperty('--g', paletteCss(x));
      b.setAttribute('aria-label', 'Background preset');
      b.addEventListener('click', () => ed.change((d) => (d.bg = { ...d.bg, ...x }), { commit: true, structure: true }));
      pal.append(b);
    });
    s1.append(pal);
    const kind = ed.doc.bg.kind;
    if (kind !== 'transparent') {
      const g = document.createElement('div');
      g.className = kind === 'mesh' ? 'grid3' : kind === 'solid' ? '' : 'grid2';
      s1.append(g);
      this.color(g, kind === 'solid' ? 'Color' : 'A', () => p().bg.a, (v, f) => ed.change((d) => (d.bg.a = v), { commit: f }));
      if (kind !== 'solid') this.color(g, 'B', () => p().bg.b, (v, f) => ed.change((d) => (d.bg.b = v), { commit: f }));
      if (kind === 'mesh') this.color(g, 'C', () => p().bg.c, (v, f) => ed.change((d) => (d.bg.c = v), { commit: f }));
      const g2 = document.createElement('div');
      g2.className = 'grid2';
      s1.append(g2);
      if (kind === 'linear' || kind === 'mesh') this.slider(g2, 'Angle', { min: 0, max: 360, step: 1, def: 180, fmt: 'deg' }, () => p().bg.angle, (v) => ed.change((d) => (d.bg.angle = v)));
      this.slider(g2, 'Noise', { min: 0, max: 1, step: 0.01, def: 0.25 }, () => p().bg.noise, (v) => ed.change((d) => (d.bg.noise = v)));
    } else {
      this.hint(s1, 'Transparent: PNG keeps alpha. MP4 has no alpha channel, use WebM or PNG.');
    }

    const s2 = this.sec('Light');
    this.seg(
      s2,
      [
        { v: 'studio', label: 'Studio', tip: 'Even room light' },
        { v: 'softbox', label: 'Softbox', tip: 'Large soft top light' },
        { v: 'strips', label: 'Strips', tip: 'Crisp edge highlights on dark' },
        { v: 'dusk', label: 'Dusk', tip: 'Warm and cool sides' },
      ],
      () => p().env.preset,
      (v) => ed.change((d) => (d.env.preset = v as EnvPreset), { commit: true }),
      'Light',
    );
    const g3 = document.createElement('div');
    g3.className = 'grid2';
    s2.append(g3);
    this.slider(g3, 'Intensity', { min: 0, max: 3, step: 0.01, def: 1, fmt: 'x' }, () => p().env.intensity, (v) => ed.change((d) => (d.env.intensity = v)));
    this.slider(g3, 'Rotate', { min: -180, max: 180, step: 1, def: 0, fmt: 'deg' }, () => p().env.rotation, (v) => ed.change((d) => (d.env.rotation = v)));
    this.slider(g3, 'Shadow', { min: 0, max: 1, step: 0.01, def: 0.45 }, () => p().env.shadow, (v) => ed.change((d) => (d.env.shadow = v)));
    this.slider(g3, 'Softness', { min: 0, max: 1, step: 0.01, def: 0.6 }, () => p().env.softness, (v) => ed.change((d) => (d.env.softness = v)));

    const s3 = this.sec('Effects');
    const g4 = document.createElement('div');
    g4.className = 'grid2';
    s3.append(g4);
    this.slider(g4, 'Bloom', { min: 0, max: 1.5, step: 0.01, def: 0.25 }, () => p().fx.bloom, (v) => ed.change((d) => (d.fx.bloom = v)));
    this.slider(g4, 'Threshold', { min: 0.3, max: 1.2, step: 0.01, def: 0.82 }, () => p().fx.threshold, (v) => ed.change((d) => (d.fx.threshold = v)));
    this.slider(g4, 'Grain', { min: 0, max: 0.5, step: 0.005, def: 0.06 }, () => p().fx.grain, (v) => ed.change((d) => (d.fx.grain = v)));
    this.slider(g4, 'Vignette', { min: 0, max: 1, step: 0.01, def: 0.25 }, () => p().fx.vignette, (v) => ed.change((d) => (d.fx.vignette = v)));

    const s4 = this.sec('Clip');
    const g5 = document.createElement('div');
    g5.className = 'grid2';
    s4.append(g5);
    this.slider(
      g5,
      'Length',
      { min: 1, max: 30, step: 0.5, def: 6 },
      () => p().format.duration,
      (v) =>
        ed.change((d) => {
          // keys at the old end move to the new end, so loops stay loops
          const old = d.format.duration;
          const all = [d.camera.keys, ...d.devices.map((x) => x.keys)];
          all.forEach((ks) => ks.forEach((k) => (k.t = Math.abs(k.t - old) < 1e-3 ? v : Math.min(k.t, v))));
          d.format.duration = v;
          ed.time = Math.min(ed.time, v);
        }),
    );
    this.seg(
      g5,
      [
        { v: '30', label: '30 fps' },
        { v: '60', label: '60 fps' },
      ],
      () => String(p().format.fps),
      (v) => ed.change((d) => (d.format.fps = Number(v)), { commit: true }),
      'Frame rate',
    );
  }

  private buildEmpty() {
    const s = this.sec('Nothing selected');
    this.hint(s, 'Click a device or a text in the frame, or pick a layer on the left. Scene settings live in the Scene tab.');
    const list = document.createElement('div');
    list.className = 'kbd-list';
    const keys: [string, string][] = [
      ['Space', 'Play / pause'],
      ['K', 'Key the selection at the playhead'],
      ['R / G', 'Drag turns / moves'],
      ['⇧', 'Snap angles, lock axis'],
      ['T', 'Add text'],
      ['← →', 'Step a frame, ⇧ a second'],
      ['⌘Z', 'Undo'],
      ['H', 'Hide interface'],
      ['E', 'Export'],
    ];
    keys.forEach(([k, v]) => {
      const a = document.createElement('span');
      a.className = 'kbd';
      a.textContent = k;
      const b = document.createElement('span');
      b.textContent = v;
      list.append(a, b);
    });
    s.append(list);
  }
}

