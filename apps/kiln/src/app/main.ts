import '../ui/kit/tokens.css';
import '../ui/kit/components.css';
import '../ui/kit/stage.css';
import './styles.css';
import * as THREE from 'three/webgpu';
import { $, $$, kit, pop, refreshRim, store, toast, wake, initTips } from '../ui/kit/core';
import { initComponents, initSeg } from '../ui/kit/components';
import { sanitizeSvg } from '../shape/svg';
import { GeometryCache, svgRef } from '../doc/geometry';
import { SceneRuntime, type RuntimeChanges } from '../doc/runtime';
import { EXAMPLES, glyphDoc } from '../doc/examples';
import { emptyDoc, setGlyph, topLevel } from '../doc/ops';
import { findObject, type GlyphRef, type Kind, type SceneDoc } from '../doc/scene';
import { Editor } from './editor';
import { Viewport, VIEWS, VIEWPORT_PADDING } from './viewport';
import { Picker } from './picking';
import { Overlay } from './overlay';
import { Manipulator } from './manipulate';
import { Actions } from './actions';
import { Layers } from './layers';
import { Library, type LibraryMode } from './library';
import { SelBar } from './selbar';
import { Dock } from './dock';
import { MaterialPanel } from './material-panel';
import { LightIsland } from './light';
import { initExport } from './export';

const EXPORT_PADDING = 0.12;
/** the fine mesh follows once edits pause this long, ms */
const FINAL_DELAY = 700;

/* ---------- core: viewport, document, runtime ---------- */

const app = $('#app')!;
kit.app = app;
const view = await Viewport.create($<HTMLCanvasElement>('#viewport')!);
if (!view.webgpu) $('#no-gpu')!.hidden = false;
const { studio } = view;

const geo = new GeometryCache();
const runtime = new SceneRuntime(geo);
studio.setContent(runtime.root);
const editor = new Editor();
const svgOf = (ref: string) => geo.svgIfKnown(ref);

const overlaySvg = $<SVGSVGElement>('#overlay')!;
const overlay = new Overlay(overlaySvg, editor, runtime, view);
const picker = new Picker(view, runtime);
const manip = new Manipulator(editor, runtime, view, picker, overlay, overlaySvg);
const actions = new Actions(editor, runtime, view);
const layers = new Layers(editor, actions, overlay, svgOf);
const library = new Library();
const selbar = new SelBar(editor, runtime, view, actions, svgOf);
const dock = new Dock(editor, view);
const materials = new MaterialPanel(editor);
const light = new LightIsland((rig) => {
  studio.setRig(rig);
  studio.refreshRig();
  view.invalidate({ lights: true });
});
view.frameHooks.push(() => overlay.update());

/* ---------- document → scene ---------- */

const bakeEl = $('#bake')!;
let loading = false;
let finalTimer = 0;
let sceneName = 'Safe';
let exampleView: { az: number; el: number } | null = EXAMPLES[0].view;

function applyChanges(ch: RuntimeChanges, glide: boolean) {
  if (!ch.geometry && !ch.transforms && !ch.materials) return;
  view.invalidate({ geometry: ch.geometry, transforms: ch.transforms, materials: ch.materials });
  if (ch.geometry || ch.transforms) view.reframe(glide && !loading);
}

/** Preview meshes while editing, the fine mesh once edits pause. */
function scheduleFinal(delay = FINAL_DELAY) {
  clearTimeout(finalTimer);
  finalTimer = window.setTimeout(() => {
    if (editor.inGesture) {
      scheduleFinal(delay);
      return;
    }
    applyChanges(runtime.reconcile(editor.doc, 'final'), true);
  }, delay);
}

/** Exports never use preview meshes. */
async function ensureFinal() {
  clearTimeout(finalTimer);
  for (let i = 0; i < 4 && !runtime.isFinal(editor.doc); i++) {
    applyChanges(runtime.reconcile(editor.doc, 'final'), false);
    await runtime.settled();
  }
}

runtime.onAsync = (ch) => applyChanges(ch, true);
runtime.onBusy = (busy) => {
  view.meshing = busy;
  bakeEl.classList.toggle('is-busy', busy);
  bakeEl.setAttribute('aria-label', busy ? 'Building mesh' : 'Mesh ready');
  // while a new document loads the frame is held: say what is happening anyway
  if (busy) view.setStatus('busy');
  view.invalidate({});
};
runtime.onError = (m) => toast('Could not build this shape', m, 'error');

function refreshUi() {
  layers.render();
  selbar.sync();
  dock.sync();
  materials.sync();
}

editor.subscribe((e) => {
  if (e.doc) {
    applyChanges(runtime.reconcile(editor.doc, 'preview'), !e.replaced);
    scheduleFinal();
  }
  refreshUi();
});

