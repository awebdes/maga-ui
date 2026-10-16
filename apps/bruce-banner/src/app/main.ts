import '../ui/kit/tokens.css';
import '../ui/kit/components.css';
import '../ui/kit/stage.css';
import '../ui/kit/coach.css';
import './styles.css';
import { ASSETS, LANGS, addLayer, docFromTemplate, duplicateLayer, findLayer, newId, removeLayer, replaceArt, setAsset, type BannerDoc, type Lang, type Layer } from '../engine';
import { opaqueBox } from '../render/alpha';
import { contrastIssues } from '../render/contrast';
import { drawBanner, renderToBlob } from '../render/draw';
import { brandFontsAvailable, loadBrandFonts } from '../render/fonts';
import { brandImagesAvailable, loadImage, onImageLoad, preloadDoc } from '../render/images';
import { resetMeasure } from '../render/measure';
import { $, configureKit, initTips, kit, pop, refreshRim, store, toast, wake } from '../ui/kit/core';
import { initComponents } from '../ui/kit/components';
import { Coach } from '../ui/kit/coach';
import { Preview } from '../preview/preview';
import { accessCode, ai, resetCatalog } from './ai-client';
import { AccessCode, ArtGenerator, TextTools, Variants, type AiState } from './ai-flows';
import { download, slug } from './dom';
import { Dock } from './dock';
import { ExportSheet } from './export';
import { Home } from './home';
import { Inspector } from './inspector';
import { Layers } from './layers';
import { LayoutPicker } from './layouts';
import { Manipulator } from './manipulate';
import { Stage } from './stage';
import { Editor } from './state';
import { deleteProject, exportBannerFile, importBannerFile, listArt, listProjects, loadProject, putImage, requestPersistence, saveProject, saveThumb, storageAvailable, type ArtMeta } from './storage';
import { TextPop } from './text-pop';

/* ---------- kit ---------- */

configureKit({ prefix: 'bb:', tipId: 'bb-tip' });
const app = $('#app')!;
kit.app = app;
kit.settings.focus = store.get('focus', false);
if (store.get('reduceMotion', false)) document.documentElement.classList.add('reduce-motion');

/* ---------- editor ---------- */

const editor = new Editor();
editor.pixelChecks = contrastIssues;
const stageEl = $('#stage')!;
const stage = new Stage(editor, stageEl, $('#banners')!, $<SVGSVGElement>('#overlay')!, $<HTMLCanvasElement>('#ghost')!);
const textPop = new TextPop(editor, stage);
const manip = new Manipulator(editor, stage, stageEl, {
  onDoubleClick: (id) => textPop.open(id),
  onSelectLang: (lang) => editor.setLang(lang),
});
const access = new AccessCode();
const textTools = new TextTools(editor, access);
const artGen = new ArtGenerator(editor, access);
const layouts = new LayoutPicker(editor);
const inspector = new Inspector(editor, $('#inspector')!, {
  openLayouts: (anchor) => layouts.toggle(anchor),
  uploadImage: (id, file) => void placeImage(file, id),
  useArt: (id, art) => useArt(id, art),
  listArt: () => listArt(),
  generateImage: (id, anchor) => artGen.open(id, anchor),
  aiText: (op, layer, anchor) => void textTools.run(op, layer, anchor),
  aiEnabled: () => aiOn(),
});
const layers = new Layers(editor, $('#layers')!);
const dock = new Dock(editor, $('#chrome')!, {
  translateAll: () => void textTools.translateAll($('#translate-all')!),
  aiEnabled: () => aiOn(),
});
const exportSheet = new ExportSheet(editor, $('#export-sheet')!, $('#export-btn')!);
const preview = new Preview(editor, $('#preview')!, {
  close: () => closePreview(),
  sourceRect: () => {
    const p = stage.active;
    return p ? new DOMRect(p.x, p.y, p.w, p.h) : null;
  },
});

/* ---------- AI status ---------- */

let aiState: AiState = 'loading';
let aiModel = '';
const aiOn = () => aiState === 'live' || aiState === 'mock';

async function fetchStatus() {
  try {
    const s = await ai.status();
    aiState = s.mock ? 'mock' : 'live';
    aiModel = s.textModel;
    if (s.needsCode && !accessCode.get()) aiModel = 'нужен код команды';
  } catch {
    aiState = 'off';
  }
  renderAi();
}

