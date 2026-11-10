import '@kit/tokens.css';
import '@kit/components.css';
import '@kit/stage.css';
import './styles.css';
import { $, kit, pop, refreshRim, toast, initTips, fmtBytes } from '@kit/core';
import { initComponents, initSeg } from '@kit/components';
import {
  FORMATS,
  LAYOUTS,
  POSES,
  addKey,
  applyLayout,
  cloneState,
  keyAt,
  newDevice,
  newText,
  uid,
  writeState,
  type Device,
  type Key,
  type ModelId,
  type Project,
} from './doc';
import { Editor } from './editor';
import { DEMO, addFile, getMedia, mediaFromDataUrl, mediaToDataUrl, onMedia, prune, registerDemos, restore } from './media';
import { FONTS, FONT_SAMPLE } from './layers2d';
import { Studio } from './studio';
import { Viewport } from './viewport';
import { Inspector } from './inspector';
import { Timeline } from './timeline';
import { TEMPLATES } from './templates';
import type { ExportKind } from './exporter';

/* ---------- boot ---------- */

const app = $('#app')!;
kit.app = app;
kit.settings.focus = false;
initTips();

// fonts first: demo screens and text layers are drawn on canvases
await Promise.race([
  Promise.all(FONTS.flatMap((f) => [400, 600].map((w) => document.fonts.load(`${w} 40px "${f.id}"`, FONT_SAMPLE)))),
  new Promise((r) => setTimeout(r, 2500)),
]);
registerDemos();

const stored = Editor.stored();
const ed = new Editor(stored && stored.v === 1 ? stored : TEMPLATES[0].make());
ed.sel = ed.doc.devices[0]?.id ?? null;
const studio = new Studio($<HTMLCanvasElement>('#view')!);

let dirty = true;
const invalidate = () => (dirty = true);
const view = new Viewport(ed, studio, { invalidate });
const fileMedia = $<HTMLInputElement>('#file-media')!;
const fileProject = $<HTMLInputElement>('#file-project')!;
let mediaTarget: string | null = null;

const inspector = new Inspector(ed, {
  pickMedia: (id) => {
    mediaTarget = id;
    fileMedia.click();
  },
  duplicate: (id) => duplicate(id),
  remove: (id) => removeObject(id),
});
const timeline = new Timeline(ed, { togglePlay: () => togglePlay(), keySelection: () => keySelection() });

void restore(mediaIds(ed.doc)).then(invalidate);
onMedia(() => {
  invalidate();
  inspector.render(true);
});

function mediaIds(p: Project) {
  return p.devices.map((d) => d.media).filter((x): x is string => !!x);
}

/* ---------- reactions ---------- */

let lastFormat = '';
ed.on((why) => {
  dirty = true;
  if (why === 'time') {
    timeline.updatePlayhead();
    if (!ed.playing) inspector.render();
    syncVideos();
    return;
  }
  const fmt = `${ed.doc.format.w}x${ed.doc.format.h}x${ed.doc.format.fps}x${ed.doc.format.duration}`;
  if (fmt !== lastFormat) {
    lastFormat = fmt;
    view.fit();
    formatSeg.set(FORMATS.find((f) => f.w === ed.doc.format.w && f.h === ed.doc.format.h && f.id !== 'appstore' && f.id !== 'play')?.id ?? '', { silent: true });
  }
  if (why === 'sel' || why === 'structure') {
    if (why === 'sel' && ed.sel) inspector.showTab('sel');
    else inspector.render(why === 'structure');
    renderLayers();
    timeline.render();
  } else {
    inspector.render();
    timeline.render();
    renderLayers(true);
  }
  ensureFonts();
  updateUndo();
});

/* ---------- render loop and playback ---------- */

let exporting = false;
let last = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (exporting) return;
  if (ed.playing) {
    let t = ed.time + dt;
    const d = ed.doc.format.duration;
    if (t >= d) {
      if (ed.loop) t %= d;
      else {
        t = d;
        ed.playing = false;
        timeline.updateHead();
        inspector.render();
      }
    }
    ed.time = t;
    timeline.updatePlayhead();
    syncVideos();
    dirty = true;
  }
  if (dirty || hasLiveVideo()) {
    dirty = false;
    studio.render(ed.doc, ed.time);
    view.drawOverlay();
  }
}
requestAnimationFrame(frame);

