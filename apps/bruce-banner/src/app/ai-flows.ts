/**
 * Everything AI, as the person sees it:
 *  - a brief becomes three banners (variants), each already in RU/UZ/EN, with library art;
 *    titles that do not fit get one automatic "shorter" pass in that language only;
 *  - text actions on a selection (shorter, another wording, translate) and "translate everything";
 *  - an illustration drawn for the chosen banner, cut out of its magenta background in a worker.
 * AI copy is marked as AI copy until a person edits or confirms it; an answer that arrives after
 * the text was changed by hand is dropped, not applied.
 */
import {
  LANG_LABEL,
  docFromTemplate,
  findLayer,
  layoutBanner,
  layoutIssues,
  replaceArt,
  setAsset,
  setTexts,
  setTheme,
  templateById,
  themeById,
  usedSlots,
  type BannerDoc,
  type Lang,
  type Layer,
} from '../engine';
import { opaqueBox } from '../render/alpha';
import { drawBanner } from '../render/draw';
import { preloadDoc } from '../render/images';
import { measure } from '../render/measure';
import { juice, kit, pop, toast } from '../ui/kit/core';
import { initSeg } from '../ui/kit/components';
import { initPrompt } from '../ui/kit/prompt';
import type { BriefResponse, LangText, TextOp, Variant } from '../../server/contracts';
import { AiError, accessCode, ai, buildCatalog } from './ai-client';
import { h, icon } from './dom';
import { slotsOf } from './inspector';
import { putImage } from './storage';
import type { Editor } from './state';

export type AiState = 'loading' | 'live' | 'mock' | 'off';

export interface FlowHooks {
  openDoc(doc: BannerDoc, opts?: { suggestArt?: string }): void;
  backHome(): void;
}

/* ---------- variants ---------- */

export function nameFromBrief(brief: string) {
  const t = brief.replace(/\s+/g, ' ').trim();
  return t.length > 42 ? `${t.slice(0, 40).replace(/[\s,.;:—-]+\S*$/, '')}…` : t;
}

/** A document from an AI variant: the layout's template, the chosen theme, the copy, the art. */
export function docFromVariant(v: Variant, brief: string, mock: boolean): BannerDoc {
  const doc = docFromTemplate(v.layout, { name: nameFromBrief(brief) });
  setTheme(doc, v.theme);
  for (const [key, t] of Object.entries(v.copy)) setTexts(doc, key, t, mock ? 'template' : 'ai');
  // a slot the model left out stays empty (an empty badge is not drawn), not the template's text
  if (!mock) for (const key of Object.keys(doc.copy)) if (!v.copy[key]) setTexts(doc, key, { ru: '', uz: '', en: '' }, 'ai');
  const art = doc.layers.find((l) => l.kind === 'image' || l.kind === 'card' || l.kind === 'imageClip');
  if (art && v.art) {
    const isCard = v.art.startsWith('card-');
    if ((art.kind === 'card') === isCard && art.kind !== 'imageClip') setAsset(doc, art.id, v.art);
  }
  doc.brief = brief;
  return doc;
}

export class Variants {
  private ctrl: AbortController | null = null;
  private brief = '';
  private docs: { v: Variant; doc: BannerDoc; mock: boolean }[] = [];
  private lang: Lang = 'ru';
  private list: HTMLElement;
  private status: HTMLElement;

  constructor(
    private editor: Editor,
    private root: HTMLElement,
    private hooks: FlowHooks,
    private access: AccessCode,
  ) {
    this.list = root.querySelector('#var-list')!;
    this.status = root.querySelector('#var-status')!;
    const segEl = root.querySelector<HTMLElement>('#var-lang')!;
    initSeg(segEl);
    segEl.addEventListener('change', (e) => {
      this.lang = (e as CustomEvent<{ value: Lang }>).detail.value;
      this.renderCards();
    });
    root.querySelector('#var-back')!.addEventListener('click', () => this.leave());
    root.querySelector('#var-edit')!.addEventListener('click', () => this.leave());
    root.querySelector('#var-more')!.addEventListener('click', () => void this.run(this.brief, this.docs.map((d) => d.v.layout)));
  }

  leave() {
    this.ctrl?.abort();
    this.hooks.backHome();
  }