function renderAi() {
  const chip = $('#ai-chip')!;
  chip.dataset.state = aiState;
  chip.textContent = aiState === 'mock' ? 'AI · демо' : aiState === 'off' ? 'AI выкл' : 'AI';
  chip.dataset.tip =
    aiState === 'live' ? `AI подключён · ${aiModel}` : aiState === 'mock' ? 'Демо-режим: ключ Gemini не подключён, AI отвечает заготовками' : aiState === 'off' ? 'AI недоступен: работают шаблоны и ручная правка' : 'Проверяем AI…';
  home.renderAi();
  inspector.render(true);
  dock.render();
}

/* ---------- start, variants ---------- */

const home = new Home($('#home')!, {
  brief: (text) => void variants.run(text),
  openTemplate: (id) => void openDoc(docFromTemplate(id)),
  openProject: (id) => void openProject(id),
  duplicateProject: (id) => void duplicateProject(id),
  deleteProject: (id) => void removeProject(id),
  exportProject: (id) => void exportProject(id),
  importFile: (file) => void importFile(file),
  aiState: () => aiState,
});
const variants = new Variants(editor, $('#variants')!, {
  openDoc: (doc, opts) => void openDoc(doc, { save: true, suggestArt: opts?.suggestArt }),
  backHome: () => void goHome(),
}, access);

/* ---------- saving ---------- */

const saveDot = $('#status')!;
const saveText = $('#save-text')!;
let saveTimer = 0;
let lastSaved = '';
let persistAsked = false;
let saving: Promise<void> = Promise.resolve();

function setSaveState(state: 'saved' | 'pending' | 'error') {
  saveDot.dataset.save = state;
  saveText.textContent = state === 'saved' ? 'Сохранено' : state === 'pending' ? 'Сохраняем…' : 'Не сохраняется';
  if (state === 'error') saveText.parentElement!.dataset.tip = 'Хранилище браузера недоступно (приватное окно?). Скачайте файл баннера в «Экспорт».';
  else delete saveText.parentElement!.dataset.tip;
}

function scheduleSave(delay = 500) {
  if (!editor.doc) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void flushSave(), delay);
}

/** Saves the open banner if it changed since the last save; thumbnails follow when the browser is idle. */
function flushSave(): Promise<void> {
  clearTimeout(saveTimer);
  saving = saving.then(async () => {
    const doc = editor.doc;
    if (!doc) return;
    const json = JSON.stringify(doc);
    if (json === lastSaved) return;
    setSaveState('pending');
    const ok = await saveProject(doc);
    if (!ok) {
      setSaveState('error');
      return;
    }
    lastSaved = json;
    if (editor.doc?.id === doc.id) {
      setSaveState(JSON.stringify(editor.doc) === json ? 'saved' : 'pending');
      if (location.hash === UNSAVED) history.replaceState(null, '', route(doc.id));
    }
    if (!persistAsked) {
      persistAsked = true;
      void requestPersistence();
    }
    queueThumb(doc);
  });
  return saving;
}

let thumbFor: BannerDoc | null = null;
function queueThumb(doc: BannerDoc) {
  const first = !thumbFor;
  thumbFor = doc;
  if (!first) return;
  const run = async () => {
    const d = thumbFor;
    thumbFor = null;
    if (!d) return;
    try {
      await saveThumb(d.id, await renderToBlob(d, d.languages.primary, 2));
    } catch {
      /* a missing thumbnail shows an empty card */
    }
  };
  if ('requestIdleCallback' in window) requestIdleCallback(() => void run(), { timeout: 2000 });
  else setTimeout(() => void run(), 300);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void flushSave();
});

/* ---------- open, route, leave ---------- */

const route = (id?: string) => (id ? `#/b/${id}` : '#/');
/** a banner not saved yet (a template nobody touched) has no address to come back to */
const UNSAVED = '#/new';

async function openDoc(doc: BannerDoc, opts: { save?: boolean; saved?: boolean; suggestArt?: string; replaceHash?: boolean } = {}) {
  await flushSave();
  pop.closeAll();
  void preloadDoc(doc);
  lastSaved = opts.save ? '' : JSON.stringify(doc);
  editor.open(doc);
  editor.setMode('editor');
  const hash = opts.save || opts.saved ? route(doc.id) : UNSAVED;
  if (location.hash !== hash) history[opts.replaceHash ? 'replaceState' : 'pushState'](null, '', hash);
  setSaveState('saved');
  if (opts.save) void flushSave();
  if (opts.suggestArt && aiOn()) suggestArt(opts.suggestArt);
  else maybeTour();
}