function usedVideos() {
  const out: HTMLVideoElement[] = [];
  for (const d of ed.doc.devices) {
    const m = getMedia(d.media);
    if (d.visible && m?.kind === 'video') out.push(m.el as HTMLVideoElement);
  }
  return [...new Set(out)];
}
function hasLiveVideo() {
  return ed.playing && usedVideos().length > 0;
}
function syncVideos() {
  for (const v of usedVideos()) {
    const target = v.duration ? ed.time % v.duration : 0;
    if (ed.playing) {
      if (v.paused) void v.play().catch(() => {});
      if (Math.abs(v.currentTime - target) > 0.2) v.currentTime = target;
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - target) > 1 / 60) {
        v.currentTime = target;
        v.addEventListener(
          'seeked',
          () => {
            const id = ed.doc.devices.find((d) => getMedia(d.media)?.el === v)?.media;
            if (id) studio.refreshVideo(id);
            dirty = true;
          },
          { once: true },
        );
      }
    }
  }
}

function togglePlay() {
  ed.playing = !ed.playing;
  if (ed.playing && !ed.loop && ed.time >= ed.doc.format.duration - 1e-3) ed.time = 0;
  ed.selKey = null;
  timeline.updateHead();
  syncVideos();
  if (!ed.playing) inspector.render();
  dirty = true;
}

/* ---------- editing actions ---------- */

function keySelection() {
  const tr = ed.track(ed.sel);
  if (!tr) {
    toast('Select a device or the camera to key it', '', 'error');
    return;
  }
  const k = keyAt(tr.keys as Key<unknown>[], ed.time);
  ed.change(
    () => {
      if (k) {
        const ks = tr.keys as { id: string; s: unknown }[];
        if (ks.length === 1) (tr as { base: unknown }).base = cloneState(ks[0].s);
        ks.splice(
          ks.findIndex((x) => x.id === k.id),
          1,
        );
        ed.selKey = null;
      } else {
        ed.selKey = addKey(tr as never, ed.time).id;
      }
    },
    { commit: true },
  );
  if (!k && tr.keys.length === 1) toast('First key set', 'Move the playhead and change anything: the next key appears by itself');
}

function defaultMedia(model: ModelId) {
  return model === 'laptop' ? DEMO.dashboard : model === 'tablet' ? DEMO.tablet : model === 'android' ? DEMO.savings : DEMO.home;
}

function addDevice(model: ModelId) {
  const d = newDevice(model, defaultMedia(model));
  const n = ed.doc.devices.length;
  if (n) {
    const xs = ed.doc.devices.map((x) => ed.deviceState(x).pos[0]);
    d.base.pos = [Math.max(...xs) + (model === 'laptop' ? 2.6 : 1.0), 0, 0];
  }
  if (!n && model === 'laptop') ed.doc.camera.base.dist = Math.max(ed.doc.camera.base.dist, 8.5);
  ed.change((p) => p.devices.push(d), { commit: true, structure: true });
  ed.select(d.id);
}

function addText() {
  const t = newText('Новый заголовок', { y: 0.5, start: Math.min(ed.time, ed.doc.format.duration - 0.5) });
  ed.change((p) => p.texts.push(t), { commit: true, structure: true });
  ed.select(t.id);
}

function duplicate(id: string) {
  const d = ed.device(id);
  if (d) {
    const c: Device = cloneState(d);
    c.id = uid('d');
    c.name = d.name + ' copy';
    c.keys.forEach((k) => (k.id = uid('k')));
    c.base.pos = [c.base.pos[0] + 0.9, c.base.pos[1], c.base.pos[2]];
    c.keys.forEach((k) => (k.s.pos = [k.s.pos[0] + 0.9, k.s.pos[1], k.s.pos[2]]));
    ed.change((p) => p.devices.push(c), { commit: true, structure: true });
    ed.select(c.id);
    return;
  }
  const t = ed.text(id);
  if (t) {
    const c = { ...cloneState(t), id: uid('t'), y: Math.min(0.95, t.y + 0.06) };
    ed.change((p) => p.texts.push(c), { commit: true, structure: true });
    ed.select(c.id);
  }
}

