import '../ui/kit/tokens.css';
import '../ui/kit/components.css';
import '../ui/kit/stage.css';
import './styles.css';
import * as THREE from 'three/webgpu';
import { $, $$, clamp, kit, odo, pop, refreshRim, store, tick, toast, wake, initTips, Spring } from '../ui/kit/core';
import { initComponents, initFs, initSeg } from '../ui/kit/components';
import { createRenderer, hasWebGPUBackend, Tracer, type SceneChanges } from '../render/tracer';
import { Studio } from '../studio/studio';
import { DEFAULT_RIG, type RigParams } from '../scene/lights';
import { MATERIAL_LIBRARY, swatchColor, type MaterialSpec } from '../scene/materials';
import { applyMaterials, defaultMaterials, partsIn, type MaterialSet, type Part } from '../examples/parts';
import { HOUSE_HERO } from '../examples/house';
import { PIN_HERO } from '../examples/pin';
import { sanitizeSvg } from '../shape/svg';
import { Subject, formDefaults, type FormChoice, type SceneId, type ShapeState } from './subject';
import { SHORTLIST, loadAllGlyphs, searchGlyphs, shortGlyph, type Glyph } from './glyphs';
import { initExport } from './export';

/* ---------- state ---------- */

const VIEWS: Record<string, { az: number; el: number }> = {
  'three-quarter-right': { az: 23, el: 4 },
  front: { az: 0, el: 2 },
  'three-quarter-left': { az: -23, el: 4 },
  top: { az: 20, el: 34 },
};
const VIEWPORT_PADDING = 0.2;
const EXPORT_PADDING = 0.12;
const TRACE_SAMPLES = 64;
/** viewport trace size as a fraction of the CSS size */
let traceScale = 0.6;
/** e2e: hold the viewport tracer so screenshots can grab a frame */
let tracePaused = false;

const state = {
  shape: {
    scene: 'safe' as SceneId,
    glyph: shortGlyph('vault'),
    form: 'soft' as FormChoice,
    ...formDefaults('soft'),
  } satisfies ShapeState as ShapeState,
  materials: defaultMaterials() as MaterialSet,
  part: 'body' as Part,
  rig: { ...DEFAULT_RIG } as RigParams,
  view: 'three-quarter-right',
};

/* ---------- renderer, studio, tracer ---------- */

const app = $('#app')!;
kit.app = app;
const canvas = $<HTMLCanvasElement>('#viewport')!;
const renderer = await createRenderer(canvas);
const webgpu = hasWebGPUBackend(renderer);
if (!webgpu) $('#no-gpu')!.hidden = false;
const studio = new Studio(renderer);
studio.setCamera({ padding: VIEWPORT_PADDING });
const tracer = webgpu ? new Tracer(renderer) : null;

const statusEl = $('#status')!;
const statusText = $('#status-text')!;
const statusSpp = $('#status-spp')!;
const bakeEl = $('#bake')!;
let meshing = false;
const subject = new Subject((busy) => {
  meshing = busy;
  bakeEl.classList.toggle('is-busy', busy);
  bakeEl.setAttribute('aria-label', busy ? 'Building mesh' : 'Mesh ready');
});
studio.setContent(subject.root);

/* ---------- viewport loop: raster while things move, path tracing when idle ---------- */

let needsRaster = true;
let changedAt = performance.now();
let tracing = false;
let traceDone = false;
let lastCount = 0;
let countPending = false;
let exporting = false;

function aspect() {
  return canvas.clientWidth / Math.max(1, canvas.clientHeight);
}

function invalidate(changes: SceneChanges = {}) {
  tracer?.invalidate(changes);
  needsRaster = true;
  changedAt = performance.now();
  tracing = false;
  traceDone = false;
  lastCount = 0;
}

