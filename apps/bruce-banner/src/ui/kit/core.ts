/**
 * Maga UI core, ported from prototype/js/core.js: helpers, springs, one rAF ticker, rim light,
 * proximity dimming, idle fade, juice bloom, tooltips, popovers, toast, odometer.
 * Markup stays the API: `.glass`, `.float`, `[data-tip]`, `[data-juice]`, `.menu`.
 */

export const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as T | null;
export const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => Array.from(r.querySelectorAll(s)) as T[];
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const emit = <T>(el: EventTarget, name: string, detail?: T) => el.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));

const root = document.documentElement;
const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
export const reduced = () => mqReduce.matches || root.classList.contains('reduce-motion');

/** Per-app names: the localStorage prefix and the tooltip id. Set before `initTips`. */
export const kitConfig = { prefix: 'mui:', tipId: 'mui-tip' };
export function configureKit(c: Partial<typeof kitConfig>) {
  Object.assign(kitConfig, c);
}

export const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(kitConfig.prefix + k);
      return v === null ? d : (JSON.parse(v) as T);
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(kitConfig.prefix + k, JSON.stringify(v));
    } catch {
      /* storage blocked — the page works without it */
    }
  },
};

/** Shared UI state. */
export const kit = {
  app: null as HTMLElement | null,
  openCount: 0,
  /** set while a drag or long action runs: keeps the chrome awake */
  busy: false,
  lastInputKeyboard: false,
  /** focus mode (islands dim away from the cursor, chrome fades when idle); the app turns it on */
  settings: { focus: false },
};

/* ---------- spring ---------- */

export class Spring {
  value: number;
  target: number;
  velocity = 0;
  stiffness: number;
  damping: number;
  mass: number;
  precision: number;
  constructor(value = 0, opts: { stiffness?: number; damping?: number; mass?: number; precision?: number } = {}) {
    this.value = value;
    this.target = value;
    this.stiffness = opts.stiffness ?? 170;
    this.damping = opts.damping ?? 20;
    this.mass = opts.mass ?? 1;
    this.precision = opts.precision ?? 0.001;
  }
  set(target: number) {
    this.target = target;
    return this;
  }
  jump(v: number) {
    this.value = this.target = v;
    this.velocity = 0;
    return this;
  }
  step(dt: number) {
    // fixed sub-steps keep stiff springs stable on slow frames
    const steps = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const f = -this.stiffness * (this.value - this.target) - this.damping * this.velocity;
      this.velocity += (f / this.mass) * h;
      this.value += this.velocity * h;
    }
    if (this.done) {
      this.value = this.target;
      this.velocity = 0;
    }
    return this.value;
  }
  get done() {
    return Math.abs(this.velocity) < this.precision && Math.abs(this.value - this.target) < this.precision;
  }
}

/* ---------- ticker: one rAF loop for everything ---------- */

type TickFn = (dt: number, t: number) => boolean | void;
const subs = new Set<TickFn>();
let rafId = 0;
let last = 0;
function frame(t: number) {
  const dt = Math.min(0.05, (t - (last || t)) / 1000);
  last = t;
  subs.forEach((fn) => {
    if (fn(dt, t / 1000) === false) subs.delete(fn);
  });
  rafId = subs.size ? requestAnimationFrame(frame) : 0;
  if (!rafId) last = 0;
}
/** Runs `fn` every frame until it returns false or the returned unsubscribe is called. */
export function tick(fn: TickFn) {
  subs.add(fn);
  if (!rafId) rafId = requestAnimationFrame(frame);
  return () => subs.delete(fn);
}

/* ---------- pointer, rim light, proximity ---------- */

export const pointer = { x: -9999, y: -9999, inside: false, type: 'mouse' };
let rimEls: HTMLElement[] = [];
let floatEls: HTMLElement[] = [];
const rimOn = new WeakSet<HTMLElement>();

export function refreshRim() {
  rimEls = $$('.glass, .rim');
  floatEls = $$('.chrome .float');
}