  async run(brief: string, avoid: string[] = []) {
    this.ctrl?.abort();
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    this.brief = brief;
    this.root.querySelector('#var-brief-text')!.textContent = brief;
    this.editor.setMode('variants');
    this.docs = [];
    this.skeletons();
    this.setStatus('Пишем тексты на трёх языках и подбираем иллюстрации…', 'busy');
    const more = this.root.querySelector<HTMLButtonElement>('#var-more')!;
    more.disabled = true;
    kit.busy = true;
    try {
      const res: BriefResponse = await this.access.retry(() => ai.brief({ brief, catalog: buildCatalog(), avoid }, ctrl.signal));
      if (ctrl.signal.aborted) return;
      this.docs = res.variants.map((v) => ({ v, doc: docFromVariant(v, brief, res.mock), mock: res.mock }));
      await Promise.all(this.docs.map((d) => preloadDoc(d.doc)));
      this.renderCards();
      this.setStatus(res.mock ? 'Демо-режим: ключ Gemini не подключён, показаны ближайшие шаблоны с их текстом' : 'Выберите вариант — дальше можно поправить всё', res.mock ? 'mock' : 'ok');
      if (!res.mock) void this.autoShorten(ctrl.signal);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      this.list.replaceChildren();
      const err = e as AiError;
      const retry = h('button', { class: 'cell sm', text: 'Попробовать ещё раз' });
      retry.addEventListener('click', () => void this.run(brief, avoid));
      this.setStatus(err.message || 'Не получилось', 'error', retry);
    } finally {
      kit.busy = false;
      more.disabled = false;
    }
  }

  /** One "shorter" pass for titles that overflow in a language; only that language changes. */
  private async autoShorten(signal: AbortSignal) {
    const catalog = buildCatalog();
    for (const item of this.docs) {
      for (const lang of item.doc.languages.enabled) {
        const lay = layoutBanner(item.doc, lang, measure);
        const bad = layoutIssues(item.doc, lay).filter((i) => i.code === 'overflow' && i.slot);
        for (const issue of bad) {
          const slot = issue.slot!;
          const texts = pick(item.doc, slot);
          const limits = catalog.layouts.find((l) => l.id === item.doc.template)?.slots[slot];
          try {
            const r = await ai.text({ op: 'shorter', slot, texts, from: lang, to: [lang], limits, context: { brief: this.brief } }, signal);
            if (signal.aborted) return;
            if (r.texts[lang] && item.doc.copy[slot]?.[lang] === texts[lang]) setTexts(item.doc, slot, { [lang]: r.texts[lang] }, 'ai');
          } catch {
            /* the card shows the overflow; the person can shorten by hand */
          }
        }
      }
    }
    if (!signal.aborted) this.renderCards();
  }

  private skeletons() {
    this.list.replaceChildren(...[0, 1, 2].map((i) => h('article', { class: 'var-card is-skeleton', style: `--i:${i}` }, h('div', { class: 'var-canvas shimmer' }), h('div', { class: 'var-meta' }, h('span', { class: 'line shimmer' }), h('span', { class: 'line short shimmer' })))));
  }

  private renderCards() {
    if (!this.docs.length) return;
    const lang = this.lang;
    this.list.replaceChildren(
      ...this.docs.map((item, i) => {
        const canvas = h('canvas', { 'aria-hidden': 'true' });
        drawBanner(canvas, item.doc, lang, 656);
        const theme = themeById(item.doc.theme);
        const tpl = templateById(item.doc.template);
        const issues = item.doc.languages.enabled.flatMap((l) => layoutIssues(item.doc, layoutBanner(item.doc, l, measure)).filter((x) => x.severity !== 'hint'));
        const bad = issues.some((x) => x.severity === 'error');
        const take = h('button', { class: 'cell primary', 'data-juice': '' }, h('span', { text: 'Взять этот' }), icon('i-arrow-right'));
        const open = () => this.hooks.openDoc(structuredClone(item.doc), { suggestArt: item.v.generate });
        take.addEventListener('click', open);
        juice.bind(take);
        const pickBtn = h('button', { class: 'var-canvas', 'aria-label': `Вариант ${i + 1}: открыть в редакторе` }, canvas);
        pickBtn.addEventListener('click', open);
        return h(
          'article',
          { class: 'var-card', style: `--i:${i}` },
          pickBtn,
          h(
            'div',
            { class: 'var-meta' },
            h('div', { class: 'var-tags' }, h('span', { class: 'tag', text: theme.label }), tpl ? h('span', { class: 'tag', text: tpl.label }) : null, item.v.generate ? h('span', { class: 'tag ai', text: 'AI нарисует иллюстрацию' }) : null),
            item.v.why ? h('p', { class: 'var-why', text: item.v.why }) : null,
            issues.length ? h('p', { class: `var-issues${bad ? '' : ' is-warn'}` }, icon('i-warn', 'i i-sm'), issues.map((x) => `${LANG_LABEL[x.lang]}: ${x.message}`).join(' · ')) : h('p', { class: 'var-ok' }, icon('i-check', 'i i-sm'), 'Влезает во всех языках'),
            take,
          ),
        );
      }),
    );
  }

