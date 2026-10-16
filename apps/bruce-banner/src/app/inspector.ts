/**
 * The right island: what can be changed about the selection, in the words of the person using it.
 * Nothing selected → the banner (theme, layout, languages, name). A text → its copy in every
 * language, size, colour. An illustration → the library, upload, AI, size, angle. Rebuilt on
 * selection change, synced in place on edits so focus and slider drags survive.
 */
import {
  ASSETS,
  LANG_LABEL,
  LANGS,
  THEMES,
  backgroundCss,
  findLayer,
  layerNames,
  removeLayer,
  reorderLayer,
  duplicateLayer,
  setAsset,
  setColor,
  setFlip,
  setLanguageEnabled,
  setPrimaryLanguage,
  setRotation,
  setTheme,
  setTypeSize,
  setWidth,
  themeById,
  type AssetKind,
  type Layer,
  type Lang,
} from '../engine';
import { assetUrl } from '../render/images';
import { initFs } from '../ui/kit/components';
import { initDrop } from '../ui/kit/prompt';
import { CopyFields, type SlotSpec } from './copy-fields';
import { h, icon } from './dom';
import type { Editor } from './state';

export interface InspectorHooks {
  openLayouts(anchor: HTMLElement): void;
  uploadImage(layerId: string, file: File): void;
  generateImage(layerId: string, anchor: HTMLElement): void;
  aiText(op: 'shorter' | 'rephrase' | 'translate', layer: Layer, anchor: HTMLElement): void;
  aiEnabled(): boolean;
}

export function slotsOf(l: Layer): SlotSpec[] {
  switch (l.kind) {
    case 'text':
      return [
        { key: l.contentKey, multiline: true, layerId: l.id, label: l.sub ? 'Заголовок' : undefined },
        ...(l.sub ? [{ key: l.sub.contentKey, multiline: false, layerId: l.id, label: 'Подпись' }] : []),
      ];
    case 'badge':
      return [{ key: l.contentKey, multiline: false }];
    case 'badgeRow':
      return l.items.map((it, i) => ({ key: it.contentKey, multiline: false, label: `Бейдж ${i + 1}` }));
    case 'stat':
      return [
        { key: l.contentKey, multiline: false, label: 'Цифра' },
        { key: l.unitContentKey, multiline: false, label: 'Единица' },
      ];
    default:
      return [];
  }
}

const PICK: Partial<Record<Layer['kind'], AssetKind>> = { image: 'illustration', imageClip: 'illustration', card: 'card', pill: 'logo' };

export class Inspector {
  private body: HTMLElement;
  private title: HTMLElement;
  private syncs: (() => void)[] = [];
  private builtFor = '';

  constructor(
    private editor: Editor,
    root: HTMLElement,
    private hooks: InspectorHooks,
  ) {
    this.title = root.querySelector('.panel-title span')!;
    this.body = root.querySelector('.panel-body')!;
  }

  /** Rebuilds when the selection (or the document) changed identity, else syncs values. */
  render(force = false) {
    const doc = this.editor.doc;
    const sel = doc && this.editor.selection ? findLayer(doc, this.editor.selection) : null;
    const key = `${doc?.id}:${sel?.id ?? '-'}:${sel?.kind ?? ''}:${doc?.languages.enabled.join('')}`;
    if (!force && key === this.builtFor) {
      this.syncs.forEach((fn) => fn());
      return;
    }
    this.builtFor = key;
    this.syncs = [];
    this.body.replaceChildren();
    if (!doc) return;
    if (!sel) this.buildBanner();
    else this.buildLayer(sel);
    this.syncs.forEach((fn) => fn());
  }

  /* ---------- banner ---------- */

