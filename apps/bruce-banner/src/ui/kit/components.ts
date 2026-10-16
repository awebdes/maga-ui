/**
 * Maga UI components, ported from prototype/js/components.js. Each init reads data-* attributes,
 * so markup is the API. Inits are idempotent and return a small typed handle.
 */
import { $, $$, clamp, emit, kit, pop, juice } from './core';

export interface SegApi {
  set(value: string, opts?: { silent?: boolean; focus?: boolean }): void;
  readonly value: string;
  place(animate?: boolean): void;
}

export interface FsApi {
  set(v: number, opts?: { silent?: boolean; final?: boolean }): void;
  readonly value: number;
  reset(): void;
}

export interface SelectApi {
  set(v: string): void;
}

const segs = new WeakMap<HTMLElement, SegApi>();
const sliders = new WeakMap<HTMLElement, FsApi>();
const selects = new WeakMap<HTMLElement, SelectApi>();
const done = new WeakSet<HTMLElement>();

const valueOf = (b: HTMLElement) => b.dataset.value ?? b.textContent!.trim();

/* ---------- Segmented control ---------- */

export function initSeg(el: HTMLElement): SegApi {
  const existing = segs.get(el);
  if (existing) return existing;
  const btns = $$<HTMLButtonElement>(':scope > button', el);
  el.setAttribute('role', 'radiogroup');
  const ind = document.createElement('span');
  ind.className = 'seg-ind';
  el.prepend(ind);
  let current = btns.find((b) => b.getAttribute('aria-checked') === 'true') || btns[0];

  function place(animate = true) {
    if (!current || !current.offsetWidth) return;
    if (!animate) el.classList.add('no-anim');
    ind.style.width = current.offsetWidth + 'px';
    ind.style.transform = `translateX(${current.offsetLeft}px)`;
    if (!animate) requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('no-anim')));
  }
  function select(btn: HTMLButtonElement | undefined, { silent = false, focus = false } = {}) {
    if (!btn) return;
    const changed = btn !== current;
    current = btn;
    btns.forEach((b) => {
      const on = b === btn;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    place(true);
    if (focus) btn.focus();
    if (changed && !silent) emit(el, 'change', { value: valueOf(btn) });
  }
  btns.forEach((b) => {
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => select(b));
  });
  el.addEventListener('keydown', (e) => {
    const i = btns.indexOf(current);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      select(btns[(i + 1) % btns.length], { focus: true });
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      select(btns[(i - 1 + btns.length) % btns.length], { focus: true });
    }
  });
  select(current, { silent: true });
  place(false);
  new ResizeObserver(() => place(false)).observe(el);
  const api: SegApi = {
    set(value, opts) {
      select(
        btns.find((b) => valueOf(b) === String(value)),
        opts,
      );
    },
    get value() {
      return valueOf(current);
    },
    place,
  };
  segs.set(el, api);
  return api;
}

/* ---------- Fill slider ----------
   tap = jump (animated) · drag = relative (no jump) · Shift = fine
   overdrag rubber-bands the whole cell · snaps to default · double-click resets */