  private setStatus(text: string, state: 'busy' | 'ok' | 'mock' | 'error', action?: HTMLElement) {
    this.status.dataset.state = state;
    this.status.replaceChildren(h('span', { class: 'var-status-dot', 'aria-hidden': 'true' }), h('span', { text }), ...(action ? [action] : []));
  }
}

function pick(doc: BannerDoc, slot: string): LangText {
  const s = doc.copy[slot];
  return { ru: s?.ru ?? '', uz: s?.uz ?? '', en: s?.en ?? '' };
}

/* ---------- text actions ---------- */

export class TextTools {
  private busy = false;

  constructor(
    private editor: Editor,
    private access: AccessCode,
  ) {}

  /** Runs `op` on every slot of a layer: shorter/rephrase in the language on screen, translate from the primary to the others. */
  async run(op: TextOp, layer: Layer, anchor: HTMLElement) {
    const doc = this.editor.doc;
    if (!doc || this.busy) return;
    const keys = slotsOf(layer).map((s) => s.key);
    const from = op === 'translate' ? doc.languages.primary : this.editor.lang;
    const to = op === 'translate' ? doc.languages.enabled.filter((l) => l !== from) : [this.editor.lang];
    if (!to.length) {
      toast('Включите ещё язык', 'переводить не на что');
      return;
    }
    await this.apply(op, keys, from, to, anchor);
  }

  /** "Перевести": every text of the banner from the primary language into the others. */
  async translateAll(anchor: HTMLElement) {
    const doc = this.editor.doc;
    if (!doc || this.busy) return;
    const from = doc.languages.primary;
    const to = doc.languages.enabled.filter((l) => l !== from);
    const keys = usedSlots(doc).filter((k) => k !== 'stat' && doc.copy[k]?.[from]?.trim());
    if (!to.length || !keys.length) return;
    await this.apply('translate', keys, from, to, anchor);
  }

  private async apply(op: TextOp, keys: string[], from: Lang, to: Lang[], anchor: HTMLElement) {
    this.busy = true;
    anchor.classList.add('is-busy');
    anchor.setAttribute('aria-busy', 'true');
    kit.busy = true;
    const catalog = buildCatalog();
    let changed = 0;
    let note = '';
    try {
      for (const key of keys) {
        const doc = this.editor.doc;
        if (!doc) break;
        const before = pick(doc, key);
        if (!before[from].trim()) continue;
        const limits = catalog.layouts.find((l) => l.id === doc.template)?.slots[key];
        const r = await this.access.retry(() => ai.text({ op, slot: key, texts: before, from, to, limits, context: { title: doc.copy.title?.[from], brief: doc.brief } }));
        note ||= r.note ?? '';
        // drop answers for a language someone typed in meanwhile
        const now = this.editor.doc && pick(this.editor.doc, key);
        const fresh: Partial<LangText> = {};
        for (const l of to) if (r.texts[l] && now && now[l] === before[l] && r.texts[l] !== before[l]) fresh[l] = r.texts[l];
        if (Object.keys(fresh).length) {
          this.editor.change((d) => setTexts(d, key, fresh, r.mock ? 'user' : 'ai'));
          changed++;
        }
      }
      if (note) toast(note);
      else if (changed) toast(op === 'translate' ? 'Переведено' : op === 'shorter' ? 'Сократили' : 'Новый вариант текста', op === 'translate' ? `${LANG_LABEL[from]} → ${to.map((l) => LANG_LABEL[l]).join(', ')}` : '');
      else toast('Ничего не поменялось');
    } catch (e) {
      const err = e as AiError;
      if (err.code !== 'aborted') toast(err.message || 'AI не ответил', '', 'error');
    } finally {
      this.busy = false;
      kit.busy = false;
      anchor.classList.remove('is-busy');
      anchor.removeAttribute('aria-busy');
    }
  }
}

/* ---------- illustration ---------- */