/** After an AI variant: the art layer is selected and the drawing panel opens with what to draw. */
function suggestArt(subject: string) {
  const art = editor.doc?.layers.find((l) => l.kind === 'image' || l.kind === 'imageClip');
  if (!art) return;
  editor.select(art.id);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const anchor = $('#inspector [data-gen]');
    if (anchor) artGen.open(art.id, anchor, subject);
  }));
}

async function openProject(id: string, replaceHash = false) {
  if (editor.doc?.id === id && editor.mode !== 'home') return;
  const doc = await loadProject(id);
  if (!doc) {
    toast('Баннер не найден', 'в этом браузере его нет', 'error');
    history.replaceState(null, '', route());
    await goHome(false);
    return;
  }
  await openDoc(doc, { replaceHash, saved: true });
}

async function goHome(push = true) {
  textPop.close();
  artGen.close();
  pop.closeAll();
  if (editor.mode === 'preview') preview.close();
  await flushSave();
  editor.close();
  editor.setMode('home');
  if (push && location.hash !== route()) history.pushState(null, '', route());
  home.renderTemplates();
  void home.renderProjects();
  document.title = 'Bruce Banner';
}

// template cards drawn before their pictures arrived get redrawn once they do
let homeRedraw = 0;
onImageLoad(() => {
  if (editor.mode !== 'home' || homeRedraw) return;
  homeRedraw = window.setTimeout(() => {
    homeRedraw = 0;
    home.renderTemplates();
  }, 120);
});
ASSETS.forEach((a) => void loadImage(a.id));

async function routeFromHash() {
  const m = location.hash.match(/^#\/b\/([\w-]+)$/);
  if (m) await openProject(m[1], true);
  else if (location.hash === UNSAVED && editor.doc) return;
  else if (editor.mode !== 'home' && editor.mode !== 'variants') await goHome(false);
  else if (location.hash === UNSAVED) history.replaceState(null, '', route());
}
window.addEventListener('popstate', () => void routeFromHash());

/* ---------- projects ---------- */

async function duplicateProject(id: string) {
  const doc = await loadProject(id);
  if (!doc) return;
  const now = Date.now();
  await saveProject({ ...structuredClone(doc), id: newId('bn'), name: `${doc.name} (копия)`, createdAt: now, updatedAt: now });
  await home.renderProjects();
  toast('Копия готова', doc.name);
}

async function removeProject(id: string) {
  const meta = (await listProjects()).find((m) => m.id === id);
  await deleteProject(id);
  await home.renderProjects();
  toast('Баннер удалён', meta?.name ?? '');
}

async function exportProject(id: string) {
  const doc = await loadProject(id);
  if (doc) download(await exportBannerFile(doc), `${slug(doc.name)}.banner.json`);
}

async function importFile(file: File) {
  try {
    const doc = await importBannerFile(file, () => newId('bn'));
    await openDoc(doc, { save: true });
    toast('Баннер открыт', doc.name);
  } catch (e) {
    toast('Не получилось открыть файл', (e as Error).message, 'error');
  }
}

/* ---------- images: upload and drop ---------- */

const IMAGE_TYPES = /^image\/(png|jpeg|webp)$/;
const MAX_IMAGE = 10 * 1024 * 1024;

/** Puts a picked or dropped picture on the banner: into the selected illustration, or as a new one. */
async function placeImage(file: File, targetId: string | null) {
  if (!IMAGE_TYPES.test(file.type)) {
    toast('Нужна картинка', 'PNG, JPG или WebP', 'error');
    return;
  }
  if (file.size > MAX_IMAGE) {
    toast('Картинка больше 10 МБ', 'уменьшите её и попробуйте снова', 'error');
    return;
  }
  let w = 0;
  let h = 0;
  try {
    const bmp = await createImageBitmap(file);
    w = bmp.width;
    h = bmp.height;
    bmp.close();
  } catch {
    toast('Не получилось открыть картинку', file.name, 'error');
    return;
  }
  const ref = await putImage(file, { w, h, source: 'upload' });
  const doc = editor.doc;
  if (!doc) return;
  const target = targetId ? findLayer(doc, targetId) : null;
  let id = target && (target.kind === 'image' || target.kind === 'imageClip') ? target.id : '';
  // a replacement takes the place the old picture visibly filled
  const visible = target?.kind === 'image' ? opaqueBox(target.src) : undefined;
  editor.change((d) => {
    if (!id) {
      // a new picture: right side of the slot, inside its height
      const l = addLayer(d, 'image', { src: ref, cx: 258, cy: 53 });
      if (l.kind === 'image') {
        l.w = Math.min(112, (96 * w) / h);
        l.h = (l.w * h) / w;
      }
      id = l.id;
      return;
    }
    const l = findLayer(d, id);
    if (l?.kind === 'image') replaceArt(d, id, ref, w / h, visible);
    else if (l?.kind === 'imageClip') {
      setAsset(d, id, ref);
      l.img.height = (l.img.width * h) / w;
    }
  });
  editor.select(id);
  toast('Картинка на баннере', 'хранится в этом браузере');
}

/** A picture from «Мои картинки» into an illustration, fitted like a new one. */
function useArt(layerId: string, art: ArtMeta) {
  const target = editor.doc && findLayer(editor.doc, layerId);
  if (!target) return;
  const visible = target.kind === 'image' ? opaqueBox(target.src) : undefined;
  editor.change((d) => {
    const l = findLayer(d, layerId);
    if (l?.kind === 'image') replaceArt(d, layerId, art.ref, art.w / art.h, visible);
    else if (l?.kind === 'imageClip') {
      setAsset(d, layerId, art.ref);
      l.img.height = (l.img.width * art.h) / art.w;
    }
  });
}

let dragDepth = 0;
const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e) || (editor.mode !== 'editor' && editor.mode !== 'home')) return;
  dragDepth++;
  if (editor.mode === 'editor') app.classList.add('is-dropping');
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) app.classList.remove('is-dropping');
});
window.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  dragDepth = 0;
  app.classList.remove('is-dropping');
  if (!hasFiles(e) || e.defaultPrevented) return;
  e.preventDefault();
  const file = e.dataTransfer!.files[0];
  if (!file) return;
  if (editor.mode === 'editor') void placeImage(file, editor.selection);
  else if (editor.mode === 'home' && /\.json$/i.test(file.name)) void importFile(file);
});