  private buildBanner() {
    const doc = this.editor.doc!;
    this.title.textContent = 'Баннер';
    const themes = h('div', { class: 'theme-grid', role: 'radiogroup', 'aria-label': 'Тема' });
    for (const t of THEMES) {
      const b = h('button', { class: 'theme-swatch', role: 'radio', 'aria-label': t.label, 'data-tip': t.label, 'data-theme': t.id }, h('span', { class: 'theme-chip', style: `background:${backgroundCss(t.background)}` }, h('span', { class: 'theme-dot', style: `background:${t.text}` })));
      b.addEventListener('click', () => this.editor.change((d) => setTheme(d, t.id)));
      themes.append(b);
    }
    this.syncs.push(() => {
      for (const b of themes.querySelectorAll<HTMLElement>('.theme-swatch')) b.setAttribute('aria-checked', String(b.dataset.theme === this.editor.doc?.theme));
    });

    const layoutBtn = h('button', { class: 'cell ghost wide' }, icon('i-layout'), h('span', { text: 'Сменить раскладку' }));
    layoutBtn.addEventListener('click', () => this.hooks.openLayouts(layoutBtn));

    const langs = h('div', { class: 'lang-table' });
    for (const lang of LANGS) {
      const sw = h('span', { class: 'switch', role: 'switch', tabindex: 0, 'aria-label': `${LANG_LABEL[lang]} включён` });
      const primary = h('button', { class: 'tag sm', 'aria-pressed': 'false', text: 'основной' });
      const row = h('div', { class: 'lang-row', 'data-lang': lang }, h('span', { class: 'mono lang-code', text: LANG_LABEL[lang] }), h('span', { class: 'lang-name', text: LANG_NAME[lang] }), primary, sw);
      const toggle = () => this.editor.change((d) => setLanguageEnabled(d, lang, !d.languages.enabled.includes(lang)));
      sw.addEventListener('click', toggle);
      sw.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
      primary.addEventListener('click', () => this.editor.change((d) => setPrimaryLanguage(d, lang)));
      langs.append(row);
      this.syncs.push(() => {
        const d = this.editor.doc!;
        const on = d.languages.enabled.includes(lang);
        sw.setAttribute('aria-checked', String(on));
        primary.setAttribute('aria-pressed', String(d.languages.primary === lang));
        primary.hidden = !on;
        row.classList.toggle('is-off', !on);
      });
    }

    const name = h('input', { class: 'field', type: 'text', value: doc.name, 'aria-label': 'Название баннера', maxlength: 80 });
    name.addEventListener('change', () => this.editor.change((d) => (d.name = name.value.trim() || 'Без названия')));
    this.syncs.push(() => {
      if (document.activeElement !== name) name.value = this.editor.doc!.name;
    });

    this.body.append(
      section('Тема', themes),
      section('Раскладка', layoutBtn, h('p', { class: 'hint', text: 'Тексты сохранятся, поменяются места и иллюстрации.' })),
      section('Языки', langs),
      section('Название', name),
      h('p', { class: 'hint center', text: 'Кликните по тексту или картинке на баннере, чтобы изменить. Двойной клик — сразу к тексту.' }),
    );
  }

  /* ---------- a layer ---------- */

  private buildLayer(l: Layer) {
    this.title.textContent = layerNames(this.editor.doc!).get(l.id) ?? '';
    const parts: HTMLElement[] = [];
    const slots = slotsOf(l);
    if (slots.length) {
      const fields = new CopyFields(this.editor, slots);
      this.syncs.push(() => fields.sync());
      const ai = this.hooks.aiEnabled() && l.kind !== 'stat';
      const tools = h('div', { class: 'ai-tools' });
      tools.append(
        aiBtn('Короче', () => this.hooks.aiText('shorter', l, tools)),
        aiBtn('Иначе', () => this.hooks.aiText('rephrase', l, tools)),
        aiBtn('Перевести', () => this.hooks.aiText('translate', l, tools), 'С основного языка на остальные'),
      );
      parts.push(section('Текст', fields.el, ai ? tools : null));
    }

    const pickKind = PICK[l.kind];
    if (pickKind) parts.push(this.assetPicker(l, pickKind));

    if (l.kind === 'text' || l.kind === 'badge' || l.kind === 'badgeRow' || l.kind === 'stat') {
      const [min, max] = l.kind === 'stat' ? [24, 72] : l.kind === 'text' ? [11, 28] : [10, 22];
      parts.push(section('Размер', this.slider(l.id, 'Кегль', min, max, 1, 'int', (x) => sizeOf(x), (d, v) => setTypeSize(d, l.id, v))));
    }
    if (l.kind === 'image' || l.kind === 'card') {
      parts.push(section('Размер', this.slider(l.id, 'Ширина', 30, 420, 1, 'int', (x) => ('w' in x ? x.w : 0), (d, v) => setWidth(d, l.id, v))));
    }
    if (l.kind === 'glow') {
      parts.push(section('Размер', this.slider(l.id, 'Радиус', 30, 320, 1, 'int', (x) => (x.kind === 'glow' ? x.r : 0), (d, v) => setWidth(d, l.id, v * 2))));
    }
    if (l.kind === 'image' || l.kind === 'card' || l.kind === 'badge' || l.kind === 'stat') {
      const rot = this.slider(l.id, 'Наклон', -45, 45, 0.5, 'deg', (x) => ('rot' in x ? x.rot : 0), (d, v) => setRotation(d, l.id, v), 0);
      rot.classList.add('bipolar');
      const row = h('div', { class: 'row' }, rot);
      if (l.kind === 'image') {
        const flip = h('button', { class: 'cell icon-btn ghost', 'aria-pressed': String(!!l.flip), 'aria-label': 'Отразить', 'data-tip': 'Отразить' }, icon('i-flip'));
        flip.addEventListener('click', () => this.editor.change((d) => setFlip(d, l.id, !(findLayer(d, l.id) as { flip?: boolean }).flip)));
        this.syncs.push(() => flip.setAttribute('aria-pressed', String(!!(this.layer(l.id) as { flip?: boolean } | null)?.flip)));
        row.append(flip);
      }
      parts.push(section('Поворот', row));
    }
    const colors = this.colorRow(l);
    if (colors) parts.push(colors);
    parts.push(this.layerActions(l));
    this.body.append(...parts);
  }