let worker: Worker | null = null;
let seq = 0;

/** Keys the magenta background off a PNG in a worker. */
export function keyOut(png: Blob): Promise<{ blob: Blob; width: number; height: number; borderFlat: number }> {
  worker ??= new Worker(new URL('./chroma.worker.ts', import.meta.url), { type: 'module' });
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      worker!.removeEventListener('message', onMsg);
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data);
    };
    worker!.addEventListener('message', onMsg);
    worker!.postMessage({ id, png });
  });
}

const b64ToBlob = (b64: string, type: string) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type });

export class ArtGenerator {
  private el: HTMLElement;
  private prompt: ReturnType<typeof initPrompt>;
  private result: HTMLElement;
  private state: HTMLElement;
  private go: HTMLButtonElement;
  private place: HTMLButtonElement;
  private layerId: string | null = null;
  private ctrl: AbortController | null = null;
  private keyed: { blob: Blob; width: number; height: number } | null = null;

  constructor(
    private editor: Editor,
    private access: AccessCode,
  ) {
    this.el = h('section', { class: 'panel gen-pop', role: 'dialog', 'aria-label': 'Нарисовать иллюстрацию', 'data-sticky': '' });
    const close = h('button', { class: 'cell clear icon-btn panel-close', 'aria-label': 'Закрыть' }, icon('i-close'));
    close.addEventListener('click', () => this.close());
    const promptEl = h('div', { class: 'prompt gen-prompt', 'data-max': '300', 'data-cap-height': '96' }, h('textarea', { class: 'field', rows: 2, 'aria-label': 'Что нарисовать', placeholder: 'Один предмет: «зелёная бензоколонка с оранжевой монетой»' }), h('div', { class: 'prompt-row' }, h('span', { class: 'hint', text: 'Стиль, цвета и вырезка фона — автоматически' }), h('span', { class: 'prompt-count' })));
    this.prompt = initPrompt(promptEl);
    promptEl.addEventListener('submit', () => void this.generate());
    this.go = h('button', { class: 'cell primary', 'data-juice': '' }, h('span', { class: 'progress' }), icon('i-sparkle'), h('span', { class: 'label', text: 'Нарисовать' }));
    this.go.addEventListener('click', () => void this.generate());
    juice.bind(this.go);
    this.place = h('button', { class: 'cell', disabled: true }, icon('i-check'), h('span', { text: 'Поставить на баннер' }));
    this.place.addEventListener('click', () => void this.apply());
    this.result = h('div', { class: 'gen-result checker' }, h('span', { class: 'gen-empty', text: 'Здесь появится иллюстрация на прозрачном фоне' }));
    this.state = h('p', { class: 'gen-state', role: 'status', 'aria-live': 'polite' });
    this.el.append(
      h('div', { class: 'panel-head' }, h('div', { class: 'panel-title' }, h('span', { text: 'Нарисовать иллюстрацию' })), close),
      h('div', { class: 'panel-body' }, promptEl, this.result, this.state, h('div', { class: 'gen-actions' }, this.go, this.place)),
    );
    document.body.append(this.el);
  }

  open(layerId: string, anchor: HTMLElement, suggestion?: string) {
    this.layerId = layerId;
    this.keyed = null;
    this.place.disabled = true;
    this.result.replaceChildren(h('span', { class: 'gen-empty', text: 'Здесь появится иллюстрация на прозрачном фоне' }));
    this.state.textContent = '';
    const doc = this.editor.doc;
    this.prompt.set(suggestion ?? (doc ? subjectFromDoc(doc) : ''));
    const r = anchor.getBoundingClientRect();
    const side = (anchor.closest('.panel') ?? anchor).getBoundingClientRect();
    this.el.style.top = `${Math.max(12, Math.min(r.top - 60, innerHeight - 580))}px`;
    this.el.style.right = `${Math.max(12, innerWidth - side.left + 12)}px`;
    pop.open(this.el, anchor, { onClose: () => this.ctrl?.abort() });
    requestAnimationFrame(() => this.prompt.focus());
  }

  close() {
    this.ctrl?.abort();
    if (pop.isOpen(this.el)) pop.close(this.el);
  }

