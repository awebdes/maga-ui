import { $, pop } from '../ui/kit/core';
import { initFs, initSeg, type FsApi, type SegApi } from '../ui/kit/components';
import { setForm, setKind, topLevel } from '../doc/ops';
import { FORM_DEFAULTS, childrenOf, findGroup, findObject, type FormMode, type FormValues } from '../doc/scene';
import type { Editor } from './editor';
import type { Viewport } from './viewport';

/**
 * The dock follows the selection: an icon gets Extrude · Soft · Inflate · Badge and its sliders,
 * a coin or tile gets Depth and Roundness, a model, a group or several items get a short note,
 * nothing selected gets a hint and Add.
 */
export class Dock {
  private seg: SegApi;
  private depth: FsApi;
  private round: FsApi;
  private puff: FsApi;
  private sliding = false;

  constructor(
    private editor: Editor,
    private view: Viewport,
  ) {
    this.seg = initSeg($('#form-seg')!);
    this.depth = this.bind('#fs-depth', 'depth');
    this.round = this.bind('#fs-round', 'roundness');
    this.puff = this.bind('#fs-puff', 'puff');
    $('#form-seg')!.addEventListener('change', () => this.form(this.seg.value));
    $('#dock-add')!.addEventListener('click', () => pop.open($('#add-menu')!, $('#add-btn')));
  }

  private target() {
    const ids = topLevel(this.editor.doc, this.editor.selection);
    return ids.length === 1 ? findObject(this.editor.doc, ids[0]) : undefined;
  }

  private form(value: string) {
    const o = this.target();
    if (!o || (o.kind !== 'glyph' && o.kind !== 'badge')) return;
    const id = o.id;
    if (value === 'badge') this.editor.change((d) => setKind(d, id, 'badge'));
    else if (o.kind === 'badge') this.editor.change((d) => setKind(d, id, 'glyph', value as FormMode));
    else this.editor.change((d) => setForm(d, id, { ...FORM_DEFAULTS[value as FormMode] }));
  }

  private bind(sel: string, key: keyof Omit<FormValues, 'mode'>) {
    const el = $(sel)!;
    const fs = initFs(el);
    el.addEventListener('input', (e) => {
      const o = this.target();
      if (!o?.form) return;
      if (!this.sliding) {
        this.sliding = true;
        this.view.freeze();
      }
      const v = (e as CustomEvent<{ value: number }>).detail.value;
      const id = o.id;
      this.editor.live((d) => setForm(d, id, { [key]: v }));
    });
    el.addEventListener('change', () => {
      if (!this.sliding) return;
      this.sliding = false;
      this.editor.end();
      this.view.unfreeze();
    });
    return fs;
  }

  sync() {
    const { doc, selection } = this.editor;
    const ids = topLevel(doc, selection);
    const show = (id: string, on: boolean) => ($(id)!.hidden = !on);
    const note = (text: string) => {
      $('#dock-note-text')!.textContent = text;
      show('#dock-note', true);
    };
    show('#dock-hint', false);
    show('#dock-form', false);
    show('#dock-sliders', false);
    show('#dock-note', false);
    if (!ids.length) {
      $('#dock-hint-text')!.textContent = doc.objects.length ? 'Click an object to edit it' : 'Empty scene. Add the first object';
      show('#dock-hint', true);
      return;
    }
    if (ids.length > 1) {
      note(`${ids.length} items selected · ⌘G groups them`);
      return;
    }
    const g = findGroup(doc, ids[0]);
    if (g) {
      note(`${g.name} · ${childrenOf(doc, g.id).length} objects · double-click one to edit it`);
      return;
    }
    const o = findObject(doc, ids[0]);
    if (!o) return;
    if (o.kind === 'model') {
      note(`${o.name} is a hand-built model · size, turn and material still apply`);
      return;
    }
    const f = o.form;
    if (!f) return;
    const icon = o.kind === 'glyph' || o.kind === 'badge';
    show('#dock-form', icon);
    show('#dock-sliders', true);
    if (icon) this.seg.set(o.kind === 'badge' ? 'badge' : f.mode, { silent: true });
    if (!this.sliding) {
      this.depth.set(f.depth, { silent: true });
      this.round.set(f.roundness, { silent: true });
      this.puff.set(f.puff, { silent: true });
    }
    show('#fs-puff', o.kind === 'glyph');
    $('#fs-puff')!.setAttribute('aria-disabled', String(f.mode !== 'inflate'));
    $('#fs-round')!.setAttribute('aria-disabled', String(o.kind === 'glyph' && f.mode === 'inflate'));
  }
}