function removeObject(id: string) {
  ed.change(
    (p) => {
      p.devices = p.devices.filter((d) => d.id !== id);
      p.texts = p.texts.filter((t) => t.id !== id);
    },
    { commit: true, structure: true },
  );
  ed.select(null);
}

async function setMedia(file: File, deviceId: string | null) {
  try {
    const m = await addFile(file);
    const target = ed.device(deviceId) ?? ed.device(ed.sel) ?? ed.doc.devices[0];
    if (!target) {
      toast('Add a device first', '', 'error');
      return;
    }
    ed.change(() => (ed.device(target.id)!.media = m.id), { commit: true });
    ed.select(target.id);
    toast(`${m.kind === 'video' ? 'Video' : 'Screen'} on ${target.name}`, `${m.w}×${m.h} · ${fmtBytes(file.size)}`);
  } catch (e) {
    toast((e as Error).message, '', 'error');
  }
}

fileMedia.addEventListener('change', () => {
  const f = fileMedia.files?.[0];
  if (f) void setMedia(f, mediaTarget);
  fileMedia.value = '';
});

/* ---------- layers ---------- */

const layersList = $('#layers-list')!;
function renderLayers(soft = false) {
  if (soft && document.activeElement?.closest('#layers-list')) return;
  const rows: string[] = [];
  const row = (id: string, icon: string, name: string, keys: number, hidden?: boolean) =>
    `<div class="layer${hidden ? ' is-hidden' : ''}" role="option" data-id="${id}" aria-selected="${ed.sel === id}"><svg class="i"><use href="#${icon}"/></svg><span class="name">${esc(name)}</span>${
      keys ? `<span class="keys">◆${keys}</span>` : ''
    }${hidden !== undefined ? `<button class="cell clear icon-btn sm" data-eye="${id}" aria-pressed="${!!hidden}" aria-label="Show or hide"><svg class="i i-sm"><use href="#${hidden ? 'i-eye-off' : 'i-eye'}"/></svg></button>` : ''}</div>`;
  rows.push(row('camera', 'i-camera', 'Camera', ed.doc.camera.keys.length));
  ed.doc.devices.forEach((d) => rows.push(row(d.id, d.model === 'laptop' ? 'i-laptop' : d.model === 'tablet' ? 'i-tablet' : 'i-phone', d.name, d.keys.length, !d.visible)));
  if (ed.doc.texts.length) rows.push('<div class="layer-sep"></div>');
  ed.doc.texts.forEach((t) => rows.push(row(t.id, 'i-text', t.name, 0, !t.visible)));
  layersList.innerHTML = rows.join('');
  $('#layout-row')!.hidden = ed.doc.devices.filter((d) => d.visible).length < 2;
}
layersList.addEventListener('click', (e) => {
  const eye = (e.target as HTMLElement).closest<HTMLElement>('[data-eye]');
  if (eye) {
    const id = eye.dataset.eye!;
    ed.change(
      () => {
        const o = ed.device(id) ?? ed.text(id);
        if (o) o.visible = !o.visible;
      },
      { commit: true, structure: true },
    );
    return;
  }
  const l = (e.target as HTMLElement).closest<HTMLElement>('.layer');
  if (l) ed.select(l.dataset.id!);
});
layersList.addEventListener('dblclick', (e) => {
  const l = (e.target as HTMLElement).closest<HTMLElement>('.layer');
  const id = l?.dataset.id;
  if (!l || !id || id === 'camera') return;
  const nameEl = l.querySelector('.name') as HTMLElement;
  const input = document.createElement('input');
  input.className = 'field';
  input.style.height = '28px';
  input.value = nameEl.textContent ?? '';
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  const done = (ok: boolean) => {
    if (ok && input.value.trim()) {
      ed.change(
        () => {
          const o = ed.device(id) ?? ed.text(id);
          if (o) o.name = input.value.trim();
        },
        { commit: true },
      );
    }
    renderLayers();
  };
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') done(true);
    if (ev.key === 'Escape') done(false);
    ev.stopPropagation();
  });
  input.addEventListener('blur', () => done(true));
});