  private async generate(retried = false) {
    const subject = this.prompt.value;
    if (subject.length < 3 || !this.layerId) return;
    this.ctrl?.abort();
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    this.place.disabled = true;
    this.go.disabled = true;
    juice.hold(this.go, true);
    kit.busy = true;
    this.result.classList.add('is-busy');
    this.state.textContent = retried ? 'Фон получился неровным — рисуем ещё раз…' : 'Рисуем… обычно 10–20 секунд';
    try {
      const res = await this.access.retry(() => ai.illustration({ subject, theme: this.editor.doc?.theme }, ctrl.signal));
      this.state.textContent = 'Вырезаем фон…';
      const keyed = await keyOut(b64ToBlob(res.image, res.mime));
      if (keyed.borderFlat < 0.85 && !retried) {
        await this.generate(true);
        return;
      }
      this.keyed = keyed;
      const url = URL.createObjectURL(keyed.blob);
      this.result.replaceChildren(h('img', { src: url, alt: subject }));
      this.state.textContent = res.mock ? 'Демо-режим: это заготовка, настоящая иллюстрация появится с ключом Gemini' : keyed.borderFlat < 0.85 ? 'Фон был неровным: проверьте края' : 'Готово';
      this.place.disabled = false;
    } catch (e) {
      const err = e as AiError;
      if (err.code !== 'aborted') this.state.textContent = err.message || 'Не получилось нарисовать';
    } finally {
      this.go.disabled = false;
      juice.hold(this.go, false);
      kit.busy = false;
      this.result.classList.remove('is-busy');
    }
  }

  private async apply() {
    const id = this.layerId;
    const keyed = this.keyed;
    if (!id || !keyed) return;
    const ref = await putImage(keyed.blob);
    const old = this.editor.doc && findLayer(this.editor.doc, id);
    // the drawing is cropped tight: it takes the place the old picture visibly filled
    const visible = old?.kind === 'image' ? opaqueBox(old.src) : undefined;
    this.editor.change((d) => {
      const l = findLayer(d, id);
      if (!l) return;
      if (l.kind === 'image') replaceArt(d, id, ref, keyed.width / keyed.height, visible);
      else {
        setAsset(d, id, ref);
        if (l.kind === 'imageClip') l.img.height = (l.img.width * keyed.height) / keyed.width;
      }
    });
    this.close();
    toast('Иллюстрация на баннере', 'сохранена в этом браузере');
  }
}

/** A starting description for the drawing: the brief, else the title in the primary language. */
function subjectFromDoc(doc: BannerDoc) {
  return (doc.brief ?? doc.copy.title?.[doc.languages.primary] ?? '').replace(/\n/g, ' ').slice(0, 200);
}

/* ---------- access code ---------- */

/** Asks for the team code once when the server wants one, then retries the call. */
export class AccessCode {
  private el: HTMLElement;
  private waiting: ((ok: boolean) => void) | null = null;

  constructor() {
    const input = h('input', { class: 'field', type: 'password', autocomplete: 'off', 'aria-label': 'Код доступа', placeholder: 'Код от команды дизайна' });
    const ok = h('button', { class: 'cell primary', text: 'Сохранить' });
    const cancel = h('button', { class: 'cell clear', text: 'Отмена' });
    this.el = h(
      'section',
      { class: 'panel code-pop', role: 'dialog', 'aria-label': 'Код доступа к AI', 'data-sticky': '' },
      h('div', { class: 'panel-head' }, h('div', { class: 'panel-title' }, h('span', { text: 'Код доступа к AI' }))),
      h('div', { class: 'panel-body' }, h('p', { class: 'hint', text: 'AI в Bruce Banner работает по коду команды. Код хранится только в этом браузере.' }), input, h('div', { class: 'gen-actions' }, cancel, ok)),
    );
    document.body.append(this.el);
    const done = (saved: boolean) => {
      if (saved) accessCode.set(input.value);
      pop.close(this.el);
      this.waiting?.(saved);
      this.waiting = null;
    };
    ok.addEventListener('click', () => done(input.value.trim().length > 0));
    cancel.addEventListener('click', () => done(false));
    input.addEventListener('keydown', (e) => e.key === 'Enter' && done(input.value.trim().length > 0));
  }

  ask(): Promise<boolean> {
    return new Promise((resolve) => {
      this.waiting = resolve;
      pop.open(this.el, null);
      requestAnimationFrame(() => this.el.querySelector('input')?.focus());
    });
  }

  /** Runs `fn`; on "code needed" asks once and runs it again. */
  async retry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof AiError) || e.code !== 'unauthorized') throw e;
      if (!(await this.ask())) throw new AiError('unauthorized', 'Без кода AI недоступен');
      return fn();
    }
  }
}
