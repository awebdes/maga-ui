/* Maga UI — app wiring: views, scenes, panels, tour, shortcuts */
(function () {
  "use strict";
  const MU = window.MU;
  const { $, $$, clamp } = MU;

  const app = $("#app");
  MU.app = app;

  MU.initComponents(document);
  MU.initTips();

  /* ---------- grain overlay ---------- */
  (function grain() {
    const c = $("#grain");
    const s = 160;
    c.width = c.height = s;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    c.style.width = "100%";
    c.style.height = "100%";
    c.style.imageRendering = "pixelated";
    c.style.objectFit = "cover";
  })();

  /* ---------- scenes ---------- */

  const type = MU.TypeScene($("#scene-type"));
  const enh = MU.EnhanceScene($("#scene-enhance"));
  let enhReady = false;

  function setScene(id, { quiet = false } = {}) {
    if (app.dataset.scene === id && !quiet) return;
    app.dataset.scene = id;
    $$(".scene").forEach((s) => s.classList.toggle("is-on", s.id === "scene-" + id));
    $("#scene-name").textContent = id === "type" ? "Type" : "Enhance";
    $$("#scene-menu [data-scene]").forEach((b) => b.setAttribute("aria-checked", b.dataset.scene === id ? "true" : "false"));
    type.setActive(id === "type" && app.dataset.view === "stage");
    if (id === "enhance" && !enhReady) {
      enhReady = true;
      requestAnimationFrame(() => enh.init());
    }
    MU.pop.closeAll();
    MU.store.set("scene", id);
    setTimeout(() => {
      MU.refreshRim();
      $$(".seg").forEach((s) => s._seg && s._seg.place(false));
    }, 30);
    MU.wake();
  }

  function setView(v) {
    app.dataset.view = v;
    $("#view-switch")._seg.set(v, { silent: true });
    type.setActive(v === "stage" && app.dataset.scene === "type");
    MU.pop.closeAll();
    app.classList.remove("is-idle");
    if (v === "kit") {
      stopTour();
      setTimeout(() => $$("#kit .seg").forEach((s) => s._seg && s._seg.place(false)), 50);
    }
    MU.store.set("view", v);
    setTimeout(MU.refreshRim, 30);
    MU.pointerWork();
  }

  $("#view-switch").addEventListener("change", (e) => setView(e.detail.value));
  $$("#scene-menu [data-scene]").forEach((b) =>
    b.addEventListener("click", () => {
      setScene(b.dataset.scene);
      MU.pop.close($("#scene-menu"));
    })
  );
  $$("[data-action]").forEach((b) =>
    b.addEventListener("click", () => {
      const a = b.dataset.action;
      MU.pop.closeAll();
      if (a === "kit") setView("kit");
      if (a === "hide") toggleChrome();
      if (a === "tour") startTour();
    })
  );

  /* ---------- type scene controls ---------- */

  const text = $("#t-text");
  text.addEventListener("input", () => type.setText(text.value));
  $("#fs-depth").addEventListener("input", (e) => type.setDepth(e.detail.value));
  $("#fs-spacing").addEventListener("input", (e) => type.setSpacing(e.detail.value));

  const zoom = $("#fs-zoom");
  zoom.addEventListener("input", (e) => type.setZoom(e.detail.value));
  const zoomBy = (d) => zoom._fs.set(zoom._fs.value + d, { final: true });
  $("#zoom-in").addEventListener("click", () => zoomBy(10));
  $("#zoom-out").addEventListener("click", () => zoomBy(-10));
  type.onZoomWheel = (d) => zoom._fs.set(zoom._fs.value + d);

  /* fonts */
  const fontGrid = $("#font-grid");
  const fontName = $("#font-name");
  fontGrid.innerHTML = MU.FONTS.map(
    (f, i) =>
      `<button class="font-tile" role="radio" aria-checked="${i === 0}" aria-label="${f.name}" data-family="${f.family}" style="font-family:'${f.family}', var(--font-ui)">Aa</button>`
  ).join("");
  const fontPop = $("#font-pop");
  const fontBtn = $("#font-btn");
  fontBtn.addEventListener("click", () => {
    MU.pop.toggle(fontPop, fontBtn, {
      onClose: () => {
        type.clearPreview();
        fontName.textContent = MU.FONTS.find((f) => f.family === type.state.font).name;
      },
    });
    if (MU.pop.isOpen(fontPop) && MU.lastInputKeyboard) {
      setTimeout(() => $('.font-tile[aria-checked="true"]', fontGrid).focus(), 40);
    }
  });
  fontGrid.addEventListener("pointerover", (e) => {
    const t = e.target.closest(".font-tile");
    if (!t) return;
    type.setFont(t.dataset.family, true);
    fontName.textContent = t.getAttribute("aria-label");
  });
  fontGrid.addEventListener("pointerleave", () => {
    type.clearPreview();
    fontName.textContent = MU.FONTS.find((f) => f.family === type.state.font).name;
  });
  fontGrid.addEventListener("click", (e) => {
    const t = e.target.closest(".font-tile");
    if (!t) return;
    $$(".font-tile", fontGrid).forEach((x) => x.setAttribute("aria-checked", x === t ? "true" : "false"));
    type.setFont(t.dataset.family);
    fontBtn.style.fontFamily = `'${t.dataset.family}', var(--font-ui)`;
  });
  fontGrid.addEventListener("keydown", (e) => {
    const tiles = $$(".font-tile", fontGrid);
    const i = tiles.indexOf(document.activeElement);
    const m = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 }[e.key];
    if (m && i > -1) {
      e.preventDefault();
      tiles[clamp(i + m, 0, tiles.length - 1)].focus();
    }
  });

  /* materials */
  const matBody = $("#mat-body");
  const sphereStyle = (m) => `--mat:${m.swatch}`;
  const groups = [
    ["basic", "Basic"],
    ["iridescent", "Iridescent"],
  ];
  matBody.innerHTML = groups
    .map(([g, label], gi) => {
      const list = MU.MATERIALS.filter((m) => m.group === g);
      return `<div class="acc is-open"><button class="acc-head"><span class="sphere" style="${sphereStyle(list[gi === 0 ? 9 : 0])}"></span><span>${label}</span><span class="tri" aria-hidden="true"></span></button>
      <div class="acc-body"><div><div class="swatch-grid" role="radiogroup" aria-label="${label} materials">${list
        .map(
          (m) =>
            `<button class="swatch" role="radio" aria-checked="${m.id === "sorbet"}" aria-label="${m.name}" data-mat="${m.id}"><span class="sphere" style="${sphereStyle(m)}"></span></button>`
        )
        .join("")}</div></div></div></div>`;
    })
    .join("");
  $$(".acc", matBody).forEach((a) => MU.initComponents(a));

  const matPanels = $("#mat-panels");
  const matBtn = $("#mat-btn");
  const matName = $("#mat-name");
  const matBtnSphere = $("#mat-btn-sphere");
  function rollTitle(name) {
    const host = matName.parentElement;
    const old = matName;
    if (old.textContent === name) return;
    const next = document.createElement("span");
    next.textContent = name;
    next.style.transform = "translateY(100%)";
    next.style.opacity = "0";
    next.style.position = "absolute";
    next.style.inset = "0";
    host.appendChild(next);
    requestAnimationFrame(() => {
      old.style.transform = "translateY(-100%)";
      old.style.opacity = "0";
      next.style.transform = "";
      next.style.opacity = "";
    });
    setTimeout(() => {
      old.textContent = name;
      old.style.transition = "none";
      old.style.transform = "";
      old.style.opacity = "";
      next.remove();
      requestAnimationFrame(() => (old.style.transition = ""));
    }, 430);
  }
  function applyMat(id) {
    const m = type.setMaterial(id);
    if (!m) return;
    $$(".swatch", matBody).forEach((s) => s.setAttribute("aria-checked", s.dataset.mat === id ? "true" : "false"));
    rollTitle(m.name);
    matBtnSphere.style.cssText = sphereStyle(m);
    matPanels.style.setProperty("--panel-glow", m.glow);
    // material defaults for appearance
    $$('#props-panel .fs[data-prop="metal"]')[0]._fs.set(m.metal);
    $$('#props-panel .fs[data-prop="rough"]')[0]._fs.set(m.rough);
  }
  matBody.addEventListener("click", (e) => {
    const s = e.target.closest(".swatch");
    if (s) applyMat(s.dataset.mat);
  });
  matBtnSphere.style.cssText = sphereStyle(MU.MATERIALS.find((m) => m.id === "sorbet"));
  matPanels.style.setProperty("--panel-glow", "rgba(255,120,210,.45)");

  function toggleMat(force) {
    const open = force ?? !matPanels.classList.contains("is-open");
    if (open) MU.pop.open(matPanels, matBtn, { focus: false });
    else MU.pop.close(matPanels);
  }
  matBtn.addEventListener("click", () => toggleMat());
  matPanels.dataset.sticky = "";
  $$("[data-close='mat-panels']").forEach((b) => b.addEventListener("click", () => toggleMat(false)));
  $$("#props-panel .fs").forEach((el) => el.addEventListener("input", (e) => type.setProp(el.dataset.prop, e.detail.value)));

  /* environment + orbit */
  const ENVS = [
    ["studio", "Studio"],
    ["dusk", "Dusk"],
    ["void", "Void"],
  ];
  let envI = 0;
  const envBtn = $("#env-btn");
  envBtn.addEventListener("click", () => {
    envI = (envI + 1) % ENVS.length;
    const [id, name] = ENVS[envI];
    $$(".env").forEach((e) => e.classList.toggle("is-on", e.dataset.env === id));
    $$("span", envBtn).forEach((s) => s.classList.toggle("is-on", s.classList.contains(id)));
    envBtn.dataset.tip = "Lighting: " + name;
    MU.toast("Lighting: " + name);
  });
  const orbitBtn = $("#orbit-btn");
  orbitBtn.addEventListener("click", () => {
    const on = orbitBtn.getAttribute("aria-pressed") !== "true";
    orbitBtn.setAttribute("aria-pressed", on ? "true" : "false");
    type.setOrbit(on);
  });

  /* ---------- busy button helper ---------- */

  function runBusy(btn, ms, label, onTick) {
    return new Promise((resolve) => {
      const lbl = $(".lbl", btn);
      const prog = $(".progress", btn);
      const orig = lbl ? lbl.textContent : "";
      btn.classList.add("is-busy");
      btn.setAttribute("aria-busy", "true");
      const t0 = performance.now();
      MU.tick(() => {
        const k = clamp((performance.now() - t0) / ms, 0, 1);
        prog && prog.style.setProperty("--p", k.toFixed(3));
        if (lbl) lbl.textContent = `${label} ${Math.round(k * 100)}%`;
        onTick && onTick(k);
        if (k >= 1) {
          setTimeout(() => {
            btn.classList.remove("is-busy");
            btn.removeAttribute("aria-busy");
            prog && prog.style.setProperty("--p", "0");
            if (lbl) lbl.textContent = orig;
            resolve();
          }, 260);
          return false;
        }
      });
    });
  }

  /* export (mocked) */
  const exportBtn = $("#export-btn");
  exportBtn.addEventListener("click", () => {
    if (exportBtn.classList.contains("is-busy")) return;
    runBusy(exportBtn, 900, "").then(() => {
      if (app.dataset.scene === "type") {
        const name = (type.state.text.trim() || "Untitled").replace(/\s+/g, "-");
        MU.toast(`Exported ${name}.png`, "3840 × 2160 · mock");
      } else {
        const s = enh.state.scale;
        MU.toast("Exported enhanced.png", `${960 * s} × ${540 * s} · mock`);
      }
    });
  });

  /* ---------- enhance scene controls ---------- */

  $("#view-seg").addEventListener("change", (e) => enh.setMode(e.detail.value));
  $("#scale-seg").addEventListener("change", (e) => enh.setScale(e.detail.value));
  $("#fs-strength").addEventListener("input", (e) => enh.setStrength(e.detail.value));

  const prompt = $("#prompt-main");
  prompt.value = enh.PALETTES[0].prompt;
  prompt.dispatchEvent(new Event("input"));

  const thumbs = $("#thumbs");
  thumbs.innerHTML = enh.PALETTES.map(
    (p, i) =>
      `<button role="radio" aria-checked="${i === 0}" aria-label="${p.name}" data-i="${i}" style="--i:${enh.PALETTES.length - 1 - i};z-index:${10 - i}"><canvas></canvas></button>`
  ).join("");
  $$("button", thumbs).forEach((b) => enh.thumb(+b.dataset.i, $("canvas", b)));
  thumbs.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    $$("button", thumbs).forEach((x) => x.setAttribute("aria-checked", x === b ? "true" : "false"));
    const i = +b.dataset.i;
    enh.setPalette(i);
    prompt.value = enh.PALETTES[i].prompt;
    prompt.dispatchEvent(new Event("input"));
  });

  const fileIn = $("#add-image-file");
  $("#add-image").addEventListener("click", () => fileIn.click());
  fileIn.addEventListener("change", () => {
    const f = fileIn.files[0];
    if (!f || !f.type.startsWith("image/")) {
      if (f) MU.toast("That file is not an image", "PNG, JPG, WEBP");
      return;
    }
    const img = new Image();
    img.onload = () => {
      enh.setImage(img);
      $$("button", thumbs).forEach((x) => x.setAttribute("aria-checked", "false"));
      prompt.value = "";
      prompt.placeholder = "Describe what should stay sharp in " + f.name;
      prompt.dispatchEvent(new Event("input"));
      MU.toast("Opened " + f.name, MU.fmtBytes(f.size));
    };
    img.src = URL.createObjectURL(f);
  });
  $("#scene-enhance").addEventListener("dragover", (e) => e.preventDefault());
  $("#scene-enhance").addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const dt = new DataTransfer();
    dt.items.add(f);
    fileIn.files = dt.files;
    fileIn.dispatchEvent(new Event("change"));
  });

  const advBtn = $("#adv-btn");
  advBtn.addEventListener("click", () => MU.pop.toggle($("#adv-pop"), advBtn, { focus: false }));

  let styleI = 0;
  const STYLES = [
    ["linear-gradient(160deg, #ff7aa2, #c2185b)", "Portrait warmth"],
    ["linear-gradient(160deg, #7fd3ff, #1f4fd6)", "Cold film"],
    ["linear-gradient(160deg, #ffd27a, #c25a18)", "Golden hour"],
  ];
  $("#style-btn").addEventListener("click", (e) => {
    styleI = (styleI + 1) % STYLES.length;
    const av = $(".avatar", e.currentTarget);
    av.style.background = STYLES[styleI][0];
    e.currentTarget.dataset.tip = "Style: " + STYLES[styleI][1];
    MU.toast("Style reference: " + STYLES[styleI][1]);
  });

  const enhBtn = $("#enhance-btn");
  enhBtn.addEventListener("click", () => {
    if (enhBtn.classList.contains("is-busy")) return;
    let k = 0;
    enh.enhance((p) => (k = p));
    runBusy(enhBtn, MU.reduced() ? 300 : 2100, "Enhancing").then(() => {
      const s = enh.state.scale;
      MU.toast(`Enhanced ${s}×`, `${960 * s} × ${540 * s}`);
    });
  });

  /* ---------- kit extras ---------- */

  const kitSw = $("#kit-swatches");
  kitSw.innerHTML = ["sorbet", "chalk", "lagoon", "grape", "toxic", "holo"]
    .map((id, i) => {
      const m = MU.MATERIALS.find((x) => x.id === id);
      return `<button class="swatch" role="radio" aria-checked="${i === 0}" aria-label="${m.name}"><span class="sphere" style="${sphereStyle(m)}"></span></button>`;
    })
    .join("");
  kitSw.setAttribute("role", "radiogroup");
  kitSw.setAttribute("aria-label", "Materials");
  kitSw.addEventListener("click", (e) => {
    const s = e.target.closest(".swatch");
    if (s) $$(".swatch", kitSw).forEach((x) => x.setAttribute("aria-checked", x === s ? "true" : "false"));
  });

  MU.pop.enhance($("#kit-menu"));

  const curves = $("#curves");
  $("#curves-play").addEventListener("click", () => {
    $$(".curve-track", curves).forEach((t) => curves.style.setProperty("--track-w", t.offsetWidth + "px"));
    curves.classList.toggle("is-play");
  });

  $("#kit-toast").addEventListener("click", () => MU.toast("Preset saved", "Sorbet · Bagel"));

  const kitBusy = $("#kit-busy");
  kitBusy.addEventListener("click", () => {
    if (!kitBusy.classList.contains("is-busy")) runBusy(kitBusy, 2000, "Enhancing");
  });

  $("#kit-reset").addEventListener("click", (e) => {
    const cluster = e.currentTarget.closest(".cluster");
    $$(".fs", cluster).forEach((f) => f._fs.reset());
    $$(".tag[aria-pressed='true']", cluster).forEach((t) => t.click());
    MU.toast("Reset to defaults");
  });

  /* ---------- tour ---------- */

  const STEPS = [
    {
      target: "#dock-type",
      title: "Type, depth and spacing",
      text: "Edit the word, then drag Depth and Spacing. Drag nudges from the current value; hold Shift for fine steps.",
      art: `<div class="art art-type"><div class="word"><span class="back">Aa</span><span class="face">Aa</span></div><div class="bars"><i style="--w:40%"></i><i style="--w:25%"></i></div></div>`,
    },
    {
      target: "#font-btn",
      title: "Font selection",
      text: "Pick a face from the collection. Hover a tile to preview it on the stage before you commit.",
      art: `<div class="art art-fonts"><div class="sheet">${MU.FONTS.map(
        (f, i) => `<span class="${i === 4 ? "on" : ""}" style="font-family:'${f.family}'">Aa</span>`
      ).join("")}</div></div>`,
    },
    {
      target: "#mat-btn",
      title: "Materials",
      text: "Choose a finish, then tune tile, color, direction and light in Properties. The panel title rolls to the new name.",
      art: `<div class="art art-mats"><div class="row">${["chalk", "lagoon", "sorbet", "grape", "butter"]
        .map((id) => `<span class="sphere" style="--mat:${MU.MATERIALS.find((m) => m.id === id).swatch}"></span>`)
        .join("")}</div></div>`,
    },
    {
      target: ".t-rig",
      title: "Grab the object",
      text: "Drag the lettering to turn it. Let go and it springs back with the momentum you gave it. Tap it for a squish.",
      art: `<div class="art art-grab"><span class="word">Peace</span><span class="hand"><svg class="i"><use href="#i-hand"/></svg></span></div>`,
    },
    {
      target: "#export-btn",
      title: "Focus on the object",
      text: "Chrome dims away from the cursor and fades out when you stop moving. Hover Export to see the hero action charge up.",
      art: `<div class="art art-juice"><span class="blob a"></span><span class="blob b"></span><span class="slab"></span><span class="btn">EXPORT</span></div>`,
    },
  ];
  const coachWrap = $("#coach-wrap");
  const coachBody = $("#coach-body");
  const dots = $("#coach-dots");
  const spot = $("#spot");
  const back = $("#coach-back");
  const next = $("#coach-next");
  const count = $("#coach-count");
  let step = -1;
  let tourOn = false;

  coachBody.innerHTML = STEPS.map(
    (s, i) =>
      `<div class="coach-step out-right" data-i="${i}" aria-hidden="true"><div class="coach-art">${s.art}</div><h3 class="coach-title">${s.title}</h3><p class="coach-text">${s.text}</p></div>`
  ).join("");
  dots.innerHTML = STEPS.map(() => "<i></i>").join("");

  function placeSpot() {
    if (!tourOn) return;
    const el = $(STEPS[step].target);
    if (!el) return;
    let r = el.getBoundingClientRect();
    if (el.classList.contains("t-rig")) {
      const f = $(".t-layer.front", el);
      if (f) r = f.getBoundingClientRect();
    }
    const pad = 6;
    spot.style.transform = `translate(${r.left - pad}px, ${r.top - pad}px)`;
    spot.style.width = r.width + pad * 2 + "px";
    spot.style.height = r.height + pad * 2 + "px";
    const radius = parseFloat(getComputedStyle(el).borderRadius) || 14;
    spot.style.borderRadius = radius + pad + "px";
  }
  function go(i) {
    step = i;
    $$(".coach-step", coachBody).forEach((el, k) => {
      el.classList.toggle("out-left", k < i);
      el.classList.toggle("out-right", k > i);
      el.setAttribute("aria-hidden", k === i ? "false" : "true");
    });
    $$("i", dots).forEach((d, k) => {
      d.classList.toggle("on", k === i);
      d.classList.toggle("done", k < i);
    });
    back.style.visibility = i === 0 ? "hidden" : "visible";
    next.textContent = i === STEPS.length - 1 ? "Done" : "Next";
    count.textContent = `${i + 1} / ${STEPS.length}`;
    placeSpot();
  }
  function startTour() {
    if (app.dataset.view !== "stage") setView("stage");
    if (app.dataset.scene !== "type") setScene("type");
    app.classList.remove("chrome-hidden");
    tourOn = true;
    coachWrap.classList.add("is-open");
    spot.classList.add("is-on");
    app.classList.add("is-touring");
    $$(".chrome .float").forEach((f) => f.classList.add("is-pinned"));
    step = -1;
    go(0);
    setTimeout(() => next.focus({ preventScroll: true }), 300);
  }
  function stopTour() {
    if (!tourOn) return;
    tourOn = false;
    coachWrap.classList.remove("is-open");
    spot.classList.remove("is-on");
    $$(".chrome .float").forEach((f) => f.classList.remove("is-pinned"));
    MU.store.set("toured", true);
  }
  next.addEventListener("click", () => (step < STEPS.length - 1 ? go(step + 1) : stopTour()));
  back.addEventListener("click", () => step > 0 && go(step - 1));
  $("#coach-close").addEventListener("click", stopTour);
  $("#help-btn").addEventListener("click", () => (tourOn ? stopTour() : startTour()));
  window.addEventListener("resize", placeSpot);
  // keep the ring on the object while it sways
  (function follow() {
    if (tourOn && STEPS[step] && STEPS[step].target === ".t-rig") placeSpot();
    setTimeout(follow, 160);
  })();

  /* ---------- chrome visibility + settings ---------- */

  function toggleChrome() {
    const hidden = app.classList.toggle("chrome-hidden");
    if (hidden) {
      MU.pop.closeAll();
      stopTour();
      MU.toast("Interface hidden", "Press H to bring it back");
    }
  }

  const swFocus = $("#sw-focus");
  swFocus.setAttribute("aria-checked", MU.settings.focus ? "true" : "false");
  swFocus.addEventListener("change", (e) => {
    MU.settings.focus = e.detail.value;
    MU.store.set("focus", e.detail.value);
    MU.pointerWork();
    if (!e.detail.value) app.classList.remove("is-idle");
  });
  const swMotion = $("#sw-motion");
  const rm = MU.store.get("reduce", false);
  swMotion.setAttribute("aria-checked", rm ? "true" : "false");
  document.documentElement.classList.toggle("reduce-motion", rm);
  swMotion.addEventListener("change", (e) => {
    document.documentElement.classList.toggle("reduce-motion", e.detail.value);
    MU.store.set("reduce", e.detail.value);
  });

  /* ---------- keyboard ---------- */

  window.addEventListener("keydown", (e) => {
    const t = e.target;
    if (t.matches("input, textarea, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "k") setView(app.dataset.view === "kit" ? "stage" : "kit");
    if (app.dataset.view !== "stage") return;
    if (k === "h") toggleChrome();
    if (e.key === "?") tourOn ? stopTour() : startTour();
    if (k === "e") exportBtn.click();
    if (app.dataset.scene === "type") {
      if (k === "m") toggleMat();
      if (k === "f") fontBtn.click();
      if (k === "o") orbitBtn.click();
      if (e.key === "+" || e.key === "=") zoomBy(10);
      if (e.key === "-") zoomBy(-10);
    } else {
      const mode = { 1: "single", 2: "slider", 3: "side", 4: "pip" }[e.key];
      if (mode) $("#view-seg")._seg.set(mode);
    }
  });

  /* ---------- boot ---------- */

  const savedScene = MU.store.get("scene", "type");
  const savedView = MU.store.get("view", "stage");
  setScene(savedScene, { quiet: true });
  setView(savedView);
  MU.refreshRim();
  MU.wake();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      $$(".seg").forEach((s) => s._seg && s._seg.place(false));
      MU.refreshRim();
    });
  }
  if (!MU.store.get("toured", false) && savedView === "stage") setTimeout(startTour, 1400);
})();