$('#layout-chips')!.innerHTML = LAYOUTS.map((l) => `<button class="chip" data-layout="${l.id}">${l.label}</button>`).join('');
$('#layout-chips')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-layout]');
  if (b) ed.change((p) => applyLayout(p, b.dataset.layout!, ed.time), { commit: true });
});

$('#add-menu')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-add]');
  if (!b) return;
  pop.close($('#add-menu')!);
  if (b.dataset.add === 'text') addText();
  else addDevice(b.dataset.add as ModelId);
});

/* ---------- top bar ---------- */

const formatSegEl = $('#format-seg')!;
formatSegEl.innerHTML = FORMATS.slice(0, 4)
  .map((f) => `<button data-value="${f.id}" data-tip="${f.sub} · ${f.w}×${f.h}">${f.label}</button>`)
  .join('');
const formatSeg = initSeg(formatSegEl);
const setFormat = (id: string) => {
  const f = FORMATS.find((x) => x.id === id);
  if (!f) return;
  ed.change(
    (p) => {
      p.format.w = f.w;
      p.format.h = f.h;
    },
    { commit: true },
  );
};
formatSegEl.addEventListener('change', (e) => setFormat((e as CustomEvent).detail.value));
$('#format-menu')!.innerHTML =
  FORMATS.map((f) => `<button class="menu-item" data-format="${f.id}"><span>${f.label}<span class="sub">${f.sub} · ${f.w}×${f.h}</span></span></button>`).join('') +
  `<div class="menu-sep"></div><div class="menu-item" tabindex="-1" style="gap:6px"><span style="flex:1">Custom</span><input class="field mono" id="fmt-w" style="width:64px;height:30px" inputmode="numeric"><span>×</span><input class="field mono" id="fmt-h" style="width:64px;height:30px" inputmode="numeric"></div>`;
$('#format-menu')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-format]');
  if (b) {
    setFormat(b.dataset.format!);
    pop.close($('#format-menu')!);
  }
});
for (const sel of ['#fmt-w', '#fmt-h']) {
  const el = $<HTMLInputElement>(sel)!;
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key !== 'Enter') return;
    const w = Math.round(Number($<HTMLInputElement>('#fmt-w')!.value));
    const h = Math.round(Number($<HTMLInputElement>('#fmt-h')!.value));
    if (w >= 64 && h >= 64 && w <= 4096 && h <= 4096) {
      ed.change(
        (p) => {
          p.format.w = w;
          p.format.h = h;
        },
        { commit: true },
      );
      pop.close($('#format-menu')!);
    } else toast('Use 64–4096 px per side', '', 'error');
  });
}
const syncCustomFields = () => {
  $<HTMLInputElement>('#fmt-w')!.value = String(ed.doc.format.w);
  $<HTMLInputElement>('#fmt-h')!.value = String(ed.doc.format.h);
};
$('[data-menu="format-menu"]')!.addEventListener('click', syncCustomFields);

const toolSeg = initSeg($('#tool-seg')!);
$('#tool-seg')!.addEventListener('change', (e) => (ed.tool = (e as CustomEvent).detail.value));
$('#safe-btn')!.addEventListener('change', (e) => {
  ed.safe = (e as CustomEvent).detail.value;
  dirty = true;
});