/* ---------- chrome ---------- */

const undoBtn = $('#undo-btn')!;
const redoBtn = $('#redo-btn')!;
undoBtn.addEventListener('click', () => editor.undo());
redoBtn.addEventListener('click', () => editor.redo());
$('#home-btn')!.addEventListener('click', () => void goHome());
$('#narrow-home')!.addEventListener('click', () => void goHome());
$('#preview-btn')!.addEventListener('click', () => openPreview());

function syncChrome() {
  const doc = editor.doc;
  $('#doc-name')!.textContent = doc?.name ?? '';
  if (doc) document.title = `${doc.name} — Bruce Banner`;
  undoBtn.toggleAttribute('disabled', !editor.history.canUndo);
  redoBtn.toggleAttribute('disabled', !editor.history.canRedo);
}

$('#add-menu')!.addEventListener('click', (e) => {
  const item = (e.target as Element).closest<HTMLElement>('[data-add]');
  if (!item) return;
  pop.closeAll();
  const kind = item.dataset.add as 'text' | 'badge' | 'image' | 'glow' | 'stat';
  let id = '';
  editor.change((d) => (id = addLayer(d, kind).id));
  editor.select(id);
  if (kind === 'text' || kind === 'badge') requestAnimationFrame(() => textPop.open(id));
});

function toggleChrome() {
  app.classList.toggle('chrome-hidden');
  if (app.classList.contains('chrome-hidden')) toast('Панели скрыты', 'H — вернуть');
}