function setStatus(mode: 'raster' | 'tracing' | 'done' | 'busy', spp = 0) {
  statusEl.dataset.state = mode;
  statusText.textContent = mode === 'busy' ? 'Building mesh' : mode === 'raster' ? 'Preview' : mode === 'tracing' ? 'Tracing' : 'Traced';
  if (mode === 'tracing' || mode === 'done') odo(statusSpp, `${spp} spp`);
  else statusSpp.textContent = '';
}

function resize() {
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  studio.frame(aspect());
  invalidate({ camera: true, lights: true, environment: true });
}
new ResizeObserver(resize).observe(canvas);

const orbitAz = new Spring(VIEWS[state.view].az, { stiffness: 140, damping: 22 });
const orbitEl = new Spring(VIEWS[state.view].el, { stiffness: 140, damping: 22 });

tick(() => {
  orbitAz.step(1 / 60);
  orbitEl.step(1 / 60);
  const moving = !orbitAz.done || !orbitEl.done;
  if (moving || studio.cam.az !== orbitAz.value || studio.cam.el !== orbitEl.value) {
    studio.setCamera({ az: orbitAz.value, el: orbitEl.value });
    studio.frame(aspect());
    invalidate({ camera: true, lights: true, environment: true });
  }
  if (exporting) return;
  if (needsRaster) {
    studio.render();
    needsRaster = false;
    setStatus(meshing ? 'busy' : 'raster');
    return;
  }
  if (!tracer || meshing || traceDone || tracePaused || performance.now() - changedAt < 300) return;
  if (!tracing) {
    // half the CSS size: converges fast, the fade hides the switch from raster
    tracer.beginViewport(studio.scene, studio.camera, {
      width: canvas.clientWidth * traceScale,
      height: canvas.clientHeight * traceScale,
      maxSamples: TRACE_SAMPLES,
    });
    tracing = true;
    lastCount = 0;
    setStatus('tracing', 0);
  }
  tracer.stepViewport();
  if (!countPending) {
    countPending = true;
    tracer.sampleCount().then((c) => {
      countPending = false;
      if (!tracing) return;
      lastCount = c.min;
      if (c.min >= TRACE_SAMPLES) {
        traceDone = true;
        setStatus('done', TRACE_SAMPLES);
      } else setStatus('tracing', Math.max(lastCount, Math.floor(c.avg)));
    });
  }
});

/* ---------- content ---------- */

let finalTimer = 0;
let shapeTimer = 0;
let finalPending: Promise<void> | null = null;

function contentChanged() {
  applyMaterials(subject.root, state.materials);
  studio.contentChanged();
  studio.frame(aspect());
  invalidate({ geometry: true });
  refreshParts();
  updateMatButton();
}

async function bakeFinal() {
  if (await subject.update(state.shape, 'final')) contentChanged();
}

/** Preview mesh now, fine mesh once edits settle. */
function shapeChanged(delay = 30) {
  clearTimeout(shapeTimer);
  clearTimeout(finalTimer);
  finalPending = null;
  shapeTimer = window.setTimeout(async () => {
    try {
      if (await subject.update(state.shape, 'preview')) contentChanged();
      if (state.shape.scene === 'safe') return;
      finalTimer = window.setTimeout(() => {
        finalPending = bakeFinal().catch((e) => toast('Mesh failed', (e as Error).message, 'error'));
      }, 700);
    } catch (e) {
      toast('Could not build this shape', (e as Error).message, 'error');
    }
  }, delay);
}

async function ensureFinal() {
  if (subject.final) return;
  clearTimeout(finalTimer);
  clearTimeout(shapeTimer);
  await (finalPending ?? bakeFinal());
}

/* ---------- examples + brand menu ---------- */

const EXAMPLES: Record<string, { name: string; hero?: { glyph: string; form: FormChoice; depth: number; roundness: number; puff: number }; view: { az: number; el: number } }> = {
  safe: { name: 'Safe', view: { az: 23, el: 2 } },
  house: { name: 'House', hero: HOUSE_HERO, view: { az: 24, el: 4 } },
  pin: { name: 'Pin', hero: PIN_HERO, view: { az: 18, el: 10 } },
};

