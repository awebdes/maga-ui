import * as THREE from 'three/webgpu';
import { $, kit } from '../ui/kit/core';
import { initFs, type FsApi } from '../ui/kit/components';
import { isGroup, setTransform, topLevel } from '../doc/ops';
import { findGroup, findObject, type SceneDoc } from '../doc/scene';
import { rotateBy, scaleBy, startsOf, type Start } from '../doc/manipulate';
import type { SceneRuntime } from '../doc/runtime';
import type { Editor } from './editor';
import type { Actions } from './actions';
import type { Viewport } from './viewport';
import { worldBox } from './bounds';
import { objectIcon, symbolIcon } from './icons';

const round = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * The bar over the dock while something is selected: what is selected, Size / Tilt / Turn /
 * Forward, and Duplicate · Group · Delete. With several items the sliders show the first one and
 * apply the same change to all (scale and turn around their common center).
 */
export class SelBar {
  onReplaceIcon: (anchor: HTMLElement) => void = () => {};
  private el = $('#selbar')!;
  private chip = $<HTMLButtonElement>('#sel-chip')!;
  private size: FsApi;
  private tilt: FsApi;
  private turn: FsApi;
  private fwd: FsApi;
  /** the slider gesture: transforms at its start */
  private starts: Start[] | null = null;
  private center = new THREE.Vector3();

  constructor(
    private editor: Editor,
    private runtime: SceneRuntime,
    private view: Viewport,
    actions: Actions,
    private svgOf: (ref: string) => string | null,
  ) {
    this.size = this.bind('#fs-size', (d, s, v) => scaleBy(d, s, this.center, v / 100 / s[0].t.scale));
    this.tilt = this.bind('#fs-tilt', (d, s, v) => rotateBy(d, s, this.center, v - s[0].t.tilt, 'tilt'));
    this.turn = this.bind('#fs-turn', (d, s, v) => rotateBy(d, s, this.center, v - s[0].t.turn, 'turn'));
    this.fwd = this.bind('#fs-fwd', (d, s, v) => s.forEach((x) => setTransform(d, x.id, { z: round(x.t.z + v - s[0].t.z) })));
    $('#sel-dup')!.addEventListener('click', () => actions.duplicate());
    $('#sel-group')!.addEventListener('click', () => actions.group());
    $('#sel-ungroup')!.addEventListener('click', () => actions.ungroup());
    $('#sel-del')!.addEventListener('click', () => actions.remove());
    this.chip.addEventListener('click', () => {
      const o = this.single();
      if (o && (o.kind === 'glyph' || o.kind === 'badge')) this.onReplaceIcon(this.chip);
    });
  }

  private ids() {
    return topLevel(this.editor.doc, this.editor.selection);
  }

  private single() {
    const ids = this.ids();
    return ids.length === 1 ? findObject(this.editor.doc, ids[0]) : undefined;
  }

  /** Slider drag = one undo step; the camera holds still until it ends. */
  private bind(sel: string, apply: (d: SceneDoc, s: Start[], v: number) => void) {
    const el = $(sel)!;
    const fs = initFs(el);
    el.addEventListener('input', (e) => {
      const v = (e as CustomEvent<{ value: number }>).detail.value;
      if (!this.starts) {
        const ids = this.ids();
        if (!ids.length) return;
        this.starts = startsOf(this.editor.doc, ids);
        this.center = ids.length > 1 ? worldBox(this.runtime, ids).getCenter(new THREE.Vector3()) : this.starts[0].world.clone();
        this.editor.begin();
        this.view.freeze();
      }
      const starts = this.starts;
      this.editor.live((d) => apply(d, starts, v));
    });
    el.addEventListener('change', () => {
      if (!this.starts) return;
      this.starts = null;
      this.editor.end();
      this.view.unfreeze();
    });
    return fs;
  }

  sync() {
    const { doc } = this.editor;
    const ids = this.ids();
    const show = ids.length > 0;
    // the material panels lift above the bar while it is up
    kit.app?.classList.toggle('has-selection', show);
    if (this.el.hidden === show) {
      this.el.hidden = !show;
      if (show) {
        this.el.classList.remove('is-in');
        void this.el.offsetWidth;
        this.el.classList.add('is-in');
      }
    }
    if (!show) return;
    const first = findGroup(doc, ids[0]) ?? findObject(doc, ids[0]);
    if (!first) return;
    const icon = $('#sel-icon')!;
    icon.textContent = '';
    const o = this.single();
    if (ids.length > 1) icon.appendChild(symbolIcon('i-layers'));
    else if (o) icon.appendChild(objectIcon(o, this.svgOf));
    else icon.appendChild(symbolIcon('i-group'));
    const n = ids.length;
    $('#sel-name')!.textContent = n > 1 ? `${n} items` : first.name;
    const swappable = !!o && (o.kind === 'glyph' || o.kind === 'badge');
    this.chip.classList.toggle('can-swap', swappable);
    if (swappable) this.chip.dataset.tip = 'Replace the icon';
    else delete this.chip.dataset.tip;
    this.chip.setAttribute('aria-label', swappable ? `${first.name}: replace the icon` : n > 1 ? `${n} items selected` : String(first.name));
    if (!this.starts) {
      const t = first.t;
      this.size.set(Math.round(t.scale * 100), { silent: true });
      this.tilt.set(Math.round(t.tilt), { silent: true });
      this.turn.set(Math.round(t.turn), { silent: true });
      this.fwd.set(Math.round(t.z * 100) / 100, { silent: true });
    }
    const canUngroup = ids.some((id) => isGroup(doc, id));
    $('#sel-ungroup')!.hidden = !canUngroup;
    const groupBtn = $<HTMLButtonElement>('#sel-group')!;
    groupBtn.hidden = canUngroup && n === 1;
    groupBtn.disabled = n < 2;
  }
}
