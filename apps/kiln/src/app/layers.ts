import { $, $$ } from '../ui/kit/core';
import { swatchColor } from '../scene/materials';
import { SLOTS, findGroup, findObject, type SceneDoc } from '../doc/scene';
import type { Editor } from './editor';
import type { Actions } from './actions';
import type { Overlay } from './overlay';
import { objectIcon, symbolIcon } from './icons';

interface Row {
  id: string;
  /** 1 = a group's child */
  depth: 0 | 1;
  group: boolean;
}

/**
 * The Objects island: every object and group of the document, in document order. Click selects
 * (a group's child selects inside the group), Shift or ⌘ adds, double-click renames, the eye
 * hides. Hovering a row outlines the object in the viewport.
 */
export class Layers {
  private list = $('#layers-list')!;
  private count = $('#layers-count')!;
  private key = '';
  private collapsed = new Set<string>();
  private rows: Row[] = [];
  private renaming = false;
  private selKey = '';

  constructor(
    private editor: Editor,
    private actions: Actions,
    overlay: Overlay,
    private svgOf: (ref: string) => string | null,
  ) {
    const list = this.list;
    list.addEventListener('click', (e) => this.click(e));
    list.addEventListener('dblclick', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.layer');
      if (row && (e.target as HTMLElement).closest('.layer-name')) this.rename(row.dataset.id!);
    });
    list.addEventListener('pointerover', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.layer');
      overlay.hover = row ? row.dataset.id! : null;
    });
    list.addEventListener('pointerleave', () => (overlay.hover = null));
    list.addEventListener('keydown', (e) => this.key_(e));
  }

  /** Rebuilds rows when names, order, groups or visibility change; selection only restyles. */
  render() {
    if (this.renaming) return;
    const { doc, selection, entered } = this.editor;
    const key = JSON.stringify([
      doc.objects.map((o) => [o.id, o.name, o.kind, o.group, o.hidden, o.glyph?.ref, swatchColor(o.materials[SLOTS[o.kind][0].id] ?? Object.values(o.materials)[0])]),
      doc.groups.map((g) => [g.id, g.name, g.hidden]),
      [...this.collapsed],
    ]);
    if (key !== this.key) {
      this.key = key;
      this.build(doc);
    }
    const sel = new Set(selection);
    const selKey = selection.join();
    const reveal = selKey !== this.selKey;
    this.selKey = selKey;
    let focusable = false;
    for (const el of $$<HTMLElement>('.layer', this.list)) {
      const id = el.dataset.id!;
      const on = sel.has(id);
      el.setAttribute('aria-selected', String(on));
      el.classList.toggle('is-entered', id === entered);
      el.tabIndex = on && !focusable ? 0 : -1;
      // a pick in the viewport scrolls the list to the row
      if (on && !focusable && reveal) el.scrollIntoView({ block: 'nearest' });
      if (on) focusable = true;
    }
    if (!focusable) this.list.querySelector<HTMLElement>('.layer')?.setAttribute('tabindex', '0');
    const n = doc.objects.length;
    this.count.textContent = n ? String(n) : '';
    this.list.classList.toggle('is-empty', !n);
  }

  private build(doc: SceneDoc) {
    const rows: Row[] = [];
    const seen = new Set<string>();
    for (const o of doc.objects) {
      if (!o.group) {
        rows.push({ id: o.id, depth: 0, group: false });
        continue;
      }
      if (seen.has(o.group)) continue;
      seen.add(o.group);
      rows.push({ id: o.group, depth: 0, group: true });
      if (!this.collapsed.has(o.group)) for (const c of doc.objects) if (c.group === o.group) rows.push({ id: c.id, depth: 1, group: false });
    }
    this.rows = rows;
    this.list.textContent = '';
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'layers-empty';
      empty.textContent = 'No objects yet';
      this.list.appendChild(empty);
      return;
    }
    for (const r of rows) this.list.appendChild(this.row(doc, r));
  }

  private row(doc: SceneDoc, r: Row) {
    const el = document.createElement('div');
    el.className = 'layer';
    el.dataset.id = r.id;
    el.setAttribute('role', 'treeitem');
    el.setAttribute('aria-level', String(r.depth + 1));
    el.tabIndex = -1;
    const item = r.group ? findGroup(doc, r.id)! : findObject(doc, r.id)!;
    const hidden = item.hidden === true || (!r.group && r.depth === 1 && findGroup(doc, findObject(doc, r.id)!.group!)?.hidden === true);
    el.classList.toggle('is-hidden', hidden);
    if (r.group) {
      const open = !this.collapsed.has(r.id);
      el.setAttribute('aria-expanded', String(open));
      const caret = document.createElement('button');
      caret.className = 'layer-caret';
      caret.setAttribute('aria-label', open ? 'Collapse group' : 'Expand group');
      caret.tabIndex = -1;
      el.appendChild(caret);
    } else if (r.depth) {
      const indent = document.createElement('span');
      indent.className = 'layer-indent';
      el.appendChild(indent);
    }
    const icon = document.createElement('span');
    icon.className = 'layer-icon';
    icon.appendChild(r.group ? symbolIcon('i-group') : objectIcon(findObject(doc, r.id)!, this.svgOf));
    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = item.name;
    el.append(icon, name);
    if (!r.group) {
      const o = findObject(doc, r.id)!;
      const spec = o.materials[SLOTS[o.kind][0].id] ?? Object.values(o.materials)[0];
      const dot = document.createElement('span');
      dot.className = 'layer-dot';
      if (spec) dot.style.setProperty('--mat', swatchColor(spec));
      el.appendChild(dot);
    } else {
      const n = doc.objects.filter((o) => o.group === r.id).length;
      const count = document.createElement('span');
      count.className = 'layer-sub mono';
      count.textContent = String(n);
      el.appendChild(count);
    }
    const eye = document.createElement('button');
    eye.className = 'layer-eye';
    eye.tabIndex = -1;
    eye.setAttribute('aria-label', item.hidden ? `Show ${item.name}` : `Hide ${item.name}`);
    eye.setAttribute('aria-pressed', String(item.hidden === true));
    eye.appendChild(symbolIcon(item.hidden ? 'i-eye-off' : 'i-eye', 'i i-sm'));
    el.appendChild(eye);
    return el;
  }

  private click(e: MouseEvent) {
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>('.layer');
    if (!row || t.closest('input')) return;
    const id = row.dataset.id!;
    if (t.closest('.layer-eye')) {
      this.actions.toggleHidden([id]);
      return;
    }
    if (t.closest('.layer-caret')) {
      if (this.collapsed.has(id)) this.collapsed.delete(id);
      else this.collapsed.add(id);
      this.render();
      return;
    }
    this.selectRow(id, e.shiftKey || e.metaKey || e.ctrlKey);
  }

  private selectRow(id: string, additive: boolean) {
    const { editor } = this;
    const o = findObject(editor.doc, id);
    if (o?.group) {
      if (additive && editor.entered === o.group) editor.select([id], { toggle: true });
      else editor.enter(o.group, id);
    } else editor.select([id], { toggle: additive });
  }

  private key_(e: KeyboardEvent) {
    if (this.renaming) return;
    const rows = $$<HTMLElement>('.layer', this.list);
    const i = rows.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (!next) return;
      this.selectRow(next.dataset.id!, false);
      next.focus();
    } else if ((e.key === 'Enter' || e.key === 'F2') && i >= 0) {
      e.preventDefault();
      this.rename(rows[i].dataset.id!);
    }
  }

  /** Inline rename: Enter or leaving the field commits, Esc cancels. */
  rename(id: string) {
    const row = this.list.querySelector<HTMLElement>(`.layer[data-id="${CSS.escape(id)}"]`);
    const nameEl = row?.querySelector('.layer-name');
    if (!row || !nameEl) return;
    const before = nameEl.textContent ?? '';
    const input = document.createElement('input');
    input.className = 'layer-input';
    input.value = before;
    input.maxLength = 48;
    input.setAttribute('aria-label', 'Name');
    this.renaming = true;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      this.renaming = false;
      const v = input.value.trim();
      this.key = '';
      if (commit && v && v !== before) this.actions.rename(id, v);
      else this.render();
      this.list.querySelector<HTMLElement>(`.layer[data-id="${CSS.escape(id)}"]`)?.focus();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  }

  /** e2e and the keyboard: rows as listed */
  get order() {
    return this.rows.map((r) => r.id);
  }
}
