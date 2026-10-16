/**
 * "Сменить раскладку": every template's layout with this banner's own texts in it, so the choice
 * is made on the real copy, not on placeholder text.
 */
import { GROUPS, TEMPLATES, switchLayout, type BannerDoc } from '../engine';
import { drawBanner } from '../render/draw';
import { pop, toast } from '../ui/kit/core';
import { h, icon } from './dom';
import type { Editor } from './state';

export class LayoutPicker {
  private el: HTMLElement;

  constructor(private editor: Editor) {
    this.el = h('section', { class: 'panel layout-pop', role: 'dialog', 'aria-label': 'Раскладки' });
    document.body.append(this.el);
  }

  toggle(anchor: HTMLElement) {
    if (pop.isOpen(this.el)) {
      pop.close(this.el);
      return;
    }
    const doc = this.editor.doc;
    if (!doc) return;
    this.build(doc);
    const r = anchor.getBoundingClientRect();
    const side = (anchor.closest('.panel') ?? anchor).getBoundingClientRect();
    this.el.style.right = `${Math.max(12, innerWidth - side.left + 12)}px`;
    this.el.style.top = `${Math.max(12, Math.min(r.top - 120, innerHeight - 620))}px`;
    pop.open(this.el, anchor);
  }

  private build(doc: BannerDoc) {
    const close = h('button', { class: 'cell clear icon-btn panel-close', 'aria-label': 'Закрыть' }, icon('i-close'));
    close.addEventListener('click', () => pop.close(this.el));
    const body = h('div', { class: 'panel-body' });
    for (const group of GROUPS) {
      const items = TEMPLATES.filter((t) => t.group === group);
      if (!items.length) continue;
      const grid = h('div', { class: 'layout-grid' });
      for (const t of items) {
        const preview = structuredClone(doc);
        switchLayout(preview, t.id);
        const canvas = h('canvas', { 'aria-hidden': 'true' });
        drawBanner(canvas, preview, this.editor.lang, 164);
        const b = h('button', { class: 'layout-card', 'aria-current': String(doc.template === t.id), 'aria-label': t.label }, canvas, h('span', { class: 'layout-name', text: t.label }));
        b.addEventListener('click', () => {
          let hidden: string[] = [];
          this.editor.change((d) => (hidden = switchLayout(d, t.id)));
          pop.close(this.el);
          if (hidden.length) toast(`Скрыто текстов: ${hidden.length}`, 'вернутся, если сменить раскладку обратно');
        });
        grid.append(b);
      }
      body.append(h('div', { class: 'layout-group caps', text: group }), grid);
    }
    this.el.replaceChildren(h('div', { class: 'panel-head' }, h('div', { class: 'panel-title' }, h('span', { text: 'Раскладка' })), close), body);
  }
}