function setSceneName(name: string) {
  $('#scene-name')!.textContent = name;
}

function openExample(id: string) {
  const ex = EXAMPLES[id];
  state.shape.scene = id as SceneId;
  if (ex.hero) {
    state.shape.glyph = shortGlyph(ex.hero.glyph);
    state.shape.form = ex.hero.form;
    state.shape.depth = ex.hero.depth;
    state.shape.roundness = ex.hero.roundness;
    state.shape.puff = ex.hero.puff;
  }
  $$('#brand-menu [data-example]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.example === id)));
  setSceneName(ex.name);
  syncDock();
  orbitTo(ex.view.az, ex.view.el);
  camSeg.set('three-quarter-right', { silent: true });
  shapeChanged(0);
}

$$('#brand-menu [data-example]').forEach((b) =>
  b.addEventListener('click', () => {
    pop.close($('#brand-menu')!);
    openExample(b.dataset.example!);
  }),
);
$('#brand-menu [data-action="shapes"]')!.addEventListener('click', () => {
  pop.close($('#brand-menu')!);
  openGlyphs();
});
$('#brand-menu [data-action="open"]')!.addEventListener('click', () => {
  pop.close($('#brand-menu')!);
  fileInput.click();
});

/* ---------- shape library ---------- */

const glyphBtn = $<HTMLButtonElement>('#glyph-btn')!;
const glyphPop = $('#glyph-pop')!;
const glyphGrid = $('#glyph-grid')!;
const glyphHead = $('#glyph-head')!;
const glyphSearch = $<HTMLInputElement>('#glyph-search')!;
const fileInput = $<HTMLInputElement>('#svg-file')!;

function glyphIcon(svg: string) {
  // our own sanitizer: icons come from the package, uploads are sanitized before they get here
  const tpl = document.createElement('template');
  tpl.innerHTML = svg.trim();
  const el = tpl.content.firstElementChild as SVGElement | null;
  el?.setAttribute('aria-hidden', 'true');
  return el;
}

function renderGlyphs(list: Glyph[], head: string) {
  glyphHead.textContent = head;
  glyphGrid.textContent = '';
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'glyph-empty';
    empty.textContent = 'Nothing found. Try “card”, “coin” or “home”.';
    glyphGrid.appendChild(empty);
    return;
  }
  for (const g of list) {
    const b = document.createElement('button');
    b.className = 'glyph-cell';
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(g.name === state.shape.glyph.name));
    b.setAttribute('aria-label', g.name.replace(/-/g, ' '));
    b.dataset.tip = g.name.replace(/-/g, ' ');
    const icon = glyphIcon(g.svg);
    if (icon) b.appendChild(icon);
    b.addEventListener('click', () => pickGlyph(g));
    glyphGrid.appendChild(b);
  }
}

function updateGlyphPreview() {
  const p = $('#glyph-preview')!;
  p.textContent = '';
  const icon = glyphIcon(state.shape.glyph.svg);
  if (icon) p.appendChild(icon);
}

function pickGlyph(g: { name: string; svg: string }) {
  state.shape.glyph = { name: g.name, svg: g.svg };
  if (state.shape.scene === 'safe') {
    state.shape.scene = 'glyph';
    $$('#brand-menu [data-example]').forEach((b) => b.setAttribute('aria-checked', 'false'));
  }
  if (state.shape.scene === 'glyph') setSceneName(g.name.replace(/-/g, ' '));
  $$('.glyph-cell', glyphGrid).forEach((c) => c.setAttribute('aria-selected', String(c.getAttribute('aria-label') === g.name.replace(/-/g, ' '))));
  updateGlyphPreview();
  syncDock();
  shapeChanged(0);
}