const swFocus = $('#sw-focus')!;
swFocus.setAttribute('aria-checked', String(kit.settings.focus));
swFocus.addEventListener('change', (e) => {
  kit.settings.focus = (e as CustomEvent<{ value: boolean }>).detail.value;
  store.set('focus', kit.settings.focus);
  wake();
});
const swMask = $('#sw-mask')!;
const slotMask = store.get('slotMask', true);
app.classList.toggle('slot-mask', slotMask);
swMask.setAttribute('aria-checked', String(slotMask));
swMask.addEventListener('change', (e) => {
  const on = (e as CustomEvent<{ value: boolean }>).detail.value;
  app.classList.toggle('slot-mask', on);
  store.set('slotMask', on);
});
const swMotion = $('#sw-motion')!;
swMotion.setAttribute('aria-checked', String(document.documentElement.classList.contains('reduce-motion')));
swMotion.addEventListener('change', (e) => {
  const on = (e as CustomEvent<{ value: boolean }>).detail.value;
  document.documentElement.classList.toggle('reduce-motion', on);
  store.set('reduceMotion', on);
});
$('#settings-menu [data-action="code"]')!.addEventListener('click', () => {
  pop.closeAll();
  void access.ask().then((saved) => saved && void fetchStatus());
});
$('#settings-menu [data-action="hide"]')!.addEventListener('click', () => {
  pop.closeAll();
  toggleChrome();
});

/* ---------- preview ---------- */

function openPreview() {
  if (!editor.doc || editor.mode !== 'editor') return;
  textPop.close();
  pop.closeAll();
  editor.setMode('preview');
  preview.open();
}

function closePreview() {
  if (editor.mode !== 'preview') return;
  editor.setMode('editor');
  $('#preview-btn')!.focus();
}

/* ---------- first-run tour ---------- */

const rectOf = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
const coach = new Coach(
  [
    {
      target: () => {
        const p = stage.active;
        return p ? new DOMRect(p.x, p.y, p.w, p.h) : null;
      },
      title: 'Это ваш баннер',
      text: 'Кликните по тексту или картинке, чтобы изменить. Двойной клик по тексту — поля сразу на трёх языках. Тащите, чтобы подвинуть.',
    },
    {
      target: () => rectOf('#dock'),
      title: 'Три языка',
      text: 'RU · UZ · EN переключают баннер. Точка у языка: зелёная — всё влезает, жёлтая — стоит посмотреть, красная — текст не влезает.',
    },
    {
      target: () => rectOf('#inspector'),
      title: 'Свойства',
      text: 'Ничего не выбрано — тема, раскладка и языки. У текста — ✨ Короче, Иначе, Перевести. У иллюстрации — библиотека, своя картинка или ✨ Нарисовать.',
    },
    {
      target: () => rectOf('#preview-btn'),
      title: 'Как в приложении',
      text: 'Превью показывает баннер на главной Ipoteka в телефоне, на любом из трёх языков. Клавиша P.',
    },
    {
      target: () => rectOf('#export-btn'),
      title: 'Скачать',
      text: 'ZIP со всеми языками в размерах @1x, @2x, @3x и файл с текстами для CMS. Баннер сохраняется сам — он появится в «Моих баннерах».',
    },
  ],
  { label: 'Как пользоваться', done: 'Понятно', onStop: () => store.set('toured', true) },
);
$('#settings-menu [data-action="tour"]')!.addEventListener('click', () => {
  pop.closeAll();
  if (editor.mode === 'editor') coach.start();
});
function maybeTour() {
  if (store.get('toured', false) || coach.isOn || navigator.webdriver) return;
  setTimeout(() => editor.mode === 'editor' && !coach.isOn && coach.start(), 900);
}

/* ---------- one render loop for every change ---------- */

editor.subscribe((e) => {
  app.dataset.mode = editor.mode;
  stage.invalidate();
  if (editor.doc) {
    inspector.render();
    layers.render();
    dock.render();
    textPop.sync();
    if (e.view) textPop.place();
    if (exportSheet.isOpen && e.doc && !e.live) exportSheet.render();
    if (editor.mode === 'preview') preview.sync(e);
  } else {
    inspector.render();
    layers.render();
  }
  syncChrome();
  if (e.view || e.replaced) coach.place();
  if (e.doc && !e.replaced && editor.doc) scheduleSave();
});

/* ---------- keyboard (by physical key: shortcuts work on the Russian layout too) ---------- */

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
/** controls that use the arrow keys themselves */
const ownsArrows = (t: HTMLElement) => !!t.closest('.seg, .fs, .menu, .layers-list, [role="slider"], [role="radiogroup"]');
const LANG_KEYS: Record<string, Lang> = { Digit1: 'ru', Digit2: 'uz', Digit3: 'en' };

function selectedLayer(): Layer | null {
  return editor.doc && editor.selection ? (findLayer(editor.doc, editor.selection) ?? null) : null;
}