$('#template-items')!.innerHTML = TEMPLATES.map(
  (t) => `<button class="menu-item" data-template="${t.id}"><svg class="i"><use href="#i-spark"/></svg><span>${t.label}<span class="sub">${t.sub}</span></span></button>`,
).join('');
$('#brand-menu')!.addEventListener('click', (e) => {
  const el = e.target as HTMLElement;
  const t = el.closest<HTMLElement>('[data-template]');
  const a = el.closest<HTMLElement>('[data-action]');
  if (t || a) pop.close($('#brand-menu')!);
  if (t) {
    const p = TEMPLATES.find((x) => x.id === t.dataset.template)!.make();
    ed.load(p);
    ed.setTime(0);
    toast(`${p.name}`, 'Template loaded · ⌘Z will not bring the old scene back, save it first');
  }
  if (a?.dataset.action === 'open') fileProject.click();
  if (a?.dataset.action === 'save') void saveProject();
});

async function saveProject() {
  const media: Record<string, { name: string; data: string }> = {};
  for (const id of mediaIds(ed.doc)) {
    const m = await mediaToDataUrl(id);
    if (m) media[id] = m;
  }
  const blob = new Blob([JSON.stringify({ reel: 1, project: ed.doc, media })], { type: 'application/json' });
  download(blob, `${(ed.doc.name || 'reel').toLowerCase().replace(/\s+/g, '-')}.reel.json`);
  toast('Project saved', fmtBytes(blob.size));
}
fileProject.addEventListener('change', async () => {
  const f = fileProject.files?.[0];
  fileProject.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text()) as { reel?: number; project?: Project; media?: Record<string, { name: string; data: string }> };
    if (!data.project || data.project.v !== 1) throw new Error('Not a Reel project');
    for (const [id, m] of Object.entries(data.media ?? {})) await mediaFromDataUrl(id, m.name, m.data);
    ed.load(data.project);
    ed.setTime(0);
    toast(`Opened ${data.project.name}`);
  } catch (e) {
    toast((e as Error).message || 'Could not open the file', '', 'error');
  }
});

const undoBtn = $<HTMLButtonElement>('#undo')!;
const redoBtn = $<HTMLButtonElement>('#redo')!;
undoBtn.addEventListener('click', () => ed.undo());
redoBtn.addEventListener('click', () => ed.redo());
function updateUndo() {
  undoBtn.disabled = !ed.canUndo;
  redoBtn.disabled = !ed.canRedo;
  $('#project-name')!.textContent = ed.doc.name;
}

/* ---------- export ---------- */

const sheet = $('#export-sheet')!;
const expBtn = $<HTMLButtonElement>('#export-btn')!;
const expKind = initSeg($('#exp-kind')!);
const expScale = initSeg($('#exp-scale')!);
const expFps = initSeg($('#exp-fps')!);
const expAlpha = initSeg($('#exp-alpha')!);
const renderBtn = $<HTMLButtonElement>('#exp-render')!;
const dl = $<HTMLAnchorElement>('#exp-download')!;
let job: { cancelled: boolean } | null = null;
let lastUrl = '';

function openSheet(open = !sheet.classList.contains('is-open')) {
  sheet.classList.toggle('is-open', open);
  expBtn.setAttribute('aria-expanded', String(open));
  if (open) {
    expFps.set(String(ed.doc.format.fps), { silent: true });
    updateExportNote();
  }
}
expBtn.addEventListener('click', () => openSheet());
$('#export-close')!.addEventListener('click', () => openSheet(false));
for (const id of ['#exp-kind', '#exp-scale', '#exp-fps', '#exp-alpha']) $(id)!.addEventListener('change', updateExportNote);

function updateExportNote() {
  const kind = expKind.value as ExportKind;
  const scale = Number(expScale.value);
  const fps = Number(expFps.value);
  const w = Math.round((ed.doc.format.w * scale) / 2) * 2;
  const h = Math.round((ed.doc.format.h * scale) / 2) * 2;
  $('#exp-fps-row')!.hidden = kind === 'png';
  $('#exp-alpha-row')!.hidden = kind !== 'png';
  const n = Math.round(ed.doc.format.duration * fps);
  const note =
    kind === 'png'
      ? `${w}×${h} · frame at ${ed.time.toFixed(2)} s. Move the playhead to pick another frame.`
      : `${w}×${h} · ${ed.doc.format.duration.toFixed(1)} s · ${n} frames, rendered one by one, so motion is smooth even if the preview stutters.${
          ed.doc.bg.kind === 'transparent' && kind === 'mp4' ? ' MP4 has no transparency: the background renders black.' : ''
        }`;
  $('#exp-note')!.textContent = note;
}