export function initFs(el: HTMLElement): FsApi {
  const existing = sliders.get(el);
  if (existing) return existing;
  const d = el.dataset;
  const min = Number(d.min ?? 0);
  const max = Number(d.max ?? 100);
  const step = Number(d.step ?? 1);
  const vertical = el.classList.contains('vertical');
  const fmt = d.format || 'int';
  let value = Number(d.value ?? min);
  const def = Number(d.default ?? value);
  const label = d.label || '';

  el.innerHTML = `<div class="fs-fill"></div><div class="fs-text"><span class="fs-label"></span><span class="fs-value"></span></div>`;
  $('.fs-label', el)!.textContent = label;
  el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', label || d.aria || 'Value');
  el.setAttribute('aria-valuemin', String(min));
  el.setAttribute('aria-valuemax', String(max));
  if (vertical) el.setAttribute('aria-orientation', 'vertical');
  const valEl = $('.fs-value', el)!;

  const span = max - min;
  const quant = (v: number) => clamp(Math.round((v - min) / step) * step + min, min, max);
  const decimals = (String(step).split('.')[1] || '').length;
  function text(v: number) {
    const n = v.toFixed(decimals);
    if (fmt === 'pct') return n + '%';
    if (fmt === 'deg') return n + '°';
    if (fmt === 'x') return n + '×';
    if (fmt === 'k') return n + 'K';
    return n;
  }
  function render() {
    el.style.setProperty('--v', ((value - min) / span).toFixed(4));
    valEl.textContent = text(value);
    el.setAttribute('aria-valuenow', String(value));
    el.setAttribute('aria-valuetext', valEl.textContent);
  }
  function set(v: number, { silent = false, final = false } = {}) {
    const q = quant(v);
    const changed = q !== value;
    value = q;
    render();
    if (changed && !silent) emit(el, 'input', { value });
    if (final && !silent) emit(el, 'change', { value });
  }

  let start: { x: number; y: number; v: number; moved: boolean; rect: DOMRect } | null = null;
  let lastSnap = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || el.getAttribute('aria-disabled') === 'true') return;
    e.preventDefault();
    el.focus({ preventScroll: true });
    el.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY, v: value, moved: false, rect: el.getBoundingClientRect() };
  });
  el.addEventListener('pointermove', (e) => {
    if (!start) return;
    const delta = vertical ? start.y - e.clientY : e.clientX - start.x;
    if (!start.moved && Math.abs(delta) > 3) {
      start.moved = true;
      el.classList.add('is-dragging');
      kit.busy = true;
    }
    if (!start.moved) return;
    const size = vertical ? start.rect.height : start.rect.width;
    const fine = e.shiftKey ? 0.2 : 1;
    let raw = start.v + (delta / size) * span * fine;
    // rubber band past the ends
    let over = 0;
    if (raw < min) over = ((min - raw) / span) * size;
    if (raw > max) over = ((raw - max) / span) * size;
    const rb = over ? (1 - 1 / (over / 80 + 1)) * 14 : 0;
    el.style.setProperty('--stretch', (1 + rb / size).toFixed(4));
    el.style.setProperty('--squash', (1 - rb / size / 3).toFixed(4));
    if (raw < min) el.style.setProperty('--origin', vertical ? 'center top' : 'right center');
    if (raw > max) el.style.setProperty('--origin', vertical ? 'center bottom' : 'left center');
    // magnetic default
    const snap = Math.abs(raw - def) < span * 0.025 && def > min && def < max;
    if (snap) raw = def;
    if (snap && !lastSnap && navigator.vibrate) navigator.vibrate(4);
    lastSnap = snap;
    set(raw);
  });
  const end = (e: PointerEvent) => {
    if (!start) return;
    if (!start.moved && e.type === 'pointerup') {
      const r = start.rect;
      const t = vertical ? 1 - (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
      set(min + clamp(t, 0, 1) * span, { final: true });
    } else if (start.moved) {
      emit(el, 'change', { value });
    }
    el.classList.remove('is-dragging');
    el.style.setProperty('--stretch', '1');
    el.style.setProperty('--squash', '1');
    start = null;
    kit.busy = false;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => set(def, { final: true }));
  el.addEventListener('keydown', (e) => {
    const big = e.shiftKey ? 10 : 1;
    const inc = ({ ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 } as Record<string, number>)[e.key];
    if (inc) {
      e.preventDefault();
      set(value + inc * step * big, { final: true });
    } else if (e.key === 'Home') {
      e.preventDefault();
      set(min, { final: true });
    } else if (e.key === 'End') {
      e.preventDefault();
      set(max, { final: true });
    }
  });
  render();
  const api: FsApi = {
    set,
    get value() {
      return value;
    },
    reset: () => set(def, { final: true }),
  };
  sliders.set(el, api);
  return api;
}

/* ---------- Select (button + menu) ---------- */

export function initSelect(el: HTMLElement): SelectApi {
  const existing = selects.get(el);
  if (existing) return existing;
  const btn = $<HTMLButtonElement>('.select-btn', el)!;
  const menu = $<HTMLElement>('.menu', el)!;
  const labelEl = $('.select-value', btn) || btn;
  const items = $$<HTMLElement>('.menu-item', menu);
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  menu.setAttribute('role', 'menu');
  function choose(it: HTMLElement, silent = false) {
    items.forEach((x) => x.setAttribute('aria-checked', x === it ? 'true' : 'false'));
    labelEl.textContent = it.dataset.label || it.textContent!.trim();
    if (!silent) emit(el, 'change', { value: it.dataset.value });
  }
  items.forEach((it) => {
    it.setAttribute('role', 'menuitemradio');
    it.tabIndex = -1;
    if (!$('.check', it)) it.insertAdjacentHTML('beforeend', '<svg class="i i-sm check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>');
    it.addEventListener('click', () => {
      choose(it);
      pop.close(menu, { restore: kit.lastInputKeyboard });
    });
  });
  btn.addEventListener('click', () => pop.toggle(menu, btn));
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      pop.open(menu, btn);
    }
  });
  const initial = items.find((x) => x.getAttribute('aria-checked') === 'true') || items[0];
  choose(initial, true);
  const api: SelectApi = {
    set: (v) => {
      const it = items.find((x) => x.dataset.value === v);
      if (it) choose(it, true);
    },
  };
  selects.set(el, api);
  return api;
}