window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.isComposing) return;
  const t = e.target as HTMLElement;
  if (t.matches('input, textarea, [contenteditable]')) return;
  if (editor.mode === 'preview') {
    if (preview.key(e)) e.preventDefault();
    return;
  }
  if (editor.mode !== 'editor') return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod) {
    if (e.code === 'KeyZ') {
      if (e.shiftKey) editor.redo();
      else editor.undo();
    } else if (e.code === 'KeyY') editor.redo();
    else if (e.code === 'KeyD') duplicateSelection();
    else if (e.code === 'KeyS') {
      void flushSave();
      toast('Сохранено', 'в этом браузере');
    } else return;
    e.preventDefault();
    return;
  }
  if (e.altKey) return;
  const arrow = ARROWS[e.code];
  if (arrow) {
    if (ownsArrows(t) || !editor.selection) return;
    const step = e.shiftKey ? 10 : 1;
    manip.nudge(arrow[0] * step, arrow[1] * step);
    e.preventDefault();
    return;
  }
  const lang = LANG_KEYS[e.code];
  if (lang) {
    if (editor.doc?.languages.enabled.includes(lang)) editor.setLang(lang);
  } else if (e.code === 'Escape') {
    if (!manip.cancel()) editor.select(null);
  } else if (e.code === 'Delete' || e.code === 'Backspace') {
    const id = editor.selection;
    if (id) editor.change((d) => removeLayer(d, id));
  } else if (e.code === 'Enter') {
    const l = selectedLayer();
    if (l && (l.kind === 'text' || l.kind === 'badge' || l.kind === 'badgeRow' || l.kind === 'stat')) textPop.open(l.id);
    else return;
  } else if (e.code === 'BracketLeft' || e.code === 'BracketRight') manip.rotateBy((e.code === 'BracketLeft' ? -1 : 1) * (e.shiftKey ? 15 : 1));
  else if (e.code === 'KeyP') openPreview();
  else if (e.code === 'KeyE') exportSheet.toggle();
  else if (e.code === 'KeyL') {
    if ((editor.doc?.languages.enabled.length ?? 0) > 1) editor.setAllLangs(!editor.allLangs);
  } else if (e.code === 'KeyH') toggleChrome();
  else return;
  e.preventDefault();
});

function duplicateSelection() {
  const id = editor.selection;
  if (!id) return;
  let copy = '';
  editor.change((d) => (copy = duplicateLayer(d, id)?.id ?? ''));
  if (copy) editor.select(copy);
}

/* ---------- boot ---------- */

initComponents(document);
initTips();
refreshRim();
setSaveState('saved');
home.renderTemplates();
void home.renderProjects();
renderAi();
void fetchStatus();
if (!storageAvailable()) setSaveState('error');
if (!brandFontsAvailable() || !brandImagesAvailable()) toast('Нет брендовых файлов', 'запустите npm run vendor', 'error');

const fontsReady = loadBrandFonts().then(({ missing }) => {
  resetMeasure();
  resetCatalog();
  editor.invalidateLayout();
  home.renderTemplates();
  if (missing.length) console.warn('fonts missing', missing);
});
await Promise.race([fontsReady, new Promise((r) => setTimeout(r, 2500))]);
await routeFromHash();
app.dataset.mode = editor.mode;
app.classList.add('is-ready');
wake();

/** Automation hooks for the e2e. */
Object.assign(window, {
  __bb: {
    ready: true,
    editor,
    stage,
    langs: LANGS,
    fontsReady,
    flushSave,
    aiState: () => aiState,
    open: (doc: BannerDoc) => openDoc(doc),
    /** the open banner drawn the way the editor draws it, at `cssW` px and dpr 1 */
    renderCanvas(lang: Lang, cssW: number) {
      const c = document.createElement('canvas');
      if (editor.doc) drawBanner(c, editor.doc, lang, cssW, { dpr: 1 });
      return c;
    },
    openTemplate: (id: string) => openDoc(docFromTemplate(id)),
    /** client rect of a layer's frame on the active banner */
    frameRect(id: string) {
      const p = stage.active;
      const f = stage.frameOf(id, p?.lang);
      if (!p || !f) return null;
      const [x, y] = stage.toScreen(p, f.cx, f.cy);
      return { cx: x, cy: y, w: f.w * p.zoom, h: f.h * p.zoom, rot: f.rot };
    },
  },
});