function openGlyphs() {
  if (!pop.isOpen(glyphPop)) pop.open(glyphPop, glyphBtn);
  setTimeout(() => glyphSearch.focus(), 60);
}
glyphBtn.addEventListener('click', () => {
  pop.toggle(glyphPop, glyphBtn);
  if (pop.isOpen(glyphPop)) setTimeout(() => glyphSearch.focus(), 60);
});
renderGlyphs(SHORTLIST, 'Banking');

let searchSeq = 0;
glyphSearch.addEventListener('input', async () => {
  const q = glyphSearch.value;
  const seq = ++searchSeq;
  if (!q.trim()) {
    renderGlyphs(SHORTLIST, 'Banking');
    return;
  }
  glyphHead.textContent = 'Searching…';
  const all = await loadAllGlyphs();
  if (seq !== searchSeq) return;
  const found = searchGlyphs(all, q, 120);
  renderGlyphs(found, found.length ? `${found.length === 120 ? '120+' : found.length} icons` : 'No icons');
});

async function loadSvgFile(file: File) {
  if (!/\.svg$/i.test(file.name) && file.type !== 'image/svg+xml') {
    toast('That file is not an SVG', file.name, 'error');
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    toast('SVG is too large', 'Up to 2 MB', 'error');
    return;
  }
  try {
    const svg = sanitizeSvg(await file.text());
    pop.close(glyphPop);
    pickGlyph({ name: file.name.replace(/\.svg$/i, ''), svg });
    toast('Shape loaded', file.name);
  } catch (e) {
    toast('Could not read this SVG', (e as Error).message, 'error');
  }
}
$('#open-btn')!.addEventListener('click', () => fileInput.click());
$('#glyph-open')!.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) loadSvgFile(f);
  fileInput.value = '';
});

// drop anywhere
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  app.classList.add('is-dropping');
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) app.classList.remove('is-dropping');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  app.classList.remove('is-dropping');
  const f = e.dataTransfer?.files?.[0];
  if (f) loadSvgFile(f);
});

/* ---------- form dock ---------- */

const formSeg = initSeg($('#form-seg')!);
const fsDepth = initFs($('#fs-depth')!);
const fsRound = initFs($('#fs-round')!);
const fsPuff = initFs($('#fs-puff')!);
const dock = $('#dock')!;

function syncDock() {
  const s = state.shape;
  const locked = s.scene === 'safe';
  dock.classList.toggle('is-locked', locked);
  $('#dock-lock')!.hidden = !locked;
  formSeg.set(s.form, { silent: true });
  fsDepth.set(s.depth, { silent: true });
  fsRound.set(s.roundness, { silent: true });
  fsPuff.set(s.puff, { silent: true });
  $('#fs-puff')!.setAttribute('aria-disabled', String(s.form !== 'inflate'));
  $('#fs-round')!.setAttribute('aria-disabled', String(s.form === 'inflate'));
}

$('#form-seg')!.addEventListener('change', () => {
  const form = formSeg.value as FormChoice;
  state.shape.form = form;
  Object.assign(state.shape, formDefaults(form));
  syncDock();
  shapeChanged(0);
});
for (const [el, key] of [
  [$('#fs-depth')!, 'depth'],
  [$('#fs-round')!, 'roundness'],
  [$('#fs-puff')!, 'puff'],
] as const) {
  el.addEventListener('input', (e) => {
    state.shape[key] = (e as CustomEvent<{ value: number }>).detail.value;
    shapeChanged(60);
  });
}
$('#dock-pick')!.addEventListener('click', openGlyphs);

/* ---------- materials ---------- */

const matPanels = $('#mat-panels')!;
const matBtn = $<HTMLButtonElement>('#mat-btn')!;
const partSeg = initSeg($('#part-seg')!);
const swatches = $('#swatches')!;
const colorInput = $<HTMLInputElement>('#mat-color')!;
const fsRough = initFs($('#fs-rough')!);
const fsCoat = initFs($('#fs-coat')!);
const fsMetal = initFs($('#fs-metal')!);

function currentSpec() {
  return state.materials[state.part];
}