  private layer(id: string) {
    return this.editor.doc ? findLayer(this.editor.doc, id) : null;
  }

  /** A kit fill slider bound to one number of a layer: drag = one undo step. */
  private slider(id: string, label: string, min: number, max: number, step: number, format: string, read: (l: Layer) => number, write: (d: NonNullable<Editor['doc']>, v: number) => void, def?: number) {
    const cur = this.layer(id);
    const value = cur ? read(cur) : min;
    const el = h('div', { class: 'fs split', 'data-label': label, 'data-min': min, 'data-max': max, 'data-step': step, 'data-value': value, 'data-default': def ?? value, 'data-format': format });
    const api = initFs(el);
    let dragging = false;
    el.addEventListener('input', (e) => {
      dragging = true;
      const v = (e as CustomEvent<{ value: number }>).detail.value;
      this.editor.live((d) => write(d, v), { fromStart: true });
    });
    el.addEventListener('change', () => {
      dragging = false;
      this.editor.end();
    });
    this.syncs.push(() => {
      const l = this.layer(id);
      if (l && !dragging) api.set(Math.max(min, Math.min(max, read(l))), { silent: true });
    });
    return el;
  }

  private assetPicker(l: Layer, kind: AssetKind) {
    const grid = h('div', { class: `asset-grid kind-${kind}`, role: 'radiogroup', 'aria-label': 'Иллюстрация' });
    for (const a of ASSETS.filter((x) => x.kind === kind)) {
      const url = assetUrl(a.id);
      const b = h('button', { class: 'asset', role: 'radio', 'data-ref': a.id, 'aria-label': a.label, 'data-tip': a.label }, url ? h('img', { src: url, alt: '', loading: 'lazy', draggable: 'false' }) : h('span', { class: 'asset-missing', text: a.label }));
      b.addEventListener('click', () => this.editor.change((d) => setAsset(d, l.id, a.id)));
      grid.append(b);
    }
    const custom = h('div', { class: 'asset-custom' });
    grid.append(custom);
    this.syncs.push(() => {
      const cur = this.layer(l.id);
      const ref = cur ? ('src' in cur ? cur.src : cur.kind === 'pill' ? cur.icon : '') : '';
      for (const b of grid.querySelectorAll<HTMLElement>('.asset')) b.setAttribute('aria-checked', String(b.dataset.ref === ref));
      custom.replaceChildren();
      if (ref.startsWith('blob:')) {
        const url = assetUrl(ref);
        custom.append(h('div', { class: 'asset is-own', 'aria-checked': 'true', 'data-tip': 'Ваша картинка' }, url ? h('img', { src: url, alt: 'Ваша картинка' }) : null));
      }
    });
    const tools = h('div', { class: 'asset-tools' });
    if (kind === 'illustration') {
      const drop = h('button', { class: 'cell ghost drop', 'aria-label': 'Загрузить картинку' }, icon('i-upload'), h('span', { text: 'Своя' }));
      initDrop(drop);
      drop.addEventListener('file', (e) => this.hooks.uploadImage(l.id, (e as CustomEvent<{ file: File }>).detail.file));
      tools.append(drop);
      if (this.hooks.aiEnabled()) {
        const gen = h('button', { class: 'cell ai-btn', 'data-juice': '', 'data-gen': '' }, icon('i-sparkle'), h('span', { text: 'Нарисовать AI' }));
        gen.addEventListener('click', () => this.hooks.generateImage(l.id, gen));
        tools.append(gen);
      }
    }
    return section(kind === 'card' ? 'Карта' : kind === 'logo' ? 'Логотип' : 'Иллюстрация', grid, tools.childElementCount ? tools : null);
  }

