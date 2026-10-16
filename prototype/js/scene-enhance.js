/* Maga UI — Enhance scene: procedural landscape, pixelated "before", sharp "after", compare modes. */
(function () {
  "use strict";
  const MU = window.MU;
  const { $, clamp } = MU;

  const PALETTES = [
    {
      id: "dusk",
      name: "Dusk ridge",
      prompt: "Layered ridgelines at dusk, violet haze pooling in the valleys, low warm sun, 35mm film grain",
      sky: ["#141a36", "#4d3f72", "#e49c88"],
      sun: "255, 214, 176",
      far: [133, 116, 160],
      near: [16, 15, 30],
      fog: "214, 160, 182",
      stars: true,
      seed: 7,
    },
    {
      id: "glacier",
      name: "Glacier",
      prompt: "Glacial valley at first light, cold mist between pine ridges, pale blue sky, medium format",
      sky: ["#0c2a40", "#3d7894", "#d3eaec"],
      sun: "244, 251, 255",
      far: [128, 168, 184],
      near: [10, 28, 40],
      fog: "214, 236, 242",
      stars: false,
      seed: 21,
    },
    {
      id: "ember",
      name: "Ember",
      prompt: "Volcanic ridges at sunset, ember-red haze, long shadows across the slopes, cinematic",
      sky: ["#250c10", "#87302a", "#ffb36b"],
      sun: "255, 236, 190",
      far: [170, 86, 64],
      near: [26, 10, 10],
      fog: "255, 150, 105",
      stars: false,
      seed: 43,
    },
  ];

  const BLOCK = { 2: 5, 4: 9, 8: 15, 16: 24 }; // css px per "source" pixel
  const BASE = [960, 540];

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = (c, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

  function drawLandscape(ctx, W, H, p) {
    const r = rng(p.seed);
    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.7);
    sky.addColorStop(0, p.sky[0]);
    sky.addColorStop(0.55, p.sky[1]);
    sky.addColorStop(1, p.sky[2]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    // stars
    if (p.stars) {
      for (let i = 0; i < 220; i++) {
        const x = r() * W;
        const y = r() * H * 0.42;
        const s = r() * 1.3 + 0.3;
        ctx.fillStyle = `rgba(255,255,255,${(r() * 0.7 * (1 - y / (H * 0.45))).toFixed(3)})`;
        ctx.fillRect(x, y, s * (W / 1600), s * (W / 1600));
      }
    }
    // sun
    const sx = W * 0.66;
    const sy = H * 0.5;
    const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, H * 0.5);
    sun.addColorStop(0, `rgba(${p.sun}, 0.95)`);
    sun.addColorStop(0.06, `rgba(${p.sun}, 0.85)`);
    sun.addColorStop(0.07, `rgba(${p.sun}, 0.35)`);
    sun.addColorStop(0.4, `rgba(${p.sun}, 0.08)`);
    sun.addColorStop(1, `rgba(${p.sun}, 0)`);
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, W, H);

    // ridges, far to near
    const L = 7;
    for (let k = 0; k < L; k++) {
      const t = k / (L - 1);
      const y0 = H * (0.5 + t * 0.4);
      const amp = H * (0.05 + t * 0.07);
      const f = [r() * 2 + 1.5, r() * 5 + 4, r() * 13 + 11, r() * 40 + 30];
      const ph = [r() * 6.28, r() * 6.28, r() * 6.28, r() * 6.28];
      const ridge = (x) => {
        const u = x / W;
        return (
          y0 -
          amp *
            (0.55 * Math.sin(u * f[0] + ph[0]) +
              0.28 * Math.sin(u * f[1] + ph[1]) +
              0.12 * Math.abs(Math.sin(u * f[2] + ph[2])) +
              0.05 * Math.sin(u * f[3] + ph[3]))
        );
      };
      const col = mix(p.far, p.near, Math.pow(t, 0.8));
      ctx.beginPath();
      ctx.moveTo(0, H);
      const stepX = Math.max(2, W / 600);
      for (let x = 0; x <= W + stepX; x += stepX) ctx.lineTo(x, ridge(x));
      ctx.lineTo(W, H);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, y0 - amp, 0, y0 + amp * 2);
      g.addColorStop(0, rgb(mix(col, [255, 255, 255], 0.08 * (1 - t))));
      g.addColorStop(1, rgb(mix(col, p.near, 0.4)));
      ctx.fillStyle = g;
      ctx.fill();

      // pines on the nearer ridges: the fine detail that pixelation destroys
      if (k >= 3) {
        const n = Math.round((W / 9) * (0.4 + t));
        ctx.fillStyle = rgb(mix(col, p.near, 0.6));
        for (let i = 0; i < n; i++) {
          const x = r() * W;
          const base = ridge(x) + r() * amp * 0.5;
          const h = (H / 140) * (1 + t * 2.4) * (0.5 + r());
          const w = h * 0.34;
          ctx.beginPath();
          ctx.moveTo(x, base - h);
          ctx.lineTo(x + w, base);
          ctx.lineTo(x - w, base);
          ctx.closePath();
          ctx.fill();
        }
      }
      // haze between layers
      const fog = ctx.createLinearGradient(0, y0 - amp * 0.2, 0, y0 + amp * 1.4);
      fog.addColorStop(0, `rgba(${p.fog}, 0)`);
      fog.addColorStop(1, `rgba(${p.fog}, ${(0.28 * (1 - t)).toFixed(3)})`);
      ctx.fillStyle = fog;
      ctx.fillRect(0, y0 - amp * 0.2, W, amp * 1.6);
    }
    // vignette
    const v = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.3, W / 2, H * 0.5, H * 1.1);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  function addGrain(ctx, W, H, amount) {
    try {
      const img = ctx.getImageData(0, 0, W, H);
      const d = img.data;
      const r = rng(99);
      for (let i = 0; i < d.length; i += 4) {
        const n = (r() - 0.5) * amount;
        d[i] += n;
        d[i + 1] += n;
        d[i + 2] += n;
      }
      ctx.putImageData(img, 0, 0);
    } catch (e) {
      /* tainted canvas — skip grain */
    }
  }

  function drawCover(ctx, img, W, H) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const s = Math.max(W / iw, H / ih);
    const w = iw * s;
    const h = ih * s;
    ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  }

  function EnhanceScene(root) {
    const cmp = $(".cmp", root);
    const beforeC = $(".cmp-pane.before canvas", cmp);
    const afterC = $(".cmp-pane.after canvas", cmp);
    const divider = $(".cmp-divider", cmp);
    const tagBefore = $(".cmp-pane.before .cmp-tag", cmp);
    const tagAfter = $(".cmp-pane.after .cmp-tag", cmp);

    const state = { palette: 0, scale: 2, strength: 50, mode: "slider", split: 50, custom: null };
    const splitS = new MU.Spring(50, { stiffness: 140, damping: 15 });
    let source = document.createElement("canvas");

    function size() {
      const r = cmp.getBoundingClientRect();
      return [Math.max(320, r.width || innerWidth), Math.max(240, r.height || innerHeight)];
    }

    function renderSource() {
      const [w, h] = size();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.round(Math.min(w * dpr, 2600));
      const H = Math.round((W * h) / w);
      source.width = W;
      source.height = H;
      const ctx = source.getContext("2d");
      if (state.custom) drawCover(ctx, state.custom, W, H);
      else {
        drawLandscape(ctx, W, H, PALETTES[state.palette]);
        addGrain(ctx, W, H, 14);
      }
      afterC.width = W;
      afterC.height = H;
      afterC.getContext("2d").drawImage(source, 0, 0);
      renderBefore();
    }

    function renderBefore() {
      const [w, h] = size();
      const b = BLOCK[state.scale] || 9;
      const bw = Math.max(8, Math.round(w / b));
      const bh = Math.max(6, Math.round(h / b));
      beforeC.width = bw;
      beforeC.height = bh;
      const ctx = beforeC.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(source, 0, 0, bw, bh);
      const after = BASE.map((v) => v * state.scale);
      tagBefore.textContent = `Before · ${BASE[0]} × ${BASE[1]}`;
      tagAfter.textContent = `After · ${state.scale}× · ${after[0]} × ${after[1]}`;
    }

    function applyStrength() {
      const s = state.strength / 100;
      afterC.style.filter = `contrast(${(0.92 + s * 0.22).toFixed(3)}) saturate(${(0.85 + s * 0.45).toFixed(3)}) brightness(${(1 + s * 0.04).toFixed(3)})`;
    }

    /* split control */
    function setSplit(v, animate = false) {
      v = clamp(v, 0, 100);
      state.split = v;
      if (animate) {
        splitS.set(v);
        runSplit();
      } else {
        splitS.jump(v);
        paintSplit(v);
      }
      divider.setAttribute("aria-valuenow", Math.round(v));
    }
    function paintSplit(v) {
      cmp.style.setProperty("--split", v.toFixed(3) + "%");
      tagBefore.style.opacity = v < 18 ? 0 : 1;
      tagAfter.style.opacity = v > 82 ? 0 : 1;
    }
    let splitRunning = false;
    function runSplit() {
      if (splitRunning) return;
      splitRunning = true;
      MU.tick((dt) => {
        splitS.step(dt);
        paintSplit(splitS.value);
        if (splitS.done) {
          splitRunning = false;
          return false;
        }
      });
    }

    let dragging = false;
    cmp.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || scanning) return;
      if (state.mode === "single") {
        cmp.classList.add("is-peek");
        cmp.setPointerCapture(e.pointerId);
        return;
      }
      if (state.mode !== "slider") return;
      dragging = true;
      cmp.setPointerCapture(e.pointerId);
      cmp.classList.add("is-dragging");
      MU.busy = true;
      const r = cmp.getBoundingClientRect();
      setSplit(((e.clientX - r.left) / r.width) * 100, true);
    });
    cmp.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const r = cmp.getBoundingClientRect();
      splitS.stiffness = 600;
      splitS.damping = 40;
      setSplit(((e.clientX - r.left) / r.width) * 100, true);
    });
    const up = () => {
      cmp.classList.remove("is-peek");
      if (!dragging) return;
      dragging = false;
      MU.busy = false;
      splitS.stiffness = 140;
      splitS.damping = 15;
      cmp.classList.remove("is-dragging");
    };
    cmp.addEventListener("pointerup", up);
    cmp.addEventListener("pointercancel", up);
    divider.addEventListener("keydown", (e) => {
      const d = { ArrowLeft: -2, ArrowRight: 2 }[e.key];
      if (d) {
        e.preventDefault();
        setSplit(state.split + d * (e.shiftKey ? 5 : 1), true);
      }
      if (e.key === "Home") setSplit(0, true);
      if (e.key === "End") setSplit(100, true);
    });

    /* enhance run: scan reveals the sharp result, then the divider springs back to center */
    let scanning = false;
    function enhance(onProgress) {
      return new Promise((resolve) => {
        if (scanning) return resolve();
        scanning = true;
        MU.busy = true;
        const prevMode = state.mode;
        if (prevMode !== "slider") api.setMode("slider");
        setSplit(100);
        cmp.classList.add("is-scanning");
        const dur = MU.reduced() ? 300 : 2100;
        const t0 = performance.now();
        MU.tick(() => {
          const k = clamp((performance.now() - t0) / dur, 0, 1);
          const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
          const v = 100 - e * 100;
          state.split = v;
          splitS.jump(v);
          paintSplit(v);
          onProgress && onProgress(k);
          if (k >= 1) {
            cmp.classList.remove("is-scanning");
            scanning = false;
            MU.busy = false;
            splitS.velocity = -220;
            setSplit(50, true);
            if (prevMode !== "slider") setTimeout(() => api.setMode(prevMode), 700);
            resolve();
            return false;
          }
        });
      });
    }

    let rs;
    window.addEventListener("resize", () => {
      clearTimeout(rs);
      rs = setTimeout(renderSource, 200);
    });

    const api = {
      PALETTES,
      state,
      setPalette(i) {
        state.palette = i;
        state.custom = null;
        renderSource();
      },
      setImage(img) {
        state.custom = img;
        renderSource();
      },
      setScale(s) {
        state.scale = +s;
        renderBefore();
      },
      setStrength(v) {
        state.strength = v;
        applyStrength();
      },
      setMode(m) {
        state.mode = m;
        cmp.classList.add("is-morph");
        clearTimeout(api._mt);
        api._mt = setTimeout(() => cmp.classList.remove("is-morph"), 700);
        cmp.dataset.mode = m;
        divider.tabIndex = m === "slider" ? 0 : -1;
        if (m === "slider") setSplit(state.split || 50);
      },
      enhance,
      thumb(i, canvas) {
        const W = (canvas.width = 104);
        const H = (canvas.height = 104);
        drawLandscape(canvas.getContext("2d"), W * 1.8, H, PALETTES[i]);
      },
      init() {
        renderSource();
        applyStrength();
        setSplit(50);
      },
    };
    divider.setAttribute("role", "slider");
    divider.setAttribute("aria-label", "Compare position");
    divider.setAttribute("aria-valuemin", "0");
    divider.setAttribute("aria-valuemax", "100");
    divider.tabIndex = 0;
    return api;
  }

  MU.EnhanceScene = EnhanceScene;
})();