/**
 * Opens a document. The last frame stays on screen until the new meshes land, then the camera
 * frames the new scene and swings to its view.
 */
async function load(doc: SceneDoc, name: string, angles: { az: number; el: number } | null, jump = false) {
  loading = true;
  view.hold = true;
  sceneName = name;
  exampleView = angles;
  $('#scene-name')!.textContent = name;
  editor.load(doc);
  await runtime.settled();
  loading = false;
  view.hold = false;
  view.reframe(false);
  if (angles) {
    camSeg.set('three-quarter-right', { silent: true });
    if (jump) view.jumpTo(angles.az, angles.el);
    else view.orbitTo(angles.az, angles.el);
  }
}

/* ---------- examples + brand menu ---------- */

const brandMenu = $('#brand-menu')!;
function markExample(id: string | null) {
  $$('#brand-menu [data-example]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.example === id)));
}
function openExample(id: string) {
  const ex = EXAMPLES.find((x) => x.id === id) ?? EXAMPLES[0];
  markExample(ex.id);
  void load(ex.build(), ex.name, ex.view);
}
$$('#brand-menu [data-example]').forEach((b) =>
  b.addEventListener('click', () => {
    pop.close(brandMenu);
    openExample(b.dataset.example!);
  }),
);
$('#brand-menu [data-action="blank"]')!.addEventListener('click', () => {
  pop.close(brandMenu);
  markExample(null);
  void load(emptyDoc(), 'Untitled', null);
});
$('#brand-menu [data-action="shapes"]')!.addEventListener('click', () => {
  pop.close(brandMenu);
  library.open('new', $('#brand-btn')!);
});
$('#brand-menu [data-action="open"]')!.addEventListener('click', () => {
  pop.close(brandMenu);
  openFile('new');
});

/* ---------- icons and SVG files ---------- */

const fileInput = $<HTMLInputElement>('#svg-file')!;
let fileMode: LibraryMode = 'add';

function iconTargets() {
  return topLevel(editor.doc, editor.selection).filter((id) => {
    const o = findObject(editor.doc, id);
    return o?.kind === 'glyph' || o?.kind === 'badge';
  });
}

/** An icon picked or uploaded, used in the mode it was asked for. */
function usePicked(glyph: GlyphRef, mode: LibraryMode) {
  if (mode === 'add') actions.addGlyph(glyph);
  else if (mode === 'replace') {
    const ids = iconTargets();
    if (!ids.length) actions.addGlyph(glyph);
    else editor.change((d) => ids.forEach((id) => setGlyph(d, id, glyph)));
  } else {
    markExample(null);
    void load(glyphDoc(glyph), glyph.name.replace(/-/g, ' '), VIEWS['three-quarter-right']);
  }
}

library.onPick = (g, mode) => {
  const ref = `phosphor:${g.name}`;
  geo.register(ref, g.svg);
  usePicked({ name: g.name, ref }, mode);
};
library.onUpload = (mode) => openFile(mode);

function openFile(mode: LibraryMode) {
  fileMode = mode;
  fileInput.click();
}

async function loadSvgFile(file: File, mode: LibraryMode) {
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
    const ref = await svgRef(svg);
    geo.register(ref, svg);
    usePicked({ name: file.name.replace(/\.svg$/i, ''), ref }, mode);
    toast(mode === 'add' ? 'Shape added' : 'Shape loaded', file.name);
  } catch (e) {
    toast('Could not read this SVG', (e as Error).message, 'error');
  }
}
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) void loadSvgFile(f, fileMode);
  fileInput.value = '';
});

function openLibrary() {
  const ids = iconTargets();
  if (ids.length === 1) {
    const o = findObject(editor.doc, ids[0]);
    library.open('replace', $('#sel-chip')!.offsetParent ? $('#sel-chip')! : $('#add-btn')!, o?.glyph?.name ?? null);
  } else library.open('add', $('#add-btn')!);
}
selbar.onReplaceIcon = (anchor) => {
  const o = findObject(editor.doc, iconTargets()[0] ?? '');
  library.open('replace', anchor, o?.glyph?.name ?? null);
};

// drop anywhere: the SVG joins the scene
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
  if (f) void loadSvgFile(f, 'add');
});

/* ---------- add menu ---------- */

const addMenu = $('#add-menu')!;
$$<HTMLElement>('#add-menu [data-add]').forEach((b) =>
  b.addEventListener('click', () => {
    pop.close(addMenu);
    const k = b.dataset.add!;
    if (k === 'icon') library.open('add', $('#add-btn')!);
    else if (k === 'svg') openFile('add');
    else if (k === 'badge') actions.add('badge', { glyph: { name: 'star', ref: 'phosphor:star' } });
    else actions.add(k as Kind);
  }),
);