  private colorRow(l: Layer): HTMLElement | null {
    const doc = this.editor.doc!;
    const theme = themeById(doc.theme);
    let options: { label: string; color: string; fg?: string }[] = [];
    if (l.kind === 'text') options = [
      { label: 'Как в теме', color: theme.text },
      { label: 'Белый', color: '#FFFFFF' },
      { label: 'Тёмный', color: '#2A2B2E' },
      { label: 'Зелёный', color: '#52AE30' },
    ];
    else if (l.kind === 'badge' || l.kind === 'badgeRow') options = [
      { label: 'Белый', color: theme.badge.bg, fg: theme.badge.fg },
      { label: 'Акцент', color: theme.accent.bg, fg: theme.accent.fg },
      { label: 'Тёмный', color: '#2A2B2E', fg: '#FFFFFF' },
      { label: 'Оранжевый', color: '#F4821F', fg: '#FFFFFF' },
    ];
    else if (l.kind === 'stat') options = [
      { label: 'Белый', color: theme.stat.bg, fg: theme.stat.fg },
      { label: 'Тёмный', color: '#2A2B2E', fg: '#FFFFFF' },
    ];
    else if (l.kind === 'glow') options = [
      { label: 'Как в теме', color: theme.glow },
      { label: 'Зелёный', color: '#52AE30' },
      { label: 'Лайм', color: '#A3D890' },
      { label: 'Голубой', color: '#7CECFF' },
      { label: 'Золото', color: '#FAC67A' },
    ];
    if (!options.length) return null;
    const seen = new Set<string>();
    options = options.filter((o) => !seen.has(o.color.toUpperCase()) && seen.add(o.color.toUpperCase()));
    const row = h('div', { class: 'color-row', role: 'radiogroup', 'aria-label': 'Цвет' });
    for (const o of options) {
      const b = h('button', { class: 'color-dot', role: 'radio', 'aria-label': o.label, 'data-tip': o.label, 'data-color': o.color.toUpperCase(), style: `--c:${o.color};--fg:${o.fg ?? 'transparent'}` });
      b.addEventListener('click', () => this.editor.change((d) => setColor(d, l.id, o.color, o.fg)));
      row.append(b);
    }
    this.syncs.push(() => {
      const cur = this.layer(l.id);
      const c = cur ? currentColor(cur) : '';
      for (const b of row.querySelectorAll<HTMLElement>('.color-dot')) b.setAttribute('aria-checked', String(b.dataset.color === c.toUpperCase()));
    });
    return section('Цвет', row);
  }

  private layerActions(l: Layer) {
    const doc = this.editor.doc!;
    const idx = () => this.editor.doc!.layers.findIndex((x) => x.id === l.id);
    const up = actBtn('i-up', 'Выше', () => this.editor.change((d) => reorderLayer(d, l.id, idx() + 1)));
    const down = actBtn('i-down', 'Ниже', () => this.editor.change((d) => reorderLayer(d, l.id, idx() - 1)));
    const dup = actBtn('i-duplicate', 'Дублировать', () => {
      let id: string | null = null;
      this.editor.change((d) => (id = duplicateLayer(d, l.id)?.id ?? null));
      if (id) this.editor.select(id);
    }, '⌘D');
    const del = actBtn('i-trash', 'Удалить', () => this.editor.change((d) => removeLayer(d, l.id)), '⌫');
    del.classList.add('danger');
    this.syncs.push(() => {
      const i = idx();
      up.toggleAttribute('disabled', i < 0 || i >= this.editor.doc!.layers.length - 1);
      down.toggleAttribute('disabled', i <= 0);
    });
    void doc;
    return h('div', { class: 'layer-actions' }, down, up, h('span', { class: 'spacer' }), dup, del);
  }
}

const LANG_NAME: Record<Lang, string> = { ru: 'Русский', uz: 'O‘zbekcha', en: 'English' };

function section(title: string, ...children: (HTMLElement | null)[]) {
  return h('section', { class: 'insp-section' }, h('div', { class: 'insp-label caps', text: title }), ...children);
}

function aiBtn(label: string, fn: () => void, tip?: string) {
  const b = h('button', { class: 'cell sm ai-btn', 'data-tip': tip ?? null }, icon('i-sparkle', 'i i-sm'), h('span', { text: label }));
  b.addEventListener('click', fn);
  return b;
}

function actBtn(ic: string, label: string, fn: () => void, kbd?: string) {
  const b = h('button', { class: 'cell clear icon-btn', 'aria-label': label, 'data-tip': label, 'data-kbd': kbd ?? null }, icon(ic));
  b.addEventListener('click', fn);
  return b;
}

function sizeOf(l: Layer) {
  return l.kind === 'text' || l.kind === 'badge' || l.kind === 'badgeRow' || l.kind === 'stat' ? l.size : 0;
}

function currentColor(l: Layer) {
  if (l.kind === 'text' || l.kind === 'glow') return l.color;
  if (l.kind === 'badge' || l.kind === 'stat') return l.background;
  if (l.kind === 'badgeRow') return l.items[0]?.background ?? '';
  return '';
}