renderBtn.addEventListener('click', async () => {
  if (job) {
    job.cancelled = true;
    return;
  }
  const kind = expKind.value as ExportKind;
  const scale = Number(expScale.value);
  const fps = Number(expFps.value);
  ed.playing = false;
  timeline.updateHead();
  job = { cancelled: false };
  exporting = true;
  const busy = $('#frame-busy')!;
  const bar = $('#busy-bar')!;
  busy.hidden = false;
  renderBtn.classList.add('is-busy');
  $('#exp-render-label')!.textContent = 'Cancel';
  dl.hidden = true;
  const t0 = performance.now();
  try {
    // the encoder is loaded on first export
    const { runExport } = await import('./exporter');
    const res = await runExport(ed.doc, studio, {
      kind,
      scale,
      fps,
      transparent: kind === 'png' && expAlpha.value === 'none',
      time: ed.time,
      signal: job,
      onProgress: (p, label) => {
        bar.style.setProperty('--p', p.toFixed(3));
        renderBtn.style.setProperty('--p', p.toFixed(3));
        $('#busy-text')!.textContent = label;
      },
    });
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(res.blob);
    const img = $<HTMLImageElement>('#exp-img')!;
    const vid = $<HTMLVideoElement>('#exp-video')!;
    img.hidden = kind !== 'png';
    vid.hidden = kind === 'png';
    if (kind === 'png') img.src = lastUrl;
    else {
      vid.src = lastUrl;
      void vid.play().catch(() => {});
    }
    $('#exp-result')!.hidden = false;
    $('#exp-meta')!.textContent = `${res.name} · ${fmtBytes(res.blob.size)} · ${((performance.now() - t0) / 1000).toFixed(1)} s`;
    dl.href = lastUrl;
    dl.download = res.name;
    dl.hidden = false;
    dl.click();
    toast('Export ready', res.name);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg !== 'cancelled') toast(msg || 'Export failed', '', 'error');
  } finally {
    job = null;
    exporting = false;
    busy.hidden = true;
    renderBtn.classList.remove('is-busy');
    renderBtn.style.removeProperty('--p');
    $('#exp-render-label')!.textContent = 'Render';
    dirty = true;
    syncVideos();
  }
});
$('#busy-cancel')!.addEventListener('click', () => job && (job.cancelled = true));

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------- drop ---------- */

let dragDepth = 0;
app.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  app.classList.add('is-dropping');
});
app.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) app.classList.remove('is-dropping');
});
app.addEventListener('dragover', (e) => {
  e.preventDefault();
  const id = view.deviceAt(e.clientX, e.clientY);
  if (id !== view.hover) {
    view.hover = id;
    view.drawOverlay();
  }
});
app.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  app.classList.remove('is-dropping');
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  if (f.name.endsWith('.json')) {
    const dt = new DataTransfer();
    dt.items.add(f);
    fileProject.files = dt.files;
    fileProject.dispatchEvent(new Event('change'));
    return;
  }
  void setMedia(f, view.deviceAt(e.clientX, e.clientY));
});
// paste a screenshot straight from the clipboard
window.addEventListener('paste', (e) => {
  const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/') || x.type.startsWith('video/'));
  if (f) void setMedia(f, ed.sel);
});

/* ---------- keyboard ---------- */