/* ---------- Menu trigger ---------- */

export function initMenuTrigger(btn: HTMLElement) {
  if (done.has(btn)) return;
  done.add(btn);
  const menu = document.getElementById(btn.dataset.menu!);
  if (!menu) return;
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', menu.id);
  menu.setAttribute('role', 'menu');
  $$<HTMLElement>('.menu-item', menu).forEach((it) => {
    if (!it.getAttribute('role')) it.setAttribute('role', 'menuitem');
    it.tabIndex = -1;
  });
  btn.addEventListener('click', () => pop.toggle(menu, btn));
}

/* ---------- Switch ---------- */

export function initSwitch(el: HTMLElement) {
  if (done.has(el)) return;
  done.add(el);
  el.setAttribute('role', 'switch');
  if (!el.hasAttribute('aria-checked')) el.setAttribute('aria-checked', 'false');
  const host = el.closest<HTMLElement>('.menu-item') || el;
  if (host === el) el.tabIndex = 0;
  host.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      host.click();
    }
  });
  host.addEventListener('click', () => {
    const on = el.getAttribute('aria-checked') !== 'true';
    el.setAttribute('aria-checked', on ? 'true' : 'false');
    emit(el, 'change', { value: on });
  });
}

/* ---------- Toggle button (aria-pressed) ---------- */

export function initToggle(el: HTMLElement) {
  if (done.has(el)) return;
  done.add(el);
  if (!el.hasAttribute('aria-pressed')) el.setAttribute('aria-pressed', 'false');
  el.addEventListener('click', () => {
    const on = el.getAttribute('aria-pressed') !== 'true';
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
    emit(el, 'change', { value: on });
  });
}

/* ---------- Sphere highlight follows the pointer ---------- */

function initSphereHover(scope: ParentNode) {
  scope.addEventListener('pointermove', (e) => {
    const sw = (e.target as Element).closest?.('.swatch, .mat-btn');
    if (!sw) return;
    const sp = $('.sphere', sw);
    if (!sp) return;
    const r = sp.getBoundingClientRect();
    const pe = e as PointerEvent;
    const x = clamp(((pe.clientX - r.left) / r.width) * 100, 10, 90);
    const y = clamp(((pe.clientY - r.top) / r.height) * 100, 10, 90);
    sp.style.setProperty('--hx', (x * 0.6 + 34 * 0.4).toFixed(1) + '%');
    sp.style.setProperty('--hy', (y * 0.6 + 28 * 0.4).toFixed(1) + '%');
  });
  scope.addEventListener('pointerout', (e) => {
    const sw = (e.target as Element).closest?.('.swatch, .mat-btn');
    if (!sw || sw.contains((e as PointerEvent).relatedTarget as Node)) return;
    const sp = $('.sphere', sw);
    sp?.style.removeProperty('--hx');
    sp?.style.removeProperty('--hy');
  });
}

/** Wires every component found under `scope`. Safe to call again after adding markup. */
export function initComponents(scope: ParentNode = document) {
  $$<HTMLElement>('.seg', scope).forEach(initSeg);
  $$<HTMLElement>('.fs', scope).forEach(initFs);
  $$<HTMLElement>('.select', scope).forEach(initSelect);
  $$<HTMLElement>('[data-menu]', scope).forEach(initMenuTrigger);
  $$<HTMLElement>('.switch', scope).forEach(initSwitch);
  $$<HTMLElement>('[data-toggle]', scope).forEach(initToggle);
  $$<HTMLElement>('[data-juice]', scope).forEach((el) => juice.bind(el));
  if (!done.has(scope as HTMLElement)) {
    done.add(scope as HTMLElement);
    initSphereHover(scope);
  }
}

export const segOf = (el: HTMLElement) => initSeg(el);
export const fsOf = (el: HTMLElement) => initFs(el);