let pwQueued = false;
export function pointerWork() {
  if (pwQueued) return;
  pwQueued = true;
  requestAnimationFrame(runPointerWork);
}
function rectDist(r: DOMRect, x: number, y: number) {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}
function runPointerWork() {
  pwQueued = false;
  const { x, y, inside } = pointer;
  const touch = pointer.type === 'touch';
  for (const el of rimEls) {
    const r = el.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > innerHeight) continue;
    const d = inside && !touch ? rectDist(r, x, y) : 999;
    const rim = clamp(1 - d / 120, 0, 1);
    if (rim > 0 || rimOn.has(el)) {
      el.style.setProperty('--mx', (x - r.left).toFixed(1) + 'px');
      el.style.setProperty('--my', (y - r.top).toFixed(1) + 'px');
      el.style.setProperty('--rim', rim.toFixed(3));
      if (rim > 0) rimOn.add(el);
      else rimOn.delete(el);
    }
  }
  const prox = kit.app && kit.settings.focus && !touch;
  for (const el of floatEls) {
    if (!prox) {
      el.style.setProperty('--dim-floor', '1');
      continue;
    }
    const r = el.getBoundingClientRect();
    const d = inside ? rectDist(r, x, y) : 9999;
    const hasOpen = kit.openCount > 0 && el.querySelector('.is-open');
    const p = hasOpen ? 1 : clamp(1 - (d - 30) / 340, 0, 1);
    el.style.setProperty('--dim-floor', '0.42');
    el.style.setProperty('--prox', (p * p * (3 - 2 * p)).toFixed(3));
  }
}

window.addEventListener(
  'pointermove',
  (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.inside = true;
    pointer.type = e.pointerType;
    pointerWork();
  },
  { passive: true },
);
document.addEventListener('pointerleave', () => {
  pointer.inside = false;
  pointerWork();
});

/* ---------- idle: chrome steps back after a pause ---------- */

let idleTimer = 0;
export function wake() {
  const app = kit.app;
  if (!app) return;
  app.classList.remove('is-idle');
  clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    const overChrome = document.querySelector('.chrome .float:hover');
    const ae = document.activeElement;
    const focusInChrome = ae && ae.closest('.chrome') && (ae.matches('input, textarea') || kit.lastInputKeyboard);
    if (kit.settings.focus && kit.openCount === 0 && !overChrome && !focusInChrome && !kit.busy) app.classList.add('is-idle');
  }, 2600);
}
(['pointermove', 'pointerdown', 'keydown', 'wheel'] as const).forEach((ev) => window.addEventListener(ev, () => wake(), { passive: true }));

window.addEventListener('keydown', () => (kit.lastInputKeyboard = true), true);
window.addEventListener('pointerdown', () => (kit.lastInputKeyboard = false), true);
window.addEventListener(
  'pointermove',
  (e) => {
    if (Math.abs(e.movementX) + Math.abs(e.movementY) > 6) kit.lastInputKeyboard = false;
  },
  { passive: true },
);

/* ---------- juice: bloom that lives behind the glass ---------- */