let spaceUsed = false;
view.canvas.addEventListener('pointerdown', () => {
  if (view.space) spaceUsed = true;
});
window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key;
  if (mod && k.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) ed.redo();
    else ed.undo();
    return;
  }
  if (mod && k.toLowerCase() === 'y') {
    e.preventDefault();
    ed.redo();
    return;
  }
  if (mod && k.toLowerCase() === 'd') {
    e.preventDefault();
    if (ed.sel && ed.sel !== 'camera') duplicate(ed.sel);
    return;
  }
  if (mod && k.toLowerCase() === 's') {
    e.preventDefault();
    void saveProject();
    return;
  }
  if (mod && k.toLowerCase() === 'o') {
    e.preventDefault();
    fileProject.click();
    return;
  }
  if (mod) return;
  if (k === ' ') {
    e.preventDefault();
    if (!e.repeat) {
      view.space = true;
      spaceUsed = false;
    }
    return;
  }
  const fps = ed.doc.format.fps;
  switch (k) {
    case 'ArrowRight':
    case 'ArrowLeft': {
      e.preventDefault();
      const step = e.shiftKey ? 1 : 1 / fps;
      ed.setTime(Math.round((ed.time + (k === 'ArrowRight' ? step : -step)) * fps) / fps);
      break;
    }
    case 'Home':
      ed.setTime(0);
      break;
    case 'End':
      ed.setTime(ed.doc.format.duration);
      break;
    case 'k':
    case 'K':
      keySelection();
      break;
    case 'j':
    case 'J':
      timeline.jumpKey(-1);
      break;
    case 'l':
    case 'L':
      timeline.jumpKey(1);
      break;
    case 'Delete':
    case 'Backspace':
      e.preventDefault();
      if (!timeline.deleteKey() && ed.sel && ed.sel !== 'camera') removeObject(ed.sel);
      break;
    case 'r':
    case 'R':
      ed.tool = 'rotate';
      toolSeg.set('rotate', { silent: true });
      break;
    case 'g':
    case 'G':
      ed.tool = 'move';
      toolSeg.set('move', { silent: true });
      break;
    case 's':
    case 'S':
      $('#safe-btn')!.click();
      break;
    case 't':
    case 'T':
      addText();
      break;
    case 'h':
    case 'H':
      app.classList.toggle('chrome-hidden');
      break;
    case 'e':
    case 'E':
      openSheet();
      break;
    case 'Escape':
      if (sheet.classList.contains('is-open')) openSheet(false);
      else if (ed.selKey) ed.select(ed.sel);
      else ed.select(null);
      break;
    default: {
      const n = Number(k);
      const d = ed.device(ed.sel);
      if (d && n >= 1 && n <= POSES.length) {
        ed.change(() => writeState(d, ed.time, { rot: [...POSES[n - 1].rot] }), { commit: true });
      }
    }
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key !== ' ') return;
  const tag = (e.target as HTMLElement).tagName;
  view.space = false;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (!spaceUsed) togglePlay();
});

/* ---------- fonts used by text layers ---------- */

const fontSeen = new Set<string>();
function ensureFonts() {
  for (const t of ed.doc.texts) {
    const f = `${t.weight} 40px "${t.font}"`;
    // the text itself picks the unicode-range subsets (Cyrillic, Latin) to fetch
    const sig = f + '|' + t.text;
    if (fontSeen.has(sig)) continue;
    fontSeen.add(sig);
    if (!document.fonts.check(f, t.text))
      void document.fonts.load(f, t.text).then(() => {
        studio.invalidateLayers();
        dirty = true;
      });
  }
}

/* ---------- start ---------- */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
initComponents(document);
refreshRim();
view.fit();
inspector.render(true);
timeline.render();
renderLayers();
updateUndo();
ensureFonts();
void prune(mediaIds(ed.doc));
lastFormat = `${ed.doc.format.w}x${ed.doc.format.h}x${ed.doc.format.fps}x${ed.doc.format.duration}`;
formatSeg.set(FORMATS.find((f) => f.w === ed.doc.format.w && f.h === ed.doc.format.h)?.id ?? '', { silent: true });
// for tests and the console
Object.assign(window, {
  reel: {
    ed,
    studio,
    /** synchronous render, for tests on slow software GL where frames are rare */
    renderNow: () => {
      studio.render(ed.doc, ed.time);
      view.drawOverlay();
    },
  },
});