/* ---------- camera ---------- */

const camSeg = initSeg($('#cam-seg')!);
$('#cam-seg')!.addEventListener('change', () => {
  const v = VIEWS[camSeg.value];
  view.orbitTo(v.az, v.el);
});
$('#ortho-btn')!.addEventListener('change', (e) => {
  studio.setCamera({ ortho: (e as CustomEvent<{ value: boolean }>).detail.value });
  studio.frame(view.aspect());
  view.invalidate({ camera: true, lights: true });
});
function resetView() {
  const v = exampleView && camSeg.value === 'three-quarter-right' ? exampleView : VIEWS[camSeg.value];
  view.orbitTo(v.az, v.el);
}
manip.onResetView = resetView;

/* ---------- export ---------- */

const exporter = initExport({
  studio,
  tracer: view.tracer,
  ensureFinal,
  name: () => sceneName.replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'scene',
  begin: () => {
    view.exporting = true;
    app.classList.add('is-exporting');
    studio.setCamera({ padding: EXPORT_PADDING });
    studio.frame(1);
  },
  end: () => {
    view.exporting = false;
    app.classList.remove('is-exporting');
    studio.setCamera({ padding: VIEWPORT_PADDING });
    studio.frame(view.aspect());
    view.invalidate({ camera: true, lights: true, environment: true });
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
  view.invalidate({});
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

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
const isDepthKey = (e: KeyboardEvent) => e.code === 'BracketLeft' || e.code === 'BracketRight';
/** controls that already use the arrow keys */
const ownsArrows = (t: HTMLElement) => !!t.closest('.seg, .fs, .orb, .menu, .glyph-pop, .layers-list, [role="slider"]');

window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;
  const t = e.target as HTMLElement;
  if (t.matches('input, textarea, [contenteditable]')) return;
  const k = e.key.toLowerCase();
  if (e.metaKey || e.ctrlKey) {
    if (k === 'z') {
      if (e.shiftKey) editor.redo();
      else editor.undo();
    } else if (k === 'y') editor.redo();
    else if (k === 'd') actions.duplicate();
    else if (k === 'g') {
      if (e.shiftKey) actions.ungroup();
      else actions.group();
    } else if (k === 'a') editor.selectAll();
    else return;
    e.preventDefault();
    return;
  }
  if (e.altKey) return;
  const arrow = ARROWS[e.key];
  if (arrow || isDepthKey(e)) {
    if (ownsArrows(t) || !editor.selection.length) return;
    if (arrow) manip.nudge(arrow[0], arrow[1], 0, e.shiftKey);
    else manip.nudge(0, 0, e.code === 'BracketRight' ? 1 : -1, e.shiftKey);
    e.preventDefault();
    return;
  }
  if (k === 'escape') {
    if (!manip.cancel()) editor.escape();
  } else if (k === 'delete' || k === 'backspace') actions.remove();
  else if (k === 'e') exporter.toggle();
  else if (k === 'a') pop.toggle(addMenu, $('#add-btn'));
  else if (k === 's') openLibrary();
  else if (k === 'o') openFile('add');
  else if (k === 'm') materials.toggle(!materials.isOpen);
  else if (k === 'h') toggleChrome();
  else if (k === 'r') resetView();
  else if (k === 'p') $('#ortho-btn')!.click();
  else if (['1', '2', '3', '4'].includes(k)) camSeg.set(Object.keys(VIEWS)[Number(k) - 1]);
  else return;
  e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  if (ARROWS[e.key] || isDepthKey(e)) manip.endNudge();
});
window.addEventListener('blur', () => manip.endNudge());

/* ---------- boot ---------- */

initComponents(document);
initTips();
refreshRim();
studio.setRig(light.rig);
markExample(EXAMPLES[0].id);
await load(EXAMPLES[0].build(), EXAMPLES[0].name, EXAMPLES[0].view, true);
refreshUi();
wake();

/** Automation hooks for the e2e. */
Object.assign(window, {
  __kiln: {
    ready: true,
    webgpu: view.webgpu,
    editor,
    runtime,
    exporter,
    library,
    layers,
    doc: () => editor.doc,
    select: (ids: string[]) => editor.select(ids),
    objectScreenRect: (id: string) => overlay.rectOf([id]),
    status: () => ({ state: view.statusState, spp: view.lastCount, meshing: runtime.busy, final: runtime.isFinal(editor.doc) }),
    tracerStats: () => (view.tracer ? { ...view.tracer.stats } : null),
    camera: () => ({ position: studio.camera.position.toArray(), frozen: studio.isFrozen }),
    pauseTrace: (p: boolean) => (view.tracePaused = p),
    setTraceScale: (s: number) => {
      view.traceScale = s;
      view.invalidate({});
    },
    THREE,
  },
});