function renderSwatches() {
  swatches.textContent = '';
  const cur = currentSpec();
  for (const m of MATERIAL_LIBRARY) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(m.id === cur.id));
    b.setAttribute('aria-label', m.name);
    const sp = document.createElement('span');
    sp.className = 'sphere';
    sp.style.setProperty('--mat', swatchColor(m));
    if (m.metalness) sp.style.setProperty('--spec', '0.95');
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = m.name;
    b.append(sp, label);
    b.addEventListener('click', () => setMaterial({ ...m }));
    swatches.appendChild(b);
  }
}

function syncProps() {
  const m = currentSpec();
  $('#mat-name')!.textContent = m.name;
  colorInput.value = m.gradient ? m.gradient[1] : m.color;
  fsRough.set(Math.round(m.roughness * 100), { silent: true });
  fsCoat.set(Math.round((m.clearcoat ?? 0) * 100), { silent: true });
  fsMetal.set(Math.round((m.metalness ?? 0) * 100), { silent: true });
  const glow = m.gradient ? m.gradient[1] : m.color;
  $$('.panel-head', matPanels).forEach((h) => h.style.setProperty('--panel-glow', glow));
}

function updateMatButton() {
  $('#mat-sphere')!.style.setProperty('--mat', swatchColor(state.materials.body));
}

function materialsChanged() {
  applyMaterials(subject.root, state.materials);
  invalidate({ geometry: true });
  updateMatButton();
}

function setMaterial(m: MaterialSpec) {
  state.materials[state.part] = m;
  renderSwatches();
  syncProps();
  materialsChanged();
}

function editMaterial(patch: Partial<MaterialSpec>) {
  state.materials[state.part] = { ...currentSpec(), ...patch };
  materialsChanged();
}

function refreshParts() {
  const present = partsIn(subject.root);
  $$<HTMLButtonElement>('#part-seg > button').forEach((b) => (b.disabled = !present.includes(b.dataset.value as Part)));
  if (!present.includes(state.part) && present.length) {
    state.part = present[0];
    partSeg.set(state.part, { silent: true });
    renderSwatches();
    syncProps();
  }
}

matBtn.addEventListener('click', () => {
  const open = !matPanels.classList.contains('is-open');
  matPanels.classList.toggle('is-open', open);
  matBtn.setAttribute('aria-expanded', String(open));
  kit.openCount += open ? 1 : -1;
  wake();
  setTimeout(refreshRim, 0);
});
$$('[data-close="mat-panels"]').forEach((b) =>
  b.addEventListener('click', () => {
    if (!matPanels.classList.contains('is-open')) return;
    matPanels.classList.remove('is-open');
    matBtn.setAttribute('aria-expanded', 'false');
    kit.openCount = Math.max(0, kit.openCount - 1);
    matBtn.focus();
  }),
);
$('#part-seg')!.addEventListener('change', () => {
  state.part = partSeg.value as Part;
  renderSwatches();
  syncProps();
});
colorInput.addEventListener('input', () => editMaterial({ color: colorInput.value, gradient: undefined, id: 'custom', name: 'Custom' }));
$('#fs-rough')!.addEventListener('input', (e) => editMaterial({ roughness: (e as CustomEvent<{ value: number }>).detail.value / 100 }));
$('#fs-coat')!.addEventListener('input', (e) => editMaterial({ clearcoat: (e as CustomEvent<{ value: number }>).detail.value / 100 }));
$('#fs-metal')!.addEventListener('input', (e) => editMaterial({ metalness: (e as CustomEvent<{ value: number }>).detail.value / 100 }));

/* ---------- light ---------- */