export const juice = (() => {
  let layer: { el: HTMLElement; b1: HTMLElement; b2: HTMLElement; b3: HTMLElement } | null = null;
  let active: HTMLElement | null = null;
  let running = false;
  let offAt = 0;
  const ax = new Spring(0, { stiffness: 120, damping: 18 });
  const ay = new Spring(0, { stiffness: 120, damping: 18 });
  const burst = new Spring(0, { stiffness: 260, damping: 14 });
  const charge = new Spring(0, { stiffness: 90, damping: 16 });
  const bound = new WeakSet<HTMLElement>();

  function getLayer() {
    if (layer) return layer;
    const el = $('.app > .juice');
    if (!el) return null;
    const [b2, b3, b1] = $$('i', el);
    layer = { el, b1, b2, b3 };
    return layer;
  }
  function center(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }
  function loop(dt: number, t: number) {
    const L = getLayer();
    if (!L) return false;
    ax.step(dt);
    ay.step(dt);
    burst.step(dt);
    charge.step(dt);
    const s = 1 + burst.value * 0.45;
    const c = 0.6 + charge.value * 0.4;
    const m = reduced() ? 0 : 1;
    const x = ax.value;
    const y = ay.value;
    L.b1.style.transform = `translate3d(${x + Math.sin(t * 0.8) * 16 * m}px, ${y + Math.cos(t * 1.1) * 10 * m}px, 0) scale(${s * c})`;
    L.b2.style.transform = `translate3d(${x + (120 + Math.sin(t * 0.55) * 46 * m) * c}px, ${y + (-70 + Math.cos(t * 0.7) * 34 * m) * c}px, 0) scale(${(0.8 + burst.value * 0.6) * c})`;
    L.b3.style.transform = `translate3d(${x + (-110 + Math.cos(t * 0.65) * 40 * m) * c}px, ${y + (40 + Math.sin(t * 0.9) * 26 * m) * c}px, 0) scale(${s * 0.9 * c})`;
    if (!active && performance.now() - offAt > 1200) {
      running = false;
      return false;
    }
  }
  function run() {
    if (running) return;
    running = true;
    tick(loop);
  }
  function on(el: HTMLElement) {
    const L = getLayer();
    if (!L) return;
    const [x, y] = center(el);
    if (!L.el.classList.contains('is-on')) {
      ax.jump(x);
      ay.jump(y);
      charge.jump(0);
    }
    active = el;
    ax.set(x);
    ay.set(y);
    charge.set(1);
    el.classList.add('is-charged');
    L.el.classList.add('is-on');
    run();
  }
  function off(el: HTMLElement) {
    el.classList.remove('is-charged');
    const L = getLayer();
    if (active === el && L) {
      active = null;
      offAt = performance.now();
      charge.set(0);
      burst.set(0);
      L.el.classList.remove('is-on');
    }
  }
  function shock(el: HTMLElement) {
    if (reduced()) return;
    const r = el.getBoundingClientRect();
    const ring = document.createElement('div');
    ring.className = 'shock';
    Object.assign(ring.style, {
      left: r.left + 'px',
      top: r.top + 'px',
      width: r.width + 'px',
      height: r.height + 'px',
      borderRadius: getComputedStyle(el).borderRadius,
    });
    document.body.appendChild(ring);
    setTimeout(() => ring.remove(), 720);
  }
  /** Keeps the bloom lit while a long action (an export) runs on this button. */
  function hold(el: HTMLElement, onHold: boolean) {
    if (onHold) on(el);
    else off(el);
  }
  function bind(el: HTMLElement) {
    if (bound.has(el)) return;
    bound.add(el);
    el.classList.add('juice-btn');
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'touch') on(el);
    });
    el.addEventListener('pointerleave', () => {
      if (!el.classList.contains('is-held')) off(el);
    });
    el.addEventListener('focus', () => el.matches(':focus-visible') && on(el));
    el.addEventListener('blur', () => {
      if (!el.classList.contains('is-held')) off(el);
    });
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') on(el);
      burst.set(1);
      run();
    });
    const release = () => burst.set(0);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('click', () => {
      shock(el);
      burst.velocity += 6;
      burst.set(0);
      run();
      if (pointer.type === 'touch') setTimeout(() => off(el), 900);
    });
  }
  return { bind, on, off, shock, hold };
})();

/* ---------- tooltips ---------- */

export let hideTip = () => {};

