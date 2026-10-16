/* Maga UI — core: helpers, springs, ticker, rim light, proximity, idle, juice, tooltips, popovers, toast */
(function () {
  "use strict";

  const MU = (window.MU = window.MU || {});
  const root = document.documentElement;

  /* ---------- helpers ---------- */

  MU.$ = (s, r = document) => r.querySelector(s);
  MU.$$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  MU.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  MU.lerp = (a, b, t) => a + (b - a) * t;
  MU.emit = (el, name, detail) => el.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
  const mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  MU.reduced = () => mqReduce.matches || root.classList.contains("reduce-motion");
  MU.store = {
    get(k, d) {
      try {
        const v = localStorage.getItem("mu:" + k);
        return v === null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem("mu:" + k, JSON.stringify(v));
      } catch (e) {
        /* storage blocked — the page works without it */
      }
    },
  };

  /* ---------- spring ---------- */

  class Spring {
    constructor(value = 0, opts = {}) {
      this.value = value;
      this.target = value;
      this.velocity = 0;
      this.stiffness = opts.stiffness ?? 170;
      this.damping = opts.damping ?? 20;
      this.mass = opts.mass ?? 1;
      this.precision = opts.precision ?? 0.001;
    }
    set(target) {
      this.target = target;
      return this;
    }
    jump(v) {
      this.value = this.target = v;
      this.velocity = 0;
      return this;
    }
    step(dt) {
      // fixed sub-steps keep stiff springs stable on slow frames
      const steps = Math.ceil(dt / 0.008);
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
  MU.Spring = Spring;

  /* ---------- ticker: one rAF loop for everything ---------- */

  const subs = new Set();
  let rafId = 0;
  let last = 0;
  function frame(t) {
    const dt = Math.min(0.05, (t - (last || t)) / 1000);
    last = t;
    subs.forEach((fn) => {
      if (fn(dt, t / 1000) === false) subs.delete(fn);
    });
    rafId = subs.size ? requestAnimationFrame(frame) : 0;
    if (!rafId) last = 0;
  }
  MU.tick = (fn) => {
    subs.add(fn);
    if (!rafId) rafId = requestAnimationFrame(frame);
    return () => subs.delete(fn);
  };

  /* ---------- pointer state ---------- */

  MU.pointer = { x: -9999, y: -9999, inside: false };
  window.addEventListener(
    "pointermove",
    (e) => {
      MU.pointer.x = e.clientX;
      MU.pointer.y = e.clientY;
      MU.pointer.inside = true;
      MU.pointer.type = e.pointerType;
      schedulePointerWork();
    },
    { passive: true }
  );
  document.addEventListener("pointerleave", () => {
    MU.pointer.inside = false;
    schedulePointerWork();
  });

  /* ---------- rim light + proximity (one pass per frame) ---------- */

  let rimEls = [];
  let floatEls = [];
  MU.refreshRim = () => {
    rimEls = MU.$$(".glass, .rim");
    floatEls = MU.$$(".chrome .float");
  };
  MU.settings = {
    focus: MU.store.get("focus", true),
    rim: true,
  };

  let pwQueued = false;
  function schedulePointerWork() {
    if (pwQueued) return;
    pwQueued = true;
    requestAnimationFrame(pointerWork);
  }
  function rectDist(r, x, y) {
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    return Math.hypot(dx, dy);
  }
  function pointerWork() {
    pwQueued = false;
    const { x, y, inside } = MU.pointer;
    const touch = MU.pointer.type === "touch";
    for (const el of rimEls) {
      const r = el.getBoundingClientRect();
      if (!r.width || r.bottom < 0 || r.top > innerHeight) continue;
      const d = inside && !touch ? rectDist(r, x, y) : 999;
      const rim = MU.clamp(1 - d / 120, 0, 1);
      if (rim > 0 || el._rim) {
        el.style.setProperty("--mx", (x - r.left).toFixed(1) + "px");
        el.style.setProperty("--my", (y - r.top).toFixed(1) + "px");
        el.style.setProperty("--rim", rim.toFixed(3));
        el._rim = rim > 0;
      }
    }
    const app = MU.app;
    const prox = app && MU.settings.focus && app.dataset.view === "stage" && !touch;
    for (const el of floatEls) {
      if (!prox) {
        el.style.setProperty("--dim-floor", "1");
        continue;
      }
      const r = el.getBoundingClientRect();
      const d = inside ? rectDist(r, x, y) : 9999;
      const hasOpen = MU.openCount > 0 && el.querySelector(".is-open");
      const p = hasOpen ? 1 : MU.clamp(1 - (d - 30) / 340, 0, 1);
      el.style.setProperty("--dim-floor", "0.42");
      el.style.setProperty("--prox", (p * p * (3 - 2 * p)).toFixed(3));
    }
  }
  MU.pointerWork = schedulePointerWork;

  /* ---------- idle: chrome steps back after a pause ---------- */

  MU.openCount = 0;
  let idleTimer = 0;
  MU.wake = () => {
    const app = MU.app;
    if (!app) return;
    app.classList.remove("is-idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      const overChrome = document.querySelector(".chrome .float:hover, .switcher:hover");
      const ae = document.activeElement;
      const focusInChrome =
        ae && ae.closest(".chrome, .switcher") && (ae.matches("input, textarea") || MU.lastInputKeyboard);
      if (
        MU.settings.focus &&
        app.dataset.view === "stage" &&
        MU.openCount === 0 &&
        !overChrome &&
        !focusInChrome &&
        !MU.busy
      ) {
        app.classList.add("is-idle");
      }
    }, 2600);
  };
  ["pointermove", "pointerdown", "keydown", "wheel"].forEach((ev) =>
    window.addEventListener(ev, () => MU.wake(), { passive: true })
  );

  /* ---------- juice: bloom that lives behind the glass ---------- */

  MU.juice = (function () {
    let cur = null; // { layer, b1, b2, b3, local }
    let active = null;
    let running = false;
    let offAt = 0;
    const ax = new Spring(0, { stiffness: 120, damping: 18 });
    const ay = new Spring(0, { stiffness: 120, damping: 18 });
    const burst = new Spring(0, { stiffness: 260, damping: 14 });
    const charge = new Spring(0, { stiffness: 90, damping: 16 });

    // Kit specimens carry their own bloom layer so the glow sits under their parts, not under the page.
    function layerFor(el) {
      const scope = el.closest(".spec-stage.dark");
      let layer;
      if (scope) {
        layer = scope.querySelector(":scope > .juice");
        if (!layer) {
          layer = document.createElement("div");
          layer.className = "juice local";
          layer.setAttribute("aria-hidden", "true");
          layer.innerHTML = '<i class="b2"></i><i class="b3"></i><i class="b1"></i>';
          scope.prepend(layer);
        }
      } else layer = MU.$(".app > .juice");
      if (!layer) return null;
      if (cur && cur.layer === layer) return cur;
      const [b2, b3, b1] = MU.$$("i", layer);
      return { layer, b1, b2, b3, local: !!scope };
    }
    function center(el, L) {
      const r = el.getBoundingClientRect();
      let x = r.left + r.width / 2;
      let y = r.top + r.height / 2;
      if (L.local) {
        const lr = L.layer.getBoundingClientRect();
        x -= lr.left;
        y -= lr.top;
      }
      return [x, y];
    }
    function loop(dt, t) {
      if (!cur) return false;
      ax.step(dt);
      ay.step(dt);
      burst.step(dt);
      charge.step(dt);
      const s = 1 + burst.value * 0.45;
      const c = 0.6 + charge.value * 0.4;
      const m = MU.reduced() ? 0 : 1;
      const x = ax.value;
      const y = ay.value;
      cur.b1.style.transform = `translate3d(${x + Math.sin(t * 0.8) * 16 * m}px, ${y + Math.cos(t * 1.1) * 10 * m}px, 0) scale(${s * c})`;
      cur.b2.style.transform = `translate3d(${x + (120 + Math.sin(t * 0.55) * 46 * m) * c}px, ${y + (-70 + Math.cos(t * 0.7) * 34 * m) * c}px, 0) scale(${(0.8 + burst.value * 0.6) * c})`;
      cur.b3.style.transform = `translate3d(${x + (-110 + Math.cos(t * 0.65) * 40 * m) * c}px, ${y + (40 + Math.sin(t * 0.9) * 26 * m) * c}px, 0) scale(${s * 0.9 * c})`;
      if (!active && performance.now() - offAt > 1200) {
        running = false;
        return false;
      }
    }
    function run() {
      if (running) return;
      running = true;
      MU.tick(loop);
    }
    function on(el) {
      const L = layerFor(el);
      if (!L) return;
      const [x, y] = center(el, L);
      const fresh = !cur || cur.layer !== L.layer || !cur.layer.classList.contains("is-on");
      if (cur && cur.layer !== L.layer) cur.layer.classList.remove("is-on");
      cur = L;
      if (fresh) {
        ax.jump(x);
        ay.jump(y);
        charge.jump(0);
      }
      active = el;
      ax.set(x);
      ay.set(y);
      charge.set(1);
      el.classList.add("is-charged");
      cur.layer.classList.add("is-on");
      run();
    }
    function off(el) {
      el.classList.remove("is-charged");
      if (active === el && cur) {
        active = null;
        offAt = performance.now();
        charge.set(0);
        burst.set(0);
        cur.layer.classList.remove("is-on");
      }
    }
    function shock(el) {
      if (MU.reduced()) return;
      const r = el.getBoundingClientRect();
      const ring = document.createElement("div");
      ring.className = "shock";
      Object.assign(ring.style, {
        left: r.left + "px",
        top: r.top + "px",
        width: r.width + "px",
        height: r.height + "px",
        borderRadius: getComputedStyle(el).borderRadius,
      });
      document.body.appendChild(ring);
      setTimeout(() => ring.remove(), 720);
    }
    function bind(el) {
      if (el._juice) return;
      el._juice = true;
      el.classList.add("juice-btn");
      el.addEventListener("pointerenter", (e) => {
        if (e.pointerType !== "touch") on(el);
      });
      el.addEventListener("pointerleave", () => off(el));
      el.addEventListener("focus", () => el.matches(":focus-visible") && on(el));
      el.addEventListener("blur", () => off(el));
      el.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "touch") on(el);
        burst.set(1);
        run();
      });
      const release = () => {
        burst.set(0);
      };
      el.addEventListener("pointerup", release);
      el.addEventListener("pointercancel", release);
      el.addEventListener("click", () => {
        shock(el);
        burst.velocity += 6;
        burst.set(0);
        run();
        if (MU.pointer.type === "touch") setTimeout(() => off(el), 900);
      });
    }
    return { bind, on, off, shock };
  })();

  /* ---------- tooltips ---------- */

  MU.initTips = function () {
    const tip = document.createElement("div");
    tip.className = "tip";
    tip.setAttribute("role", "tooltip");
    tip.id = "mu-tip";
    document.body.appendChild(tip);
    let showTimer = 0;
    let lastHide = 0;
    let current = null;

    function place(el) {
      const r = el.getBoundingClientRect();
      const tr = tip.getBoundingClientRect();
      const below = r.top < 64;
      let x = r.left + r.width / 2 - tr.width / 2;
      x = MU.clamp(x, 8, innerWidth - tr.width - 8);
      const y = below ? r.bottom + 8 : r.top - tr.height - 8;
      tip.style.setProperty("--tx", x + "px");
      tip.style.setProperty("--ty", y + "px");
      tip.style.setProperty("--tip-dy", below ? "-4px" : "4px");
    }
    function show(el) {
      current = el;
      const kbd = el.dataset.kbd ? `<span class="kbd">${el.dataset.kbd}</span>` : "";
      tip.innerHTML = `<span>${el.dataset.tip}</span>${kbd}`;
      const warm = performance.now() - lastHide < 700;
      tip.classList.toggle("instant", warm);
      tip.classList.remove("is-on");
      place(el);
      requestAnimationFrame(() => {
        if (current !== el) return;
        place(el);
        tip.classList.add("is-on");
      });
      el.setAttribute("aria-describedby", "mu-tip");
    }
    function hide() {
      clearTimeout(showTimer);
      if (current) {
        current.removeAttribute("aria-describedby");
        lastHide = performance.now();
      }
      current = null;
      tip.classList.remove("is-on");
    }
    function schedule(el) {
      clearTimeout(showTimer);
      if (el.getAttribute("aria-expanded") === "true") return;
      const warm = performance.now() - lastHide < 700;
      showTimer = setTimeout(() => show(el), warm ? 0 : 520);
    }
    document.addEventListener("pointerover", (e) => {
      if (e.pointerType === "touch") return;
      const el = e.target.closest("[data-tip]");
      if (el && el !== current) schedule(el);
    });
    document.addEventListener("pointerout", (e) => {
      const el = e.target.closest("[data-tip]");
      if (el && !el.contains(e.relatedTarget)) hide();
    });
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("focusin", (e) => {
      const el = e.target.closest && e.target.closest("[data-tip]");
      if (el && el.matches(":focus-visible")) schedule(el);
    });
    document.addEventListener("focusout", hide);
    window.addEventListener("scroll", hide, true);
    MU.hideTip = hide;
  };

  /* ---------- popovers (menus, panels) ---------- */

  MU.pop = (function () {
    const open = new Map(); // pop element -> { trigger, onClose }
    function highlight(menu) {
      if (menu._hl) return;
      const hl = document.createElement("span");
      hl.className = "menu-hl";
      menu.prepend(hl);
      menu._hl = hl;
      const move = (item) => {
        if (!item) {
          hl.style.opacity = "0";
          return;
        }
        const first = hl.style.opacity !== "1";
        if (first) hl.style.transition = "opacity 160ms";
        hl.style.transform = `translateY(${item.offsetTop}px)`;
        hl.style.height = item.offsetHeight + "px";
        hl.style.opacity = "1";
        if (first) requestAnimationFrame(() => (hl.style.transition = ""));
      };
      menu.addEventListener("pointermove", (e) => {
        const item = e.target.closest(".menu-item");
        if (item && item !== menu._hot) {
          menu._hot = item;
          move(item);
        }
      });
      menu.addEventListener("pointerleave", () => {
        menu._hot = null;
        move(null);
      });
      menu.addEventListener("focusin", (e) => {
        const item = e.target.closest(".menu-item");
        if (item) move(item);
      });
      menu._moveHl = move;
    }
    function items(menu) {
      return MU.$$(".menu-item:not([disabled])", menu);
    }
    function openPop(pop, trigger, opts = {}) {
      if (open.has(pop)) return;
      // close siblings that are not ancestors
      open.forEach((v, p) => {
        if (!p.contains(pop) && !(opts.keep || []).includes(p)) closePop(p);
      });
      if (pop.classList.contains("menu")) highlight(pop);
      pop.classList.add("is-open");
      if (trigger) trigger.setAttribute("aria-expanded", "true");
      open.set(pop, { trigger, onClose: opts.onClose });
      MU.openCount = open.size;
      MU.wake();
      MU.hideTip && MU.hideTip();
      if (opts.focus !== false && pop.classList.contains("menu")) {
        const checked = pop.querySelector('.menu-item[aria-checked="true"]') || items(pop)[0];
        if (checked && MU.lastInputKeyboard) setTimeout(() => checked.focus(), 30);
      }
      setTimeout(() => MU.refreshRim(), 0);
    }
    function closePop(pop, { restore = false } = {}) {
      const st = open.get(pop);
      if (!st) return;
      pop.classList.remove("is-open");
      if (st.trigger) {
        st.trigger.setAttribute("aria-expanded", "false");
        if (restore) st.trigger.focus();
      }
      open.delete(pop);
      MU.openCount = open.size;
      if (pop._moveHl) pop._moveHl(null);
      st.onClose && st.onClose();
      MU.wake();
    }
    function toggle(pop, trigger, opts) {
      open.has(pop) ? closePop(pop) : openPop(pop, trigger, opts);
    }
    document.addEventListener(
      "pointerdown",
      (e) => {
        open.forEach((st, pop) => {
          if (pop.contains(e.target)) return;
          if (st.trigger && st.trigger.contains(e.target)) return;
          if (pop.dataset.sticky !== undefined) return;
          closePop(pop);
        });
      },
      true
    );
    document.addEventListener("keydown", (e) => {
      const pops = Array.from(open.keys());
      const top = pops[pops.length - 1];
      if (!top) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closePop(top, { restore: true });
        return;
      }
      if (!top.classList.contains("menu")) return;
      const list = items(top);
      if (!list.length) return;
      const i = list.indexOf(document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
        list[n].focus();
      }
    });
    return {
      open: openPop,
      close: closePop,
      toggle,
      enhance: highlight,
      isOpen: (p) => open.has(p),
      closeAll: () => open.forEach((v, p) => closePop(p)),
    };
  })();

  MU.lastInputKeyboard = false;
  window.addEventListener("keydown", () => (MU.lastInputKeyboard = true), true);
  window.addEventListener("pointerdown", () => (MU.lastInputKeyboard = false), true);
  window.addEventListener("pointermove", (e) => {
    if (Math.abs(e.movementX) + Math.abs(e.movementY) > 6) MU.lastInputKeyboard = false;
  }, { passive: true });

  /* ---------- toast ---------- */

  MU.toast = (function () {
    let el, timer;
    return function (text, meta = "") {
      if (!el) {
        el = document.createElement("div");
        el.className = "toast glass";
        el.setAttribute("role", "status");
        el.setAttribute("aria-live", "polite");
        document.body.appendChild(el);
      }
      el.innerHTML = `<span class="dot"><svg class="i" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span>${text}</span>${
        meta ? `<span class="meta">${meta}</span>` : ""
      }`;
      el.classList.remove("is-on");
      void el.offsetWidth;
      el.classList.add("is-on");
      clearTimeout(timer);
      timer = setTimeout(() => el.classList.remove("is-on"), 2800);
    };
  })();

  /* ---------- odometer ---------- */

  MU.odo = function (el, value) {
    const str = String(value);
    if (el._odo === str) return;
    const prev = el._odo || "";
    el._odo = str;
    if (el.children.length !== str.length) {
      el.innerHTML = str
        .split("")
        .map(() => `<span class="odo-digit"><span>0<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9</span></span>`)
        .join("");
    }
    MU.$$(".odo-digit > span", el).forEach((col, i) => {
      const d = +str[i];
      col.style.transform = `translateY(${-d * 1.3}em)`;
      if (!prev) {
        col.style.transition = "none";
        requestAnimationFrame(() => (col.style.transition = ""));
      }
    });
  };

  /* ---------- formatting ---------- */

  MU.fmtBytes = (n) => {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(2) + " KB";
    return (n / 1024 / 1024).toFixed(2) + " MB";
  };
})();
