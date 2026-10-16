/**
 * The left island: the banner's layers, top first, with a way to show/hide and add. Glow lives
 * here only (it cannot be clicked on the canvas: it covers half the slot).
 */
import { findLayer, layerNames, setHidden, type Layer } from '../engine';
import { h, icon } from './dom';
import type { Editor } from './state';

const KIND_ICON: Record<Layer['kind'], string> = {
  text: 'i-text',
  badge: 'i-badge',
  badgeRow: 'i-badge',
  image: 'i-image',
  imageClip: 'i-image',
  card: 'i-card',
  pill: 'i-logo',
  glow: 'i-glow',
  stat: 'i-rate',
};

export class Layers {
  private list: HTMLElement;
  private count: HTMLElement;
  private rows = new Map<string, HTMLElement>();
  private order = '';

  constructor(
    private editor: Editor,
    root: HTMLElement,
  ) {
    this.list = root.querySelector('.layers-list')!;
    this.count = root.querySelector('.layers-count')!;
    this.list.addEventListener('keydown', (e) => this.key(e));
  }

  render() {
    const doc = this.editor.doc;
    if (!doc) {
      this.list.replaceChildren();
      this.rows.clear();
      this.order = '';
      return;
    }
    const top = [...doc.layers].reverse();
    const order = top.map((l) => `${l.id}:${l.kind}`).join('|');
    if (order !== this.order) {
      this.order = order;
      const keep = new Set(top.map((l) => l.id));
      for (const [id, row] of this.rows) if (!keep.has(id)) {
        row.remove();
        this.rows.delete(id);
      }
      for (const l of top) {
        let row = this.rows.get(l.id);
        if (!row) {
          row = this.makeRow(l);
          this.rows.set(l.id, row);
        }
        this.list.append(row);
      }
    }
    const issues = this.editor.issues();
    const names = layerNames(doc);
    for (const l of top) {
      const row = this.rows.get(l.id)!;
      row.querySelector('.layer-name')!.textContent = names.get(l.id) ?? '';
      const on = this.editor.selection === l.id;
      row.setAttribute('aria-selected', String(on));
      row.tabIndex = on || (!this.editor.selection && l === top[0]) ? 0 : -1;
      row.classList.toggle('is-hidden', !!l.hidden);
      const eye = row.querySelector('.layer-eye')!;
      eye.setAttribute('aria-pressed', String(!!l.hidden));
      eye.setAttribute('aria-label', l.hidden ? 'Показать' : 'Скрыть');
      eye.querySelector('use')!.setAttribute('href', l.hidden ? '#i-eye-off' : '#i-eye');
      const bad = issues.some((i) => i.layerId === l.id && i.severity === 'error');
      row.classList.toggle('has-issue', bad);
    }
    this.count.textContent = String(doc.layers.length);
  }

  private makeRow(l: Layer) {
    const eye = h('button', { class: 'cell clear icon-btn sm layer-eye', 'aria-pressed': 'false' }, icon('i-eye', 'i i-sm'));
    const row = h('div', { class: 'layer-row', role: 'option', 'data-id': l.id }, h('span', { class: 'layer-icon' }, icon(KIND_ICON[l.kind], 'i i-sm')), h('span', { class: 'layer-name' }), h('span', { class: 'layer-issue', 'aria-hidden': 'true' }), eye);
    row.addEventListener('click', (e) => {
      if ((e.target as Element).closest('.layer-eye')) return;
      this.editor.select(l.id);
    });
    eye.addEventListener('click', () => {
      const cur = this.editor.doc && findLayer(this.editor.doc, l.id);
      if (cur) this.editor.change((d) => setHidden(d, l.id, !cur.hidden));
    });
    return row;
  }

  private key(e: KeyboardEvent) {
    const doc = this.editor.doc;
    if (!doc || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    e.stopPropagation();
    const top = [...doc.layers].reverse();
    const i = top.findIndex((l) => l.id === this.editor.selection);
    const next = top[Math.max(0, Math.min(top.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) {
      this.editor.select(next.id);
      this.rows.get(next.id)?.focus();
    }
  }
}
