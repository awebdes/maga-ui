import { $, $$, kit, refreshRim, wake } from '../ui/kit/core';
import { initFs, initSeg, type FsApi } from '../ui/kit/components';
import { MATERIAL_LIBRARY, swatchColor, type MaterialSpec } from '../scene/materials';
import { objectsOf, setMaterial, topLevel } from '../doc/ops';
import { SLOTS, findObject, type SceneDoc } from '../doc/scene';
import type { Editor } from './editor';

interface Target {
  id: string;
  slot: string;
}

/**
 * Materials for the selection. One object shows its own slots (Coin / Icon on a badge, Track /
 * Knob on a toggle); several objects take a swatch on their main slot; property sliders keep each
 * object's other values.
 */
export class MaterialPanel {
  private panels = $('#mat-panels')!;
  private btn = $<HTMLButtonElement>('#mat-btn')!;
  private swatches = $('#swatches')!;
  private color = $<HTMLInputElement>('#mat-color')!;
  private rough: FsApi;
  private coat: FsApi;
  private metal: FsApi;
  /** slot picked for a single object */
  private slot: string | null = null;
  private slotKey = '';
  private editing = false;

  constructor(private editor: Editor) {
    this.renderSwatches();
    this.btn.addEventListener('click', () => this.toggle(!this.panels.classList.contains('is-open')));
    $$('[data-close="mat-panels"]').forEach((b) =>
      b.addEventListener('click', () => {
        this.toggle(false);
        this.btn.focus();
      }),
    );
    this.color.addEventListener('input', () => this.edit({ color: this.color.value, gradient: undefined, id: 'custom', name: 'Custom' }));
    this.color.addEventListener('change', () => this.endEdit());
    this.rough = this.bindFs('#fs-rough', (v) => ({ roughness: v / 100 }));
    this.coat = this.bindFs('#fs-coat', (v) => ({ clearcoat: v / 100 }));
    this.metal = this.bindFs('#fs-metal', (v) => ({ metalness: v / 100 }));
  }

  get isOpen() {
    return this.panels.classList.contains('is-open');
  }

  toggle(open: boolean) {
    if (open === this.isOpen) return;
    this.panels.classList.toggle('is-open', open);
    // the objects list steps aside while the panels are up: they open over the same corner
    kit.app?.classList.toggle('mat-open', open);
    this.btn.setAttribute('aria-expanded', String(open));
    kit.openCount = Math.max(0, kit.openCount + (open ? 1 : -1));
    wake();
    setTimeout(refreshRim, 0);
    if (open) this.sync();
  }

  private targets(doc: SceneDoc = this.editor.doc): Target[] {
    const objs = objectsOf(doc, topLevel(doc, this.editor.selection));
    if (objs.length === 1) {
      const o = objs[0];
      const slots = SLOTS[o.kind].map((s) => s.id);
      return [{ id: o.id, slot: this.slot && slots.includes(this.slot) ? this.slot : slots[0] }];
    }
    return objs.map((o) => ({ id: o.id, slot: SLOTS[o.kind][0].id }));
  }

  private spec(): MaterialSpec | null {
    const t = this.targets()[0];
    return t ? (findObject(this.editor.doc, t.id)?.materials[t.slot] ?? null) : null;
  }

  private apply(make: (cur: MaterialSpec) => MaterialSpec, live: boolean) {
    const ts = this.targets();
    if (!ts.length) return;
    const fn = (d: SceneDoc) => {
      for (const t of ts) {
        const cur = findObject(d, t.id)?.materials[t.slot];
        if (cur) setMaterial(d, t.id, t.slot, make(cur));
      }
    };
    if (live) this.editor.live(fn);
    else this.editor.change(fn);
  }

  /** a property drag: one undo step */
  private edit(patch: Partial<MaterialSpec>) {
    this.editing = true;
    this.apply((cur) => ({ ...cur, ...patch }), true);
  }

  private endEdit() {
    if (!this.editing) return;
    this.editing = false;
    this.editor.end();
  }

  private bindFs(sel: string, patch: (v: number) => Partial<MaterialSpec>) {
    const el = $(sel)!;
    const fs = initFs(el);
    el.addEventListener('input', (e) => this.edit(patch((e as CustomEvent<{ value: number }>).detail.value)));
    el.addEventListener('change', () => this.endEdit());
    return fs;
  }

  private renderSwatches() {
    this.swatches.textContent = '';
    for (const m of MATERIAL_LIBRARY) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.dataset.id = m.id;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.setAttribute('aria-label', m.name);
      const sp = document.createElement('span');
      sp.className = 'sphere';
      sp.style.setProperty('--mat', swatchColor(m));
      if (m.metalness) sp.style.setProperty('--spec', '0.95');
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = m.name;
      b.append(sp, label);
      b.addEventListener('click', () => this.apply(() => ({ ...m }), false));
      this.swatches.appendChild(b);
    }
  }

  /** Slot switcher for one object with several slots; rebuilt when the slot set changes. */
  private syncSlots() {
    const ts = this.targets();
    const o = ts.length === 1 ? findObject(this.editor.doc, ts[0].id) : undefined;
    const slots = o ? SLOTS[o.kind] : [];
    const key = o && slots.length > 1 ? `${o.id}:${slots.map((s) => s.id).join()}` : '';
    const wrap = $('#slot-wrap')!;
    if (key !== this.slotKey) {
      this.slotKey = key;
      wrap.textContent = '';
      if (key) {
        const seg = document.createElement('div');
        seg.className = 'seg part-seg';
        seg.setAttribute('aria-label', 'Part');
        for (const s of slots) {
          const b = document.createElement('button');
          b.dataset.value = s.id;
          b.textContent = s.name;
          b.setAttribute('aria-checked', String(s.id === ts[0].slot));
          seg.appendChild(b);
        }
        wrap.appendChild(seg);
        initSeg(seg);
        seg.addEventListener('change', (e) => {
          this.slot = (e as CustomEvent<{ value: string }>).detail.value;
          this.sync();
        });
      }
    }
    wrap.hidden = !key;
  }

  sync() {
    const ts = this.targets();
    const spec = this.spec();
    const empty = !spec;
    $('#mat-panel')!.classList.toggle('is-empty', empty);
    $('#props-panel')!.classList.toggle('is-empty', empty);
    $('#mat-empty')!.hidden = !empty;
    const { doc } = this.editor;
    const names = ts.map((t) => findObject(doc, t.id)?.name ?? '');
    $('#mat-scope')!.textContent = ts.length === 0 ? '' : ts.length === 1 ? names[0] : `${ts.length} objects`;
    this.syncSlots();
    $('#mat-name')!.textContent = spec ? spec.name : 'Materials';
    $$('.swatch', this.swatches).forEach((b) => b.setAttribute('aria-checked', String(!!spec && b.dataset.id === spec.id)));
    const sphere = $('#mat-sphere')!;
    sphere.style.setProperty('--mat', spec ? swatchColor(spec) : '#3a3a40');
    this.btn.classList.toggle('is-empty', empty);
    if (!spec) return;
    if (!this.editing) {
      this.color.value = spec.gradient ? spec.gradient[1] : spec.color;
      this.rough.set(Math.round(spec.roughness * 100), { silent: true });
      this.coat.set(Math.round((spec.clearcoat ?? 0) * 100), { silent: true });
      this.metal.set(Math.round((spec.metalness ?? 0) * 100), { silent: true });
    }
    const glow = spec.gradient ? spec.gradient[1] : spec.color;
    $$('.panel-head', this.panels).forEach((h) => h.style.setProperty('--panel-glow', glow));
  }
}
