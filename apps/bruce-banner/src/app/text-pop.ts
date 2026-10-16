/**
 * The floating text editor: double-click a text on the banner and its copy opens right next to it,
 * every language at once, the one on screen focused. The banner redraws as you type.
 */
import { findLayer, frameBounds, layerNames } from '../engine';
import { pop } from '../ui/kit/core';
import { CopyFields } from './copy-fields';
import { h, icon } from './dom';
import { slotsOf } from './inspector';
import type { Stage } from './stage';
import type { Editor } from './state';

export class TextPop {
  private el: HTMLElement;
  private fields: CopyFields | null = null;
  private layerId: string | null = null;

  constructor(
    private editor: Editor,
    private stage: Stage,
  ) {
    this.el = h('section', { class: 'panel text-pop', role: 'dialog', 'aria-label': 'Текст на трёх языках', 'data-sticky': '' });
    document.body.append(this.el);
  }

  get isOpen() {
    return pop.isOpen(this.el);
  }

  open(layerId: string) {
    const doc = this.editor.doc;
    const l = doc && findLayer(doc, layerId);
    if (!doc || !l) return;
    this.editor.select(layerId);
    this.layerId = layerId;
    this.fields = new CopyFields(this.editor, slotsOf(l), { onEnter: () => this.close() });
    const close = h('button', { class: 'cell clear icon-btn panel-close', 'aria-label': 'Закрыть' }, icon('i-close'));
    close.addEventListener('click', () => this.close());
    const done = h('button', { class: 'cell sm primary', text: 'Готово' });
    done.addEventListener('click', () => this.close());
    this.el.replaceChildren(
      h('div', { class: 'panel-head' }, h('div', { class: 'panel-title' }, h('span', { text: layerNames(doc).get(l.id) ?? '' })), close),
      h('div', { class: 'panel-body' }, this.fields.el, h('div', { class: 'text-pop-foot' }, h('span', { class: 'hint', text: 'Enter — новая строка, ⌘Enter — готово' }), done)),
    );
    // fields autosize once they are in the document
    this.fields.sync();
    this.place();
    pop.open(this.el, null, {
      onClose: () => {
        this.layerId = null;
        this.fields = null;
        this.editor.end();
      },
    });
    requestAnimationFrame(() => this.fields?.focus(this.editor.lang));
  }

  close() {
    if (pop.isOpen(this.el)) pop.close(this.el);
  }

  sync() {
    if (!this.layerId) return;
    if (!this.editor.doc || !findLayer(this.editor.doc, this.layerId)) {
      this.close();
      return;
    }
    this.fields?.sync();
  }

  /**
   * Right under the edited text (it stays visible while typing), else above it; never under the
   * top chrome or the dock. It may cover other parts of the banner, as Figma's inline inputs do.
   */
  place() {
    const p = this.stage.active;
    const f = this.layerId ? this.stage.frameOf(this.layerId, p?.lang) : undefined;
    if (!p || !f) return;
    const b = frameBounds(f);
    const [x0, y0] = this.stage.toScreen(p, b.x, b.y);
    const [, y1] = this.stage.toScreen(p, b.x, b.bottom);
    const w = 380;
    const height = this.el.offsetHeight || 300;
    const minTop = 80;
    const maxBottom = innerHeight - 96;
    let top = y1 + 12;
    if (top + height > maxBottom) top = y0 - 12 - height >= minTop ? y0 - 12 - height : Math.max(minTop, maxBottom - height);
    this.el.style.width = `${w}px`;
    this.el.style.left = `${Math.max(12, Math.min(innerWidth - w - 12, x0 - 12))}px`;
    this.el.style.top = `${top}px`;
    this.el.style.bottom = '';
  }
}