const orb = $('#orb')!;
function placeOrbKey() {
  const x = clamp(state.rig.keyAz / 80, -1, 1);
  const y = clamp(-state.rig.keyEl / 70, -1, 1);
  const kx = 50 + x * 38;
  const ky = 50 + y * 38;
  orb.style.setProperty('--kx', `${kx}%`);
  orb.style.setProperty('--ky', `${ky}%`);
  orb.style.setProperty('--lx', `${50 + x * 30}%`);
  orb.style.setProperty('--ly', `${50 + y * 30}%`);
  const h = state.rig.keyAz < -10 ? 'left' : state.rig.keyAz > 10 ? 'right' : 'center';
  const v = state.rig.keyEl > 15 ? 'upper' : state.rig.keyEl < -5 ? 'lower' : 'middle';
  orb.setAttribute('aria-valuetext', `${v} ${h}`);
}
function rigChanged() {
  studio.setRig(state.rig);
  studio.frame(aspect());
  invalidate({ lights: true });
  placeOrbKey();
}
let orbDrag = false;
function orbAt(e: PointerEvent) {
  const r = orb.getBoundingClientRect();
  const x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
  const y = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
  state.rig.keyAz = Math.round(x * 80);
  state.rig.keyEl = Math.round(-y * 70);
  rigChanged();
}
orb.addEventListener('pointerdown', (e) => {
  orbDrag = true;
  kit.busy = true;
  orb.setPointerCapture(e.pointerId);
  orbAt(e);
});
orb.addEventListener('pointermove', (e) => orbDrag && orbAt(e));
const orbEnd = () => {
  orbDrag = false;
  kit.busy = false;
};
orb.addEventListener('pointerup', orbEnd);
orb.addEventListener('pointercancel', orbEnd);
orb.addEventListener('dblclick', () => {
  state.rig.keyAz = DEFAULT_RIG.keyAz;
  state.rig.keyEl = DEFAULT_RIG.keyEl;
  rigChanged();
});
orb.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 15 : 5;
  const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] } as Record<string, [number, number]>)[e.key];
  if (!d) return;
  e.preventDefault();
  state.rig.keyAz = clamp(state.rig.keyAz + d[0], -80, 80);
  state.rig.keyEl = clamp(state.rig.keyEl + d[1], -70, 70);
  rigChanged();
});
$('#fs-intensity')!.addEventListener('input', (e) => {
  state.rig.intensity = (e as CustomEvent<{ value: number }>).detail.value / 100;
  rigChanged();
});
$('#fs-soft')!.addEventListener('input', (e) => {
  state.rig.softness = (e as CustomEvent<{ value: number }>).detail.value / 100;
  rigChanged();
});
$('#fs-warm')!.addEventListener('input', (e) => {
  state.rig.warmth = (e as CustomEvent<{ value: number }>).detail.value;
  rigChanged();
});

/* ---------- camera ---------- */

const camSeg = initSeg($('#cam-seg')!);
function orbitTo(az: number, el: number) {
  orbitAz.set(az);
  orbitEl.set(el);
}
$('#cam-seg')!.addEventListener('change', () => {
  state.view = camSeg.value;
  const v = VIEWS[state.view];
  orbitTo(v.az, v.el);
});
const orthoBtn = $('#ortho-btn')!;
orthoBtn.addEventListener('change', (e) => {
  studio.setCamera({ ortho: (e as CustomEvent<{ value: boolean }>).detail.value });
  studio.frame(aspect());
  invalidate({ camera: true, lights: true });
});
function resetView() {
  const ex = EXAMPLES[state.shape.scene];
  const v = ex && state.view === 'three-quarter-right' ? ex.view : VIEWS[state.view];
  orbitTo(v.az, v.el);
}

// orbit by dragging the viewport
let drag: { x: number; y: number; t: number; vx: number; vy: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0 };
  kit.busy = true;
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  const now = performance.now();
  const dt = Math.max(1, now - drag.t);
  drag.vx = (dx / dt) * 1000;
  drag.vy = (dy / dt) * 1000;
  drag.x = e.clientX;
  drag.y = e.clientY;
  drag.t = now;
  orbitAz.jump(orbitAz.value - dx * 0.35);
  orbitEl.jump(clamp(orbitEl.value + dy * 0.3, -15, 70));
});
const dragEnd = () => {
  if (!drag) return;
  // momentum: glide on with the release velocity
  const recent = performance.now() - drag.t < 80;
  if (recent) {
    orbitAz.set(orbitAz.value - drag.vx * 0.35 * 0.18);
    orbitEl.set(clamp(orbitEl.value + drag.vy * 0.3 * 0.18, -15, 70));
  }
  drag = null;
  kit.busy = false;
};
canvas.addEventListener('pointerup', dragEnd);
canvas.addEventListener('pointercancel', dragEnd);
canvas.addEventListener('dblclick', resetView);

