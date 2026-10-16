import { $, $$, clamp, pop } from '../ui/kit/core';
import { SHORTLIST, loadAllGlyphs, searchGlyphs, type Glyph } from './glyphs';
import { svgIcon } from './icons';

/** add: a new icon object · replace: the selected object's icon · new: a scene with this icon */
export type LibraryMode = 'add' | 'replace' | 'new';

const TITLES: Record<LibraryMode, string> = {
  add: 'Add an icon',
  replace: 'Replace the icon',
  new: 'New scene from an icon',
};

/** The Phosphor icon popover. One instance, opened in a mode next to whatever opened it. */
export class Library {
  mode: LibraryMode = 'add';
  /** icon name marked as current (replace mode) */
  current: string | null = null;
  onPick: (g: Glyph, mode: LibraryMode) => void = () => {};
  onUpload: (mode: LibraryMode) => void = () => {};

  private el = $('#glyph-pop')!;
  private grid = $('#glyph-grid')!;
  private head = $('#glyph-head')!;
  private search = $<HTMLInputElement>('#glyph-search')!;
  private title = $('#glyph-mode')!;
  private seq = 0;
  private shown: Glyph[] = SHORTLIST;

  constructor() {
    this.render(SHORTLIST, 'Banking');
    this.search.addEventListener('input', () => this.find());
    $('#glyph-open')!.addEventListener('click', () => {
      const mode = this.mode;
      this.close();
      this.onUpload(mode);
    });
  }

  get isOpen() {
    return pop.isOpen(this.el);
  }

  open(mode: LibraryMode, anchor: HTMLElement, current: string | null = null) {
    this.mode = mode;
    this.current = current;
    this.title.textContent = TITLES[mode];
    this.markCurrent();
    this.place(anchor);
    if (!this.isOpen) pop.open(this.el, anchor);
    setTimeout(() => this.search.focus(), 60);
  }

  close() {
    pop.close(this.el);
  }

  /** Below a top-left trigger, above the bottom bar, else to the right of the layers island. */
  private place(anchor: HTMLElement) {
    const s = this.el.style;
    const w = 344;
    const h = 452;
    const a = anchor.getBoundingClientRect();
    s.top = s.bottom = s.left = '';
    if (anchor.closest('.float.bc')) {
      const bar = (anchor.closest('.island') ?? anchor).getBoundingClientRect();
      s.left = `${clamp(a.left, 16, innerWidth - w - 16)}px`;
      s.bottom = `${innerHeight - bar.top + 10}px`;
      s.setProperty('--menu-origin', 'bottom left');
    } else if (anchor.closest('.float.tl')) {
      s.left = `${clamp(a.left, 16, innerWidth - w - 16)}px`;
      s.top = `${a.bottom + 10}px`;
      s.setProperty('--menu-origin', 'top left');
    } else {
      const l = ($('#layers') ?? anchor).getBoundingClientRect();
      s.left = `${clamp(l.right + 12, 16, innerWidth - w - 16)}px`;
      s.top = `${clamp(l.top, 16, innerHeight - h - 16)}px`;
      s.setProperty('--menu-origin', 'top left');
    }
  }

  private markCurrent() {
    $$('.glyph-cell', this.grid).forEach((c) => c.setAttribute('aria-selected', String(c.dataset.name === this.current)));
  }

  private async find() {
    const q = this.search.value;
    const seq = ++this.seq;
    if (!q.trim()) {
      this.render(SHORTLIST, 'Banking');
      return;
    }
    this.head.textContent = 'Searching…';
    const all = await loadAllGlyphs();
    if (seq !== this.seq) return;
    const found = searchGlyphs(all, q, 120);
    this.render(found, found.length ? `${found.length === 120 ? '120+' : found.length} icons` : 'No icons');
  }

  private render(list: Glyph[], head: string) {
    this.shown = list;
    this.head.textContent = head;
    this.grid.textContent = '';
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'glyph-empty';
      empty.textContent = 'Nothing found. Try “card”, “coin” or “home”.';
      this.grid.appendChild(empty);
      return;
    }
    for (const g of list) {
      const b = document.createElement('button');
      b.className = 'glyph-cell';
      b.dataset.name = g.name;
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(g.name === this.current));
      b.setAttribute('aria-label', g.name.replace(/-/g, ' '));
      b.dataset.tip = g.name.replace(/-/g, ' ');
      const icon = svgIcon(g.svg);
      if (icon) b.appendChild(icon);
      b.addEventListener('click', () => this.pick(g));
      this.grid.appendChild(b);
    }
  }

  private pick(g: Glyph) {
    const mode = this.mode;
    // replace stays open for trying icons one after another; add and new are done
    if (mode === 'replace') {
      this.current = g.name;
      this.markCurrent();
    } else this.close();
    this.onPick(g, mode);
  }

  /** e2e: the icons on screen */
  get visible() {
    return this.shown.map((g) => g.name);
  }
}
