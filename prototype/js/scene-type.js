/* Maga UI — Type scene: layered CSS 3D text. Rotation is composite-only, so it stays smooth. */
(function () {
  "use strict";
  const MU = window.MU;
  const { $, clamp } = MU;

  /* stops are angle-free so Direction can rotate them */
  const MATERIALS = [
    // Basic
    { id: "chalk", name: "Chalk", group: "basic", angle: 170, stops: "#ffffff, #e2e0db 55%, #b7b3ac", swatch: "radial-gradient(circle at 40% 35%, #ffffff, #d6d4cf 60%, #a9a6a0)", glow: "rgba(255,255,255,.28)", metal: 10, rough: 70 },
    { id: "lagoon", name: "Lagoon", group: "basic", angle: 150, stops: "#5a95ff, #2f62e3 45%, #1d3da6 75%, #6ad36a", swatch: "radial-gradient(circle at 30% 30%, #9be15d 0 7%, transparent 8%) 0 0 / 26% 26%, radial-gradient(circle at 70% 60%, #b7f07a 0 5%, transparent 6%) 0 0 / 21% 21%, radial-gradient(circle at 40% 35%, #4f8bff, #1f49c4 70%)", glow: "rgba(80,140,255,.4)", metal: 20, rough: 55 },
    { id: "graphite", name: "Graphite", group: "basic", angle: 165, stops: "#5a5a62, #2a2a30 55%, #121215", swatch: "repeating-radial-gradient(circle at 30% 30%, rgba(255,255,255,.06) 0 1px, transparent 1px 3px), radial-gradient(circle at 40% 35%, #4a4a52, #16161a 70%)", glow: "rgba(150,150,170,.22)", metal: 45, rough: 60 },
    { id: "lime", name: "Lime Gloss", group: "basic", angle: 160, stops: "#c8ff7a, #6fd23f 45%, #2a8a1f", swatch: "radial-gradient(circle at 40% 35%, #b6f36a, #3aa52a 65%, #1d5c14)", glow: "rgba(120,230,90,.4)", metal: 70, rough: 20 },
    { id: "cobalt", name: "Cobalt", group: "basic", angle: 160, stops: "#6f94ff, #2f57e8 50%, #1a33b0", swatch: "radial-gradient(circle at 40% 35%, #5a83ff, #1d3dc4 65%, #0f2378)", glow: "rgba(70,110,255,.45)", metal: 30, rough: 35 },
    { id: "toxic", name: "Toxic Marble", group: "basic", angle: 125, stops: "#6c7466, #a7f07a 22%, #3d4439 42%, #9be15d 64%, #4a5245 82%, #c3f59a", swatch: "radial-gradient(ellipse at 60% 40%, #a7f07a 0 10%, transparent 22%), radial-gradient(ellipse at 30% 70%, #8fd85a 0 8%, transparent 18%), radial-gradient(circle at 40% 35%, #7b8476, #2f352c 70%)", glow: "rgba(160,240,110,.32)", metal: 25, rough: 45 },
    { id: "mosaic", name: "Mosaic", group: "basic", angle: 140, stops: "#8be9ec, #12302f 30%, #66d0d3 58%, #0b1d1f 80%, #a6f2f4", swatch: "radial-gradient(circle at 50% 50%, #7fe3e6 0 30%, transparent 32%) 0 0 / 30% 30%, radial-gradient(circle at 40% 35%, #1b3c3e, #050c0d 70%)", glow: "rgba(100,220,225,.35)", metal: 40, rough: 30 },
    { id: "bone", name: "Bone", group: "basic", angle: 170, stops: "#fbf3e6, #e5d7bf 50%, #bfae90", swatch: "repeating-linear-gradient(35deg, transparent 0 9px, rgba(120,100,70,.35) 9px 10px), repeating-linear-gradient(-55deg, transparent 0 13px, rgba(120,100,70,.25) 13px 14px), radial-gradient(circle at 40% 35%, #fbf3e6, #cdbfa7 70%)", glow: "rgba(255,235,200,.3)", metal: 5, rough: 80 },
    { id: "grape", name: "Grape", group: "basic", angle: 160, stops: "#c38bff, #8a3dff 45%, #4c12a8", swatch: "radial-gradient(circle at 50% 50%, rgba(255,255,255,.12) 0 20%, transparent 22%) 0 0 / 34% 34%, radial-gradient(circle at 40% 35%, #a35cff, #5a17b8 65%, #2f0a66)", glow: "rgba(150,80,255,.45)", metal: 35, rough: 40 },
    { id: "terracotta", name: "Terracotta", group: "basic", angle: 165, stops: "#f0bb98, #c98b66 50%, #8d5233", swatch: "repeating-radial-gradient(circle at 60% 40%, rgba(80,40,20,.12) 0 2px, transparent 2px 5px), radial-gradient(circle at 40% 35%, #e1a985, #9c5f3e 70%)", glow: "rgba(230,150,110,.3)", metal: 5, rough: 85 },
    { id: "butter", name: "Butter", group: "basic", angle: 165, stops: "#fff1a8, #f5d65a 50%, #c99a16", swatch: "radial-gradient(circle at 40% 35%, #fff09a, #e2b52b 65%, #9c7408)", glow: "rgba(255,220,90,.35)", metal: 15, rough: 50 },
    { id: "bubblegum", name: "Bubblegum", group: "basic", angle: 165, stops: "#ffc3e3, #ff7fbf 50%, #e0418f", swatch: "radial-gradient(circle at 40% 35%, #ffb3da, #ff5aa8 65%, #b8236d)", glow: "rgba(255,110,190,.42)", metal: 40, rough: 25 },
    // Iridescent
    { id: "sorbet", name: "Sorbet", group: "iridescent", angle: 115, stops: "#ff7ad9 0%, #8f9bff 17%, #ffb07a 34%, #ff6fc8 51%, #7f8cff 68%, #ffc59a 85%, #ff7ad9 100%", swatch: "conic-gradient(from 210deg at 45% 55%, #ff7ad9, #8f9bff, #ffb07a, #ff6fc8, #7f8cff, #ff7ad9)", glow: "rgba(255,120,210,.45)", metal: 30, rough: 45 },
    { id: "opal", name: "Opal", group: "iridescent", angle: 115, stops: "#eaf6ff, #ffd6f3 20%, #d2ffe7 40%, #fff0c4 60%, #d6dfff 80%, #eaf6ff", swatch: "conic-gradient(from 90deg at 50% 50%, #eaf6ff, #ffd6f3, #d2ffe7, #fff0c4, #d6dfff, #eaf6ff)", glow: "rgba(220,230,255,.35)", metal: 55, rough: 30 },
    { id: "oil", name: "Oil Slick", group: "iridescent", angle: 120, stops: "#1b1530, #5b2dff 20%, #00c2a8 40%, #ffb000 55%, #ff2e88 70%, #1b1530 90%", swatch: "conic-gradient(from 30deg at 50% 50%, #1b1530, #5b2dff, #00c2a8, #ffb000, #ff2e88, #1b1530)", glow: "rgba(120,80,255,.45)", metal: 75, rough: 15 },
    { id: "aurora", name: "Aurora", group: "iridescent", angle: 120, stops: "#0b3d2e, #2ef2a0 25%, #7a5cff 50%, #ff7ad9 75%, #0b3d2e", swatch: "conic-gradient(from 160deg at 50% 50%, #0b3d2e, #2ef2a0, #7a5cff, #ff7ad9, #0b3d2e)", glow: "rgba(60,240,170,.4)", metal: 35, rough: 35 },
    { id: "ember", name: "Ember", group: "iridescent", angle: 120, stops: "#ff4f2e, #ffb347 30%, #ff2e63 60%, #ffe08a 90%", swatch: "conic-gradient(from 0deg at 50% 50%, #ff4f2e, #ffb347, #ff2e63, #ffe08a, #ff4f2e)", glow: "rgba(255,110,60,.45)", metal: 30, rough: 40 },
    { id: "holo", name: "Holo Foil", group: "iridescent", angle: 115, stops: "#c6c6d0, #9ad8ff 20%, #ffb3f0 40%, #fff3a8 60%, #a8ffd8 80%, #c6c6d0", swatch: "conic-gradient(from 45deg at 50% 50%, #c6c6d0, #9ad8ff, #ffb3f0, #fff3a8, #a8ffd8, #c6c6d0)", glow: "rgba(170,220,255,.4)", metal: 85, rough: 10 },
  ];

  const FONTS = [
    { family: "Bagel Fat One", name: "Bagel" },
    { family: "Titan One", name: "Titan" },
    { family: "Rubik Mono One", name: "Rubik Mono" },
    { family: "Bungee", name: "Bungee" },
    { family: "Shrikhand", name: "Shrikhand" },
    { family: "Anton", name: "Anton" },
    { family: "Dela Gothic One", name: "Dela Gothic" },
    { family: "Chango", name: "Chango" },
    { family: "Unbounded", name: "Unbounded" },
  ];

  function TypeScene(root) {
    const rig = $(".t-rig", root);
    const squash = $(".t-squash", root);
    const bloom = $(".t-bloom", root);
    const floor = $(".t-floor", root);

    const state = {
      text: "Peace",
      font: FONTS[0].family,
      previewFont: null,
      depth: 40,
      spacing: 30,
      zoom: 100,
      mat: MATERIALS.find((m) => m.id === "sorbet"),
      tile: 30,
      color: 0,
      direction: 50,
      metal: 30,
      rough: 45,
      power: 60,
      orbit: false,
      fit: 1,
    };

    const rx = new MU.Spring(-8, { stiffness: 55, damping: 11 });
    const ry = new MU.Spring(-16, { stiffness: 55, damping: 11 });
    const sx = new MU.Spring(1, { stiffness: 420, damping: 13 });
    const sy = new MU.Spring(1, { stiffness: 420, damping: 13 });
    const zoomS = new MU.Spring(1, { stiffness: 200, damping: 22 });

    /* ---------- layers ---------- */

    let layers = [];
    function build() {
      const D = 4 + state.depth * 0.9;
      const maxN = innerWidth < 700 ? 14 : 26;
      const n = clamp(Math.round(D / 3), 2, maxN);
      const step = D / n;
      squash.innerHTML = "";
      layers = [];
      const empty = !state.text.trim();
      const txt = empty ? "Type" : state.text;
      for (let i = n; i >= 0; i--) {
        const el = document.createElement("div");
        el.className = "t-layer" + (i === 0 ? " front" : "") + (empty ? " ghost" : "");
        el.textContent = txt;
        el.style.setProperty("--z", (-i * step).toFixed(2) + "px");
        el.style.setProperty("--shade", i === 0 ? "0" : (0.16 + 0.6 * (i / n)).toFixed(3));
        el.setAttribute("aria-hidden", "true");
        squash.appendChild(el);
        layers.push(el);
      }
      const sheen = document.createElement("div");
      sheen.className = "t-layer sheen";
      sheen.textContent = txt;
      sheen.setAttribute("aria-hidden", "true");
      squash.appendChild(sheen);
      root.setAttribute("aria-label", `3D text: ${txt}`);
      requestAnimationFrame(fit);
    }

    function fit() {
      const front = $(".t-layer.front", squash);
      if (!front) return;
      const w = front.offsetWidth;
      const avail = innerWidth * (innerWidth < 720 ? 0.92 : 0.8);
      state.fit = w > avail ? avail / w : 1;
      zoomS.set((state.zoom / 100) * state.fit);
      wake();
    }

    function applyMaterial() {
      const m = state.mat;
      const angle = m.angle + (state.direction - 50) * 3.6;
      rig.style.setProperty("--face", `linear-gradient(${angle.toFixed(1)}deg, ${m.stops})`);
      rig.style.setProperty("--tile", 100 + state.tile * 3 + "%");
      rig.style.setProperty("--hue", (state.color * 3.6).toFixed(1) + "deg");
      rig.style.setProperty("--metal", (0.08 + (state.metal / 100) * 0.8).toFixed(3));
      rig.style.setProperty("--sheen-w", (5 + (state.rough / 100) * 26).toFixed(1) + "%");
      rig.style.setProperty("--rough-blur", ((state.rough / 100) * 5).toFixed(2) + "px");
      bloom.style.setProperty("--power", (state.power / 100).toFixed(3));
      bloom.style.setProperty(
        "--bloom",
        `radial-gradient(closest-side, ${m.glow}, ${m.glow.replace(/[\d.]+\)$/, "0.12)")} 60%, transparent)`
      );
      bloom.style.filter = `blur(60px) hue-rotate(${(state.color * 3.6).toFixed(1)}deg)`;
    }

    function applyType() {
      rig.style.setProperty("--t-font", `"${state.previewFont || state.font}"`);
      rig.style.setProperty("--t-spacing", ((state.spacing - 30) / 100) * 0.4 + "em");
      requestAnimationFrame(fit);
      if (document.fonts && document.fonts.load) {
        document.fonts.load(`60px "${state.previewFont || state.font}"`).then(() => requestAnimationFrame(fit));
      }
    }

    /* ---------- motion ---------- */

    let running = false;
    let active = true;
    let lastMove = 0;
    let drag = null;
    let follow = { x: 0.5, y: 0.5 };

    function loop(dt, t) {
      if (!active) {
        running = false;
        return false;
      }
      const reduce = MU.reduced();
      const idle = performance.now() - lastMove > 2500 || MU.pointer.type === "touch";
      if (!drag) {
        if (state.orbit && !reduce) {
          ry.set(Math.sin(t * 0.45) * 42);
          rx.set(-6 + Math.sin(t * 0.32) * 10);
        } else if (idle && !reduce) {
          ry.set(-14 + Math.sin(t * 0.38) * 12);
          rx.set(-7 + Math.cos(t * 0.29) * 5);
        } else if (!reduce) {
          ry.set((follow.x - 0.5) * 38);
          rx.set(-(follow.y - 0.5) * 22);
        }
      }
      rx.step(dt);
      ry.step(dt);
      sx.step(dt);
      sy.step(dt);
      zoomS.step(dt);
      rig.style.setProperty("--rx", rx.value.toFixed(3) + "deg");
      rig.style.setProperty("--ry", ry.value.toFixed(3) + "deg");
      rig.style.setProperty("--zoom", zoomS.value.toFixed(4));
      floor.style.setProperty("--zoom", zoomS.value.toFixed(4));
      squash.style.setProperty("--sq-x", sx.value.toFixed(4));
      squash.style.setProperty("--sq-y", sy.value.toFixed(4));
      // light follows the turn
      rig.style.setProperty("--sheen-pos", (46 + ry.value * 1.1 - rx.value * 0.6).toFixed(2) + "%");
      floor.style.setProperty("--floor-x", (-ry.value * 2.2).toFixed(1) + "px");
      floor.style.setProperty("--floor-s", (1 - Math.abs(ry.value) / 160).toFixed(3));
      if (reduce && rx.done && ry.done && sx.done && sy.done && zoomS.done && !drag) {
        running = false;
        return false;
      }
    }
    function wake() {
      if (running || !active) return;
      running = true;
      MU.tick(loop);
    }

    /* pointer follow (whole window, so the object reacts while you work the chrome) */
    window.addEventListener(
      "pointermove",
      (e) => {
        if (e.pointerType === "touch") return;
        follow = { x: e.clientX / innerWidth, y: e.clientY / innerHeight };
        lastMove = performance.now();
        wake();
      },
      { passive: true }
    );

    /* grab to rotate, release springs back with momentum */
    root.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      root.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, rx: rx.value, ry: ry.value, t: performance.now(), lx: e.clientX, ly: e.clientY, vx: 0, vy: 0, moved: false };
      root.classList.add("is-grabbing");
      wake();
    });
    root.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      const now = performance.now();
      const dtm = Math.max(1, now - drag.t);
      drag.vx = ((e.clientX - drag.lx) / dtm) * 1000;
      drag.vy = ((e.clientY - drag.ly) / dtm) * 1000;
      drag.lx = e.clientX;
      drag.ly = e.clientY;
      drag.t = now;
      ry.set(clamp(drag.ry + dx * 0.4, -75, 75));
      rx.set(clamp(drag.rx - dy * 0.3, -50, 50));
      // stiffer while held so it tracks the hand
      ry.stiffness = rx.stiffness = 260;
      ry.damping = rx.damping = 26;
    });
    const release = (e) => {
      if (!drag) return;
      if (!drag.moved) {
        // tap = jelly
        sx.velocity -= 2.4;
        sy.velocity += 2.8;
      } else {
        ry.velocity += drag.vx * 0.12;
        rx.velocity -= drag.vy * 0.09;
      }
      ry.stiffness = rx.stiffness = 55;
      ry.damping = rx.damping = 9;
      setTimeout(() => {
        ry.damping = rx.damping = 11;
      }, 900);
      drag = null;
      root.classList.remove("is-grabbing");
      wake();
    };
    root.addEventListener("pointerup", release);
    root.addEventListener("pointercancel", release);

    /* pinch / ctrl+wheel zoom */
    root.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        api.onZoomWheel && api.onZoomWheel(-e.deltaY * 0.4);
      },
      { passive: false }
    );

    window.addEventListener("resize", () => {
      clearTimeout(api._rs);
      api._rs = setTimeout(() => {
        build();
        applyType();
      }, 150);
    });

    const api = {
      state,
      setText(v) {
        state.text = v.slice(0, 14);
        build();
        sx.velocity += 1.2;
        sy.velocity -= 1.2;
        wake();
      },
      setFont(f, preview = false) {
        if (preview) state.previewFont = f;
        else {
          state.font = f;
          state.previewFont = null;
          sy.velocity -= 2;
          sx.velocity += 1.4;
        }
        applyType();
        wake();
      },
      clearPreview() {
        state.previewFont = null;
        applyType();
      },
      setDepth(v) {
        state.depth = v;
        build();
      },
      setSpacing(v) {
        state.spacing = v;
        applyType();
      },
      setZoom(v) {
        state.zoom = v;
        zoomS.set((v / 100) * state.fit);
        wake();
      },
      setMaterial(id) {
        const m = MATERIALS.find((x) => x.id === id);
        if (!m) return;
        state.mat = m;
        applyMaterial();
        sx.velocity += 1.6;
        sy.velocity -= 1.6;
        wake();
        return m;
      },
      setProp(k, v) {
        state[k] = v;
        applyMaterial();
      },
      setOrbit(on) {
        state.orbit = on;
        wake();
      },
      setActive(on) {
        active = on;
        if (on) wake();
      },
      nudge() {
        sx.velocity += 2;
        sy.velocity -= 2.4;
        wake();
      },
      onZoomWheel: null,
    };

    rig.style.setProperty("--zoom", "1");
    build();
    applyType();
    applyMaterial();
    wake();
    return api;
  }

  MU.MATERIALS = MATERIALS;
  MU.FONTS = FONTS;
  MU.TypeScene = TypeScene;
})();
