/* Maga UI — components. Each init reads data-* attributes, so markup is the API. */
(function () {
  "use strict";
  const MU = window.MU;
  const { $, $$, clamp, emit } = MU;

  /* ---------- Segmented control ---------- */

  function initSeg(el) {
    if (el._seg) return el._seg;
    const btns = $$(":scope > button", el);
    el.setAttribute("role", "radiogroup");
    const ind = document.createElement("span");
    ind.className = "seg-ind";
    el.prepend(ind);
    let current = btns.find((b) => b.getAttribute("aria-checked") === "true") || btns[0];

    function place(animate = true) {
      if (!current || !current.offsetWidth) return;
      if (!animate) el.classList.add("no-anim");
      ind.style.width = current.offsetWidth + "px";
      ind.style.transform = `translateX(${current.offsetLeft}px)`;
      if (!animate) requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("no-anim")));
    }
    function select(btn, { silent = false, focus = false } = {}) {
      if (!btn) return;
      const changed = btn !== current;
      current = btn;
      btns.forEach((b) => {
        const on = b === btn;
        b.setAttribute("aria-checked", on ? "true" : "false");
        b.tabIndex = on ? 0 : -1;
      });
      place(true);
      if (focus) btn.focus();
      if (changed && !silent) emit(el, "change", { value: btn.dataset.value ?? btn.textContent.trim() });
    }
    btns.forEach((b) => {
      b.setAttribute("role", "radio");
      b.addEventListener("click", () => select(b));
    });
    el.addEventListener("keydown", (e) => {
      const i = btns.indexOf(current);
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        select(btns[(i + 1) % btns.length], { focus: true });
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        select(btns[(i - 1 + btns.length) % btns.length], { focus: true });
      }
    });
    select(current, { silent: true });
    place(false);
    new ResizeObserver(() => place(false)).observe(el);
    const api = {
      set(value, opts) {
        select(btns.find((b) => (b.dataset.value ?? b.textContent.trim()) === String(value)), opts);
      },
      get value() {
        return current.dataset.value ?? current.textContent.trim();
      },
      place,
    };
    el._seg = api;
    return api;
  }

  /* ---------- Underline tabs ---------- */

  function initTabs(el) {
    if (el._tabs) return;
    const btns = $$(":scope > button", el);
    el.setAttribute("role", "tablist");
    const ind = document.createElement("span");
    ind.className = "tabs-ind";
    el.appendChild(ind);
    let current = btns.find((b) => b.getAttribute("aria-selected") === "true") || btns[0];
    function place() {
      if (!current.offsetWidth) return;
      ind.style.width = current.offsetWidth - 16 + "px";
      ind.style.transform = `translateX(${current.offsetLeft + 8}px)`;
    }
    function select(b, focus) {
      current = b;
      btns.forEach((x) => {
        x.setAttribute("aria-selected", x === b ? "true" : "false");
        x.tabIndex = x === b ? 0 : -1;
      });
      place();
      if (focus) b.focus();
      emit(el, "change", { value: b.textContent.trim() });
    }
    btns.forEach((b) => {
      b.setAttribute("role", "tab");
      b.addEventListener("click", () => select(b));
    });
    el.addEventListener("keydown", (e) => {
      const i = btns.indexOf(current);
      if (e.key === "ArrowRight") select(btns[(i + 1) % btns.length], true);
      if (e.key === "ArrowLeft") select(btns[(i - 1 + btns.length) % btns.length], true);
    });
    btns.forEach((x) => {
      x.setAttribute("aria-selected", x === current ? "true" : "false");
      x.tabIndex = x === current ? 0 : -1;
    });
    ind.style.transition = "none";
    place();
    requestAnimationFrame(() => (ind.style.transition = ""));
    new ResizeObserver(place).observe(el);
    el._tabs = true;
  }

  /* ---------- Fill slider ----------
     tap = jump (animated) · drag = relative (no jump) · Shift = fine
     overdrag rubber-bands the whole cell · snaps to default · double-click resets */

  function initFs(el) {
    if (el._fs) return el._fs;
    const d = el.dataset;
    const min = +(d.min ?? 0);
    const max = +(d.max ?? 100);
    const step = +(d.step ?? 1);
    const vertical = el.classList.contains("vertical");
    const fmt = d.format || "int";
    let value = +(d.value ?? min);
    const def = +(d.default ?? value);
    const label = d.label || "";

    el.innerHTML = `<div class="fs-fill"></div><div class="fs-text"><span class="fs-label">${label}</span><span class="fs-value"></span></div>`;
    el.tabIndex = 0;
    el.setAttribute("role", "slider");
    el.setAttribute("aria-label", label || d.aria || "Value");
    el.setAttribute("aria-valuemin", min);
    el.setAttribute("aria-valuemax", max);
    if (vertical) el.setAttribute("aria-orientation", "vertical");
    const valEl = $(".fs-value", el);

    const span = max - min;
    const quant = (v) => clamp(Math.round((v - min) / step) * step + min, min, max);
    const decimals = (String(step).split(".")[1] || "").length;
    function text(v) {
      const n = v.toFixed(decimals);
      if (fmt === "pct") return n + "%";
      if (fmt === "stat") return `${n}<span class="of">/ ${max}</span>`;
      if (fmt === "deg") return n + "°";
      if (fmt === "x") return n + "×";
      return n;
    }
    function render() {
      el.style.setProperty("--v", ((value - min) / span).toFixed(4));
      valEl.innerHTML = text(value);
      el.setAttribute("aria-valuenow", value);
      el.setAttribute("aria-valuetext", valEl.textContent);
    }
    function set(v, { silent = false, final = false } = {}) {
      const q = quant(v);
      const changed = q !== value;
      value = q;
      render();
      if (changed && !silent) emit(el, "input", { value });
      if (final && !silent) emit(el, "change", { value });
    }

    let start = null;
    let lastSnap = false;
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.focus({ preventScroll: true });
      el.setPointerCapture(e.pointerId);
      start = { x: e.clientX, y: e.clientY, v: value, moved: false, rect: el.getBoundingClientRect() };
    });
    el.addEventListener("pointermove", (e) => {
      if (!start) return;
      const delta = vertical ? start.y - e.clientY : e.clientX - start.x;
      if (!start.moved && Math.abs(delta) > 3) {
        start.moved = true;
        el.classList.add("is-dragging");
        MU.busy = true;
      }
      if (!start.moved) return;
      const size = vertical ? start.rect.height : start.rect.width;
      const fine = e.shiftKey ? 0.2 : 1;
      let raw = start.v + (delta / size) * span * fine;
      // rubber band past the ends
      let over = 0;
      if (raw < min) over = ((min - raw) / span) * size;
      if (raw > max) over = ((raw - max) / span) * size;
      const rb = over ? (1 - 1 / (over / 80 + 1)) * 14 : 0; // px, saturating
      el.style.setProperty("--stretch", (1 + rb / size).toFixed(4));
      el.style.setProperty("--squash", (1 - rb / size / 3).toFixed(4));
      if (raw < min) el.style.setProperty("--origin", vertical ? "center top" : "right center");
      if (raw > max) el.style.setProperty("--origin", vertical ? "center bottom" : "left center");
      // magnetic default
      const snapZone = span * 0.025;
      const snap = Math.abs(raw - def) < snapZone && def > min && def < max;
      if (snap) raw = def;
      if (snap && !lastSnap && navigator.vibrate) navigator.vibrate(4);
      lastSnap = snap;
      set(raw);
    });
    const end = (e) => {
      if (!start) return;
      if (!start.moved && e.type === "pointerup") {
        const r = start.rect;
        const t = vertical ? 1 - (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
        set(min + clamp(t, 0, 1) * span, { final: true });
      } else if (start.moved) {
        emit(el, "change", { value });
      }
      el.classList.remove("is-dragging");
      el.style.setProperty("--stretch", "1");
      el.style.setProperty("--squash", "1");
      start = null;
      MU.busy = false;
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("dblclick", () => set(def, { final: true }));
    el.addEventListener("keydown", (e) => {
      const big = e.shiftKey ? 10 : 1;
      const inc = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[e.key];
      if (inc) {
        e.preventDefault();
        set(value + inc * step * big, { final: true });
      } else if (e.key === "Home") {
        e.preventDefault();
        set(min, { final: true });
      } else if (e.key === "End") {
        e.preventDefault();
        set(max, { final: true });
      }
    });
    render();
    const api = {
      set,
      get value() {
        return value;
      },
      reset: () => set(def, { final: true }),
    };
    el._fs = api;
    return api;
  }

  /* ---------- Select (button + menu) ---------- */

  function initSelect(el) {
    if (el._select) return el._select;
    const btn = $(".select-btn", el);
    const menu = $(".menu", el);
    const labelEl = $(".select-value", btn) || btn;
    const items = $$(".menu-item", menu);
    btn.setAttribute("aria-haspopup", "menu");
    btn.setAttribute("aria-expanded", "false");
    menu.setAttribute("role", "menu");
    items.forEach((it) => {
      it.setAttribute("role", "menuitemradio");
      it.tabIndex = -1;
      if (!$(".check", it))
        it.insertAdjacentHTML(
          "beforeend",
          '<svg class="i i-sm check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
        );
      it.addEventListener("click", () => {
        choose(it);
        MU.pop.close(menu, { restore: MU.lastInputKeyboard });
      });
    });
    function choose(it, silent) {
      items.forEach((x) => x.setAttribute("aria-checked", x === it ? "true" : "false"));
      labelEl.textContent = it.dataset.label || it.textContent.trim();
      if (!silent) emit(el, "change", { value: it.dataset.value });
    }
    btn.addEventListener("click", () => MU.pop.toggle(menu, btn));
    btn.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        MU.pop.open(menu, btn);
      }
    });
    const initial = items.find((x) => x.getAttribute("aria-checked") === "true") || items[0];
    choose(initial, true);
    const api = {
      set: (v) => {
        const it = items.find((x) => x.dataset.value === v);
        if (it) choose(it, true);
      },
    };
    el._select = api;
    return api;
  }

  /* ---------- Menu trigger (generic) ---------- */

  function initMenuTrigger(btn) {
    const menu = document.getElementById(btn.dataset.menu);
    if (!menu) return;
    btn.setAttribute("aria-haspopup", "menu");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", menu.id);
    menu.setAttribute("role", "menu");
    $$(".menu-item", menu).forEach((it) => {
      if (!it.getAttribute("role")) it.setAttribute("role", "menuitem");
      it.tabIndex = -1;
    });
    btn.addEventListener("click", () => MU.pop.toggle(menu, btn));
  }

  /* ---------- Switch ---------- */

  function initSwitch(el) {
    if (el._sw) return;
    el._sw = true;
    el.setAttribute("role", "switch");
    if (!el.hasAttribute("aria-checked")) el.setAttribute("aria-checked", "false");
    const host = el.closest(".menu-item") || el;
    host.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        host.click();
      }
    });
    host.addEventListener("click", (e) => {
      if (host !== el && e.target !== host && !host.contains(e.target)) return;
      const on = el.getAttribute("aria-checked") !== "true";
      el.setAttribute("aria-checked", on ? "true" : "false");
      emit(el, "change", { value: on });
    });
  }

  /* ---------- Toggle tags ---------- */

  function initToggle(el) {
    if (el._tg) return;
    el._tg = true;
    if (!el.hasAttribute("aria-pressed")) el.setAttribute("aria-pressed", "false");
    el.addEventListener("click", () => {
      const on = el.getAttribute("aria-pressed") !== "true";
      el.setAttribute("aria-pressed", on ? "true" : "false");
      emit(el, "change", { value: on });
    });
  }

  /* ---------- Media tile (click / drop an image) ---------- */

  function initMedia(el) {
    if (el._media) return;
    el._media = true;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.hidden = true;
    input.id = (el.id || "media") + "-file";
    el.appendChild(input);
    const img = $(".media-img", el);
    const name = $(".name", el);
    const size = $(".size", el);
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", "Replace base image");
    function load(file) {
      if (!file || !file.type.startsWith("image/")) {
        MU.toast("That file is not an image", "PNG, JPG, WEBP, GIF");
        return;
      }
      const url = URL.createObjectURL(file);
      img.onload = () => {
        el.classList.add("has-img");
        emit(el, "change", { url, file, img });
      };
      img.src = url;
      name.textContent = file.name.toUpperCase();
      size.textContent = MU.fmtBytes(file.size);
    }
    el.addEventListener("click", (e) => {
      if (e.target === input) return;
      input.click();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        input.click();
      }
    });
    input.addEventListener("change", () => load(input.files[0]));
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      el.classList.add("is-over");
    });
    el.addEventListener("dragleave", () => el.classList.remove("is-over"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("is-over");
      load(e.dataTransfer.files[0]);
    });
  }

  /* ---------- Pattern pager ---------- */

  const PATTERNS = [
    {
      name: "Cross",
      svg: `<svg width="64" height="64" viewBox="0 0 64 64" fill="currentColor"><circle cx="32" cy="14" r="2.2"/><circle cx="14" cy="32" r="2.2"/><circle cx="50" cy="28" r="2.2"/><circle cx="32" cy="50" r="2.2"/><circle cx="32" cy="32" r="1.4" opacity=".5"/></svg>`,
    },
    {
      name: "Grid",
      svg: `<svg width="64" height="64" viewBox="0 0 64 64" fill="currentColor">${[14, 32, 50]
        .map((y) => [14, 32, 50].map((x) => `<circle cx="${x}" cy="${y}" r="2.2"/>`).join(""))
        .join("")}</svg>`,
    },
    {
      name: "Rain",
      svg: `<svg width="64" height="64" viewBox="0 0 64 64" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">${[
        [12, 10],
        [30, 6],
        [48, 14],
        [20, 30],
        [40, 28],
        [10, 46],
        [30, 48],
        [50, 44],
      ]
        .map(([x, y]) => `<line x1="${x}" y1="${y}" x2="${x - 4}" y2="${y + 8}"/>`)
        .join("")}</svg>`,
    },
  ];

  function initPager(el) {
    if (el._pager) return;
    el._pager = true;
    const stage = $(".pager-stage", el);
    const counter = $(".odo", el);
    const next = $(".pager-next", el);
    let i = 0;
    let busy = false;
    function slide(html, dir) {
      const old = $(".pager-slide:last-child", stage);
      const s = document.createElement("div");
      s.className = "pager-slide " + (dir > 0 ? "from-right" : "from-left");
      s.innerHTML = html;
      stage.appendChild(s);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          s.classList.remove("from-right", "from-left");
          if (old) {
            old.classList.add(dir > 0 ? "from-left" : "from-right");
            setTimeout(() => old.remove(), 520);
          }
        })
      );
    }
    function go(dir) {
      if (busy) return;
      busy = true;
      setTimeout(() => (busy = false), 260);
      i = (i + dir + PATTERNS.length) % PATTERNS.length;
      slide(PATTERNS[i].svg, dir);
      MU.odo(counter.querySelector(".cur"), i + 1);
      stage.setAttribute("aria-label", `Pattern ${PATTERNS[i].name}, ${i + 1} of ${PATTERNS.length}`);
      emit(el, "change", { value: PATTERNS[i].name });
    }
    stage.innerHTML = `<div class="pager-slide">${PATTERNS[0].svg}</div>`;
    stage.setAttribute("role", "img");
    stage.setAttribute("aria-label", `Pattern ${PATTERNS[0].name}, 1 of ${PATTERNS.length}`);
    counter.innerHTML = `<span class="cur"></span><span>/</span><span>${PATTERNS.length}</span>`;
    MU.odo(counter.querySelector(".cur"), 1);
    next.addEventListener("click", () => go(1));
    let sx = null;
    stage.addEventListener("pointerdown", (e) => {
      sx = e.clientX;
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener("pointerup", (e) => {
      if (sx === null) return;
      const dx = e.clientX - sx;
      sx = null;
      if (Math.abs(dx) > 24) go(dx < 0 ? 1 : -1);
      else go(1);
    });
    stage.addEventListener("pointercancel", () => (sx = null));
  }

  /* ---------- Prompt card ---------- */

  function autoGrow(t) {
    const fit = () => {
      t.style.height = "auto";
      t.style.height = Math.min(t.scrollHeight, 140) + "px";
    };
    t.addEventListener("input", fit);
    requestAnimationFrame(fit);
    return fit;
  }

  function initPrompt(el) {
    if (el._prompt) return;
    el._prompt = true;
    const [main, neg] = $$("textarea", el);
    const btn = $(".neg-toggle", el);
    const count = $(".prompt-count", el);
    const fitMain = autoGrow(main);
    const fitNeg = autoGrow(neg);
    const upd = () => count && (count.textContent = `${main.value.length} / 400`);
    main.addEventListener("input", upd);
    upd();
    btn.addEventListener("click", () => {
      const on = !el.classList.contains("has-neg");
      el.classList.toggle("has-neg", on);
      btn.textContent = on ? "Remove Negative Prompt" : "Add Negative Prompt";
      btn.setAttribute("aria-expanded", on ? "true" : "false");
      if (on) setTimeout(() => (neg.focus(), fitNeg()), 80);
      else main.focus();
    });
    btn.setAttribute("aria-expanded", "false");
    window.addEventListener("resize", () => {
      fitMain();
      fitNeg();
    });
  }

  /* ---------- Accordion ---------- */

  function initAcc(el) {
    if (el._acc) return;
    el._acc = true;
    const head = $(".acc-head", el);
    head.setAttribute("aria-expanded", el.classList.contains("is-open") ? "true" : "false");
    head.addEventListener("click", () => {
      const on = !el.classList.contains("is-open");
      el.classList.toggle("is-open", on);
      head.setAttribute("aria-expanded", on ? "true" : "false");
    });
  }

  /* ---------- Sphere highlight follows pointer ---------- */

  function initSphereHover(scope) {
    scope.addEventListener("pointermove", (e) => {
      const sw = e.target.closest(".swatch, .mat-btn, .acc-head");
      if (!sw) return;
      const sp = $(".sphere", sw);
      if (!sp) return;
      const r = sp.getBoundingClientRect();
      const x = clamp(((e.clientX - r.left) / r.width) * 100, 10, 90);
      const y = clamp(((e.clientY - r.top) / r.height) * 100, 10, 90);
      sp.style.setProperty("--hx", (x * 0.6 + 34 * 0.4).toFixed(1) + "%");
      sp.style.setProperty("--hy", (y * 0.6 + 28 * 0.4).toFixed(1) + "%");
    });
    scope.addEventListener("pointerout", (e) => {
      const sw = e.target.closest(".swatch, .mat-btn, .acc-head");
      if (!sw || sw.contains(e.relatedTarget)) return;
      const sp = $(".sphere", sw);
      if (sp) {
        sp.style.removeProperty("--hx");
        sp.style.removeProperty("--hy");
      }
    });
  }

  /* ---------- Init all within a scope ---------- */

  MU.initComponents = function (scope = document) {
    $$(".seg", scope).forEach(initSeg);
    $$(".tabs", scope).forEach(initTabs);
    $$(".fs", scope).forEach(initFs);
    $$(".select", scope).forEach(initSelect);
    $$("[data-menu]", scope).forEach(initMenuTrigger);
    $$(".switch", scope).forEach(initSwitch);
    $$(".tag[data-toggle]", scope).forEach(initToggle);
    $$(".media", scope).forEach(initMedia);
    $$(".pager", scope).forEach(initPager);
    $$(".prompt", scope).forEach(initPrompt);
    $$(".acc", scope).forEach(initAcc);
    $$("[data-juice]", scope).forEach((el) => MU.juice.bind(el));
    initSphereHover(scope);
  };

  MU.PATTERNS = PATTERNS;
})();