export function initTips() {
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'tooltip');
  tip.id = kitConfig.tipId;
  document.body.appendChild(tip);
  let showTimer = 0;
  let lastHide = 0;
  let current: HTMLElement | null = null;

  function place(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    const below = r.top < 64;
    const side = el.dataset.tipSide;
    let x = r.left + r.width / 2 - tr.width / 2;
    let y = below ? r.bottom + 8 : r.top - tr.height - 8;
    if (side === 'left') {
      x = r.left - tr.width - 10;
      y = r.top + r.height / 2 - tr.height / 2;
    } else if (side === 'right') {
      x = r.right + 10;
      y = r.top + r.height / 2 - tr.height / 2;
    }
    x = clamp(x, 8, innerWidth - tr.width - 8);
    tip.style.setProperty('--tx', x + 'px');
    tip.style.setProperty('--ty', y + 'px');
    tip.style.setProperty('--tip-dy', below ? '-4px' : '4px');
  }
  function show(el: HTMLElement) {
    current = el;
    tip.textContent = '';
    const label = document.createElement('span');
    label.textContent = el.dataset.tip ?? '';
    tip.appendChild(label);
    if (el.dataset.kbd) {
      const k = document.createElement('span');
      k.className = 'kbd';
      k.textContent = el.dataset.kbd;
      tip.appendChild(k);
    }
    const warm = performance.now() - lastHide < 700;
    tip.classList.toggle('instant', warm);
    tip.classList.remove('is-on');
    place(el);
    requestAnimationFrame(() => {
      if (current !== el) return;
      place(el);
      tip.classList.add('is-on');
    });
    el.setAttribute('aria-describedby', kitConfig.tipId);
  }
  function hide() {
    clearTimeout(showTimer);
    if (current) {
      current.removeAttribute('aria-describedby');
      lastHide = performance.now();
    }
    current = null;
    tip.classList.remove('is-on');
  }
  function schedule(el: HTMLElement) {
    clearTimeout(showTimer);
    if (el.getAttribute('aria-expanded') === 'true') return;
    const warm = performance.now() - lastHide < 700;
    showTimer = window.setTimeout(() => show(el), warm ? 0 : 520);
  }
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = (e.target as Element).closest<HTMLElement>('[data-tip]');
    if (el && el !== current) schedule(el);
  });
  document.addEventListener('pointerout', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-tip]');
    if (el && !el.contains(e.relatedTarget as Node)) hide();
  });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('focusin', (e) => {
    const el = (e.target as Element).closest?.<HTMLElement>('[data-tip]');
    if (el && el.matches(':focus-visible')) schedule(el);
  });
  document.addEventListener('focusout', hide);
  window.addEventListener('scroll', hide, true);
  hideTip = hide;
}

/* ---------- popovers (menus, panels) ---------- */

interface PopState {
  trigger: HTMLElement | null;
  onClose?: () => void;
}