/* ---------- export ---------- */

const exporter = initExport({
  studio,
  tracer,
  ensureFinal,
  name: () => (state.shape.scene === 'glyph' ? state.shape.glyph.name : state.shape.scene).replace(/[^a-z0-9-]+/gi, '-').toLowerCase(),
  begin: () => {
    exporting = true;
    app.classList.add('is-exporting');
    studio.setCamera({ padding: EXPORT_PADDING });
    studio.frame(1);
  },
  end: () => {
    exporting = false;
    app.classList.remove('is-exporting');
    studio.setCamera({ padding: VIEWPORT_PADDING });
    studio.frame(aspect());
    invalidate({ camera: true, lights: true, environment: true });
  },
});

/* ---------- settings ---------- */

const swFocus = $('#sw-focus')!;
swFocus.setAttribute('aria-checked', String(kit.settings.focus));
swFocus.addEventListener('change', (e) => {
  kit.settings.focus = (e as CustomEvent<{ value: boolean }>).detail.value;
  store.set('focus', kit.settings.focus);
  wake();
});
$('#sw-motion')!.addEventListener('change', (e) => document.documentElement.classList.toggle('reduce-motion', (e as CustomEvent<{ value: boolean }>).detail.value));
$('#sw-filmic')!.addEventListener('change', (e) => {
  studio.setView({ transform: (e as CustomEvent<{ value: boolean }>).detail.value ? 'filmic' : 'standard' });
  invalidate({});
});
function toggleChrome() {
  app.classList.toggle('chrome-hidden');
  if (app.classList.contains('chrome-hidden')) toast('Interface hidden', 'Press H to bring it back');
}
$('#settings-menu [data-action="hide"]')!.addEventListener('click', () => {
  pop.closeAll();
  toggleChrome();
});
$('#settings-menu [data-action="reset-view"]')!.addEventListener('click', () => {
  pop.closeAll();
  resetView();
});

/* ---------- keyboard ---------- */

window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.matches('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'e') exporter.toggle();
  else if (k === 's') openGlyphs();
  else if (k === 'o') fileInput.click();
  else if (k === 'm') matBtn.click();
  else if (k === 'h') toggleChrome();
  else if (k === 'r') resetView();
  else if (k === 'p') orthoBtn.click();
  else if (['1', '2', '3', '4'].includes(k)) {
    const id = Object.keys(VIEWS)[Number(k) - 1];
    camSeg.set(id);
  } else return;
  e.preventDefault();
});

/* ---------- boot ---------- */

initComponents(document);
initTips();
refreshRim();
renderSwatches();
syncProps();
placeOrbKey();
updateGlyphPreview();
syncDock();
studio.setRig(state.rig);
orbitTo(EXAMPLES.safe.view.az, EXAMPLES.safe.view.el);
orbitAz.jump(EXAMPLES.safe.view.az);
orbitEl.jump(EXAMPLES.safe.view.el);
await subject.update(state.shape, 'final');
contentChanged();
resize();
wake();

/** Automation hooks for the e2e. */
Object.assign(window, {
  __kiln: {
    ready: true,
    webgpu,
    state,
    exporter,
    status: () => ({ state: statusEl.dataset.state, spp: lastCount, meshing, final: subject.final }),
    pauseTrace: (p: boolean) => (tracePaused = p),
    setTraceScale: (s: number) => {
      traceScale = s;
      invalidate({});
    },
    THREE,
  },
});