export const pop = (() => {
  const open = new Map<HTMLElement, PopState>();
  const hl = new WeakMap<HTMLElement, (item: HTMLElement | null) => void>();

  function highlight(menu: HTMLElement) {
    if (hl.has(menu)) return;
    const bar = document.createElement('span');
    bar.className = 'menu-hl';
    menu.prepend(bar);
    let hot: HTMLElement | null = null;
    const move = (item: HTMLElement | null) => {
      if (!item) {
        bar.style.opacity = '0';
        return;
      }
      const first = bar.style.opacity !== '1';
      if (first) bar.style.transition = 'opacity 160ms';
      bar.style.transform = `translateY(${item.offsetTop}px)`;
      bar.style.height = item.offsetHeight + 'px';
      bar.style.opacity = '1';
      if (first) requestAnimationFrame(() => (bar.style.transition = ''));
    };
    menu.addEventListener('pointermove', (e) => {
      const item = (e.target as Element).closest<HTMLElement>('.menu-item');
      if (item && item !== hot) {
        hot = item;
        move(item);
      }
    });
    menu.addEventListener('pointerleave', () => {
      hot = null;
      move(null);
    });
    menu.addEventListener('focusin', (e) => {
      const item = (e.target as Element).closest<HTMLElement>('.menu-item');
      if (item) move(item);
    });
    hl.set(menu, move);
  }
  const items = (menu: HTMLElement) => $$<HTMLElement>('.menu-item:not([disabled])', menu);

  function openPop(p: HTMLElement, trigger: HTMLElement | null, opts: { onClose?: () => void; focus?: boolean } = {}) {
    if (open.has(p)) return;
    open.forEach((_, other) => {
      if (!other.contains(p)) closePop(other);
    });
    if (p.classList.contains('menu')) highlight(p);
    p.classList.add('is-open');
    trigger?.setAttribute('aria-expanded', 'true');
    open.set(p, { trigger, onClose: opts.onClose });
    kit.openCount = open.size;
    wake();
    hideTip();
    if (opts.focus !== false && p.classList.contains('menu')) {
      const checked = p.querySelector<HTMLElement>('.menu-item[aria-checked="true"]') || items(p)[0];
      if (checked && kit.lastInputKeyboard) setTimeout(() => checked.focus(), 30);
    }
    setTimeout(refreshRim, 0);
  }
  function closePop(p: HTMLElement, { restore = false } = {}) {
    const st = open.get(p);
    if (!st) return;
    p.classList.remove('is-open');
    if (st.trigger) {
      st.trigger.setAttribute('aria-expanded', 'false');
      if (restore) st.trigger.focus();
    }
    open.delete(p);
    kit.openCount = open.size;
    hl.get(p)?.(null);
    st.onClose?.();
    wake();
  }
  function toggle(p: HTMLElement, trigger: HTMLElement | null, opts?: { onClose?: () => void; focus?: boolean }) {
    if (open.has(p)) closePop(p);
    else openPop(p, trigger, opts);
  }
  document.addEventListener(
    'pointerdown',
    (e) => {
      open.forEach((st, p) => {
        const t = e.target as Node;
        if (p.contains(t)) return;
        if (st.trigger && st.trigger.contains(t)) return;
        if (p.dataset.sticky !== undefined) return;
        closePop(p);
      });
    },
    true,
  );
  document.addEventListener('keydown', (e) => {
    const pops = Array.from(open.keys());
    const top = pops[pops.length - 1];
    if (!top) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closePop(top, { restore: true });
      return;
    }
    if (!top.classList.contains('menu')) return;
    const list = items(top);
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[n].focus();
    }
  });
  return {
    open: openPop,
    close: closePop,
    toggle,
    enhance: highlight,
    isOpen: (p: HTMLElement) => open.has(p),
    closeAll: () => open.forEach((_, p) => closePop(p)),
  };
})();

/* ---------- toast ---------- */

let toastEl: HTMLElement | null = null;
let toastTimer = 0;
export function toast(text: string, meta = '', tone: 'ok' | 'error' = 'ok') {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast glass';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastEl);
  }
  const icon = tone === 'ok' ? '<path d="M5 12.5l4.5 4.5L19 7.5"/>' : '<path d="M12 7v6"/><path d="M12 16.5v.5"/>';
  toastEl.innerHTML = `<span class="dot ${tone}"><svg class="i" viewBox="0 0 24 24">${icon}</svg></span><span class="t"></span>${meta ? '<span class="meta"></span>' : ''}`;
  toastEl.querySelector('.t')!.textContent = text;
  if (meta) toastEl.querySelector('.meta')!.textContent = meta;
  toastEl.classList.remove('is-on');
  void toastEl.offsetWidth;
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.classList.remove('is-on'), tone === 'ok' ? 2800 : 5200);
}

/* ---------- odometer ---------- */

const odoValue = new WeakMap<HTMLElement, string>();
export function odo(el: HTMLElement, value: string | number) {
  const str = String(value);
  if (odoValue.get(el) === str) return;
  const prev = odoValue.get(el) ?? '';
  odoValue.set(el, str);
  if (el.children.length !== str.length) {
    el.innerHTML = str
      .split('')
      .map((ch) => (/\d/.test(ch) ? `<span class="odo-digit"><span>0<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9</span></span>` : `<span class="odo-ch">${ch}</span>`))
      .join('');
  }
  Array.from(el.children).forEach((cell, i) => {
    const col = cell.firstElementChild as HTMLElement | null;
    if (!col || !cell.classList.contains('odo-digit')) return;
    const d = Number(str[i]);
    col.style.transform = `translateY(${-d * 1.3}em)`;
    if (!prev) {
      col.style.transition = 'none';
      requestAnimationFrame(() => (col.style.transition = ''));
    }
  });
}

export const fmtBytes = (n: number) => {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
};
