/**
 * The banner where it will live: its slot on the Ipoteka home screen, on an Android phone at
 * 360×800, where the slot is 328 = 360 − 2×16 wide, so the banner shows 1:1. The language switches
 * the banner and the whole screen; «Все языки» puts a phone per language side by side. On entry
 * the banner flies from the editor into its slot; with reduced motion it fades.
 */
import { LANG_LABEL, TEMPLATES, docFromTemplate, type BannerDoc, type Lang } from '../engine';
import { drawBanner } from '../render/draw';
import { assetUrl } from '../render/images';
import { initSeg, initToggle, type SegApi } from '../ui/kit/components';
import { reduced } from '../ui/kit/core';
import { h, icon } from '../app/dom';
import type { Editor, EditorEvent } from '../app/state';
import { STRINGS } from './strings';
import './preview.css';

const PHONE = { w: 360, h: 800, bezel: 10 };
/** the banner slot on the home screen; the radius is a guess until we have the real screen */
export const SLOT = { x: 16, w: 328, h: 106, radius: 12, gap: 8 };
const LANG_NAME: Record<Lang, string> = { ru: 'Русский', uz: 'O‘zbekcha', en: 'English' };
/** official banners that share the carousel with the one being made */
const NEIGHBOURS = ['cumulative', 'humo', 'daromax', 'mortgage'];

interface Device {
  lang: Lang;
  el: HTMLElement;
  phone: HTMLElement;
  screen: HTMLElement;
  promo: HTMLElement;
  track: HTMLElement;
  slides: { canvas: HTMLCanvasElement; doc: () => BannerDoc }[];
  dots: HTMLElement[];
  index: number;
}

export class Preview {
  private lang: Lang = 'ru';
  private all = false;
  private scale = 1;
  private devices: Device[] = [];
  private neighbours: BannerDoc[] = [];
  private seg: SegApi | null = null;
  private stageEl: HTMLElement | null = null;
  private resizeQueued = false;
  private leaveTimer = 0;

  constructor(
    private editor: Editor,
    private root: HTMLElement,
    private hooks: { close(): void; sourceRect(): DOMRect | null },
  ) {
    window.addEventListener('resize', () => {
      if (this.root.hidden || this.resizeQueued) return;
      this.resizeQueued = true;
      requestAnimationFrame(() => {
        this.resizeQueued = false;
        this.layout();
      });
    });
  }

  get isOpen() {
    return !this.root.hidden;
  }

  open() {
    const doc = this.editor.doc;
    if (!doc) return;
    clearTimeout(this.leaveTimer);
    this.lang = doc.languages.enabled.includes(this.editor.lang) ? this.editor.lang : doc.languages.primary;
    this.neighbours = NEIGHBOURS.filter((id) => id !== doc.template && TEMPLATES.some((t) => t.id === id))
      .slice(0, 2)
      .map((id) => docFromTemplate(id, { now: 0 }));
    this.root.hidden = false;
    this.root.classList.remove('is-open', 'is-leaving');
    this.build();
    const from = this.all || reduced() ? null : this.hooks.sourceRect();
    const own = this.devices[0]?.slides[0].canvas;
    const target = own?.getBoundingClientRect();
    // entry: devices start low and transparent, then spring into place
    this.root.classList.add('is-entering');
    void this.root.offsetWidth;
    requestAnimationFrame(() => {
      this.root.classList.remove('is-entering');
      this.root.classList.add('is-open');
    });
    if (from && own && target && target.width > 0) this.fly(doc, own, from, target);
    requestAnimationFrame(() => this.root.querySelector<HTMLElement>('.pv-back')?.focus({ preventScroll: true }));
  }

  close() {
    if (this.root.hidden) return;
    const doc = this.editor.doc;
    if (!this.all && doc?.languages.enabled.includes(this.lang)) this.editor.setLang(this.lang);
    this.root.classList.remove('is-open');
    this.root.classList.add('is-leaving');
    document.querySelectorAll('.pv-flyer').forEach((f) => f.remove());
    this.leaveTimer = window.setTimeout(
      () => {
        this.root.hidden = true;
        this.root.classList.remove('is-leaving');
        this.root.replaceChildren();
        this.devices = [];
      },
      reduced() ? 0 : 320,
    );
    this.hooks.close();
  }

  /** The document changed while the preview is open: redraw the banners. */
  sync(e: EditorEvent) {
    if (e.doc && this.isOpen) this.drawAll();
  }

  /** Keys while the preview is up. Returns true when handled. */
  key(e: KeyboardEvent): boolean {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    const doc = this.editor.doc;
    if (e.code === 'Escape' || e.code === 'KeyP') this.close();
    else if (e.code === 'KeyL') this.setAll(!this.all);
    else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') this.devices.forEach((d) => this.go(d, d.index + (e.code === 'ArrowRight' ? 1 : -1)));
    else if (/^Digit[123]$/.test(e.code) && doc) {
      const lang = (['ru', 'uz', 'en'] as const)[Number(e.code.slice(5)) - 1];
      if (!doc.languages.enabled.includes(lang) || this.all) return false;
      this.seg?.set(lang);
    } else return false;
    return true;
  }

  /* ---------- building ---------- */

  private build() {
    const doc = this.editor.doc!;
    const back = h('button', { class: 'cell clear pv-back', 'data-tip': 'Вернуться к редактору', 'data-kbd': 'Esc' }, icon('i-back'), h('span', { text: 'К редактору' }));
    back.addEventListener('click', () => this.close());

    const segEl = h(
      'div',
      { class: 'seg', 'aria-label': 'Язык превью' },
      ...doc.languages.enabled.map((l, i) => h('button', { 'data-value': l, 'aria-checked': String(l === this.lang), 'data-kbd': String(i + 1) }, LANG_LABEL[l])),
    );
    const allBtn = h('button', { class: 'cell clear', 'data-toggle': '', 'aria-pressed': String(this.all), 'data-tip': 'Телефон на каждый язык', 'data-kbd': 'L' }, icon('i-langs'), h('span', { text: 'Все языки' }));
    allBtn.toggleAttribute('disabled', doc.languages.enabled.length < 2);
    const dock = h('div', { class: 'island glass pv-dock' }, segEl, allBtn);

    this.stageEl = h('div', { class: 'pv-stage' });
    this.root.replaceChildren(
      h('div', { class: 'pv-backdrop', 'aria-hidden': 'true' }),
      h('div', { class: 'pv-top' }, h('div', { class: 'island glass' }, back), h('p', { class: 'pv-note', text: 'Экран приложения — реконструкция по дизайн-системе: важно, как баннер смотрится в слоте 328×106.' })),
      this.stageEl,
      h('div', { class: 'pv-bottom' }, dock),
    );
    this.seg = initSeg(segEl);
    segEl.addEventListener('change', (e) => this.setLang((e as CustomEvent<{ value: Lang }>).detail.value));
    initToggle(allBtn);
    allBtn.addEventListener('change', (e) => this.setAll((e as CustomEvent<{ value: boolean }>).detail.value));
    segEl.classList.toggle('is-off', this.all);
    this.buildDevices();
  }

  private buildDevices() {
    const doc = this.editor.doc!;
    const langs = this.all ? doc.languages.enabled : [this.lang];
    this.devices = langs.map((lang) => this.device(lang));
    this.stageEl!.replaceChildren(...this.devices.map((d) => d.el));
    this.layout();
  }

  private setAll(on: boolean) {
    if (on === this.all) return;
    if (on && (this.editor.doc?.languages.enabled.length ?? 0) < 2) return;
    this.all = on;
    const btn = this.root.querySelector<HTMLElement>('.pv-dock [data-toggle]');
    btn?.setAttribute('aria-pressed', String(on));
    this.root.querySelector('.pv-dock .seg')?.classList.toggle('is-off', on);
    this.buildDevices();
    this.devices.forEach((d, i) => {
      d.el.style.setProperty('--i', String(i));
      d.el.classList.add('is-arriving');
      requestAnimationFrame(() => requestAnimationFrame(() => d.el.classList.remove('is-arriving')));
    });
  }

  private setLang(lang: Lang) {
    if (lang === this.lang) return;
    this.lang = lang;
    const d = this.devices[0];
    if (!d || this.all) return;
    // the screen dips and comes back in the new language
    d.screen.classList.add('is-fading');
    window.setTimeout(
      () => {
        d.lang = lang;
        this.fillStrings(d);
        this.draw(d);
        d.screen.classList.remove('is-fading');
      },
      reduced() ? 0 : 150,
    );
  }

  /** Scale so the phone fits the window (or N phones fit side by side). */
  private layout() {
    const n = this.devices.length || 1;
    const fullW = PHONE.w + PHONE.bezel * 2;
    const fullH = PHONE.h + PHONE.bezel * 2;
    const st = this.stageEl!;
    st.classList.toggle('is-all', this.all);
    const cs = getComputedStyle(st);
    const availH = st.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const availW = st.clientWidth - (n - 1) * 44;
    this.scale = Math.max(0.3, Math.min(1.15, availH / fullH, availW / (n * fullW)));
    for (const d of this.devices) {
      d.el.style.width = `${fullW * this.scale}px`;
      d.el.style.height = `${fullH * this.scale}px`;
      d.phone.style.transform = `scale(${this.scale})`;
    }
    this.drawAll();
  }

  private drawAll() {
    this.devices.forEach((d) => this.draw(d));
  }

  private draw(d: Device) {
    const dpr = (window.devicePixelRatio || 1) * this.scale;
    for (const s of d.slides) drawBanner(s.canvas, s.doc(), d.lang, SLOT.w, { dpr });
  }

  /* ---------- one phone ---------- */

  private device(lang: Lang): Device {
    const doc = () => this.editor.doc!;
    const t = (key: string, cls = '') => h('span', { class: `pv-t ${cls}`.trim(), 'data-s': key });
    const status = h(
      'div',
      { class: 'pv-status' },
      h('span', { class: 'pv-time', text: '9:41' }),
      h('i', { class: 'pv-punch', 'aria-hidden': 'true' }),
      h('span', { class: 'pv-sys', html: SYS_ICONS }),
    );
    const head = h(
      'header',
      { class: 'pv-head' },
      h('span', { class: 'pv-avatar', 'data-s': 'initial' }),
      h('span', { class: 'pv-hello' }, t('greeting', 'pv-greet'), t('name', 'pv-name')),
      h('span', { class: 'pv-bell', html: svg(ICON.bell) }),
    );
    const balance = h(
      'section',
      { class: 'pv-balance' },
      h('div', { class: 'pv-bal-top' }, t('balance', 'pv-bal-label'), h('span', { class: 'pv-eye', html: svg(ICON.eye) })),
      h('div', { class: 'pv-bal-amount' }, t('amount', 'pv-amount'), t('currency', 'pv-cur')),
      h('div', { class: 'pv-bal-link' }, t('accounts'), h('span', { class: 'pv-chev', html: svg(ICON.chev) })),
    );
    const cards = h(
      'div',
      { class: 'pv-cards' },
      ...(['card-humo-a', 'card-humo-b', 'card-visa-gold'] as const).map((id, i) => h('div', { class: 'pv-card' }, h('img', { src: assetUrl(id) ?? '', alt: '', draggable: 'false' }), t(`card${i}`, 'pv-card-label'))),
    );
    const actions = h(
      'nav',
      { class: 'pv-actions' },
      ...[ICON.transfer, ICON.pay, ICON.loan, ICON.deposit].map((ic, i) => h('span', { class: 'pv-action' }, h('span', { class: 'pv-action-ic', html: svg(ic) }), t(`action${i}`, 'pv-action-label'))),
    );
    const own = h('canvas', { class: 'pv-banner', role: 'img', 'aria-label': `Баннер, ${LANG_NAME[lang]}` });
    const others = this.neighbours.map(() => h('canvas', { class: 'pv-banner', 'aria-hidden': 'true' }));
    const track = h('div', { class: 'pv-track' }, h('div', { class: 'pv-slide is-own' }, own), ...others.map((c) => h('div', { class: 'pv-slide' }, c)));
    const dots = [own, ...others].map((_, i) => h('i', { class: `pv-dot${i === 0 ? ' is-on' : ''}` }));
    const promo = h('section', { class: 'pv-promo', 'aria-label': 'Баннеры' }, h('div', { class: 'pv-viewport' }, track), h('div', { class: 'pv-dots', 'aria-hidden': 'true' }, ...dots));
    const ops = h(
      'section',
      { class: 'pv-ops' },
      h('div', { class: 'pv-ops-head' }, t('recent', 'pv-h'), t('all', 'pv-link')),
      ...[ICON.cart, ICON.car, ICON.arrowIn, ICON.bag].map((ic, i) =>
        h('div', { class: `pv-op${i === 2 ? ' is-in' : ''}` }, h('span', { class: 'pv-op-ic', html: svg(ic) }), h('span', { class: 'pv-op-text' }, t(`op${i}.title`, 'pv-op-title'), t(`op${i}.meta`, 'pv-op-meta')), t(`op${i}.amount`, 'pv-op-amount')),
      ),
    );
    const tabs = h(
      'nav',
      { class: 'pv-tabs' },
      ...[ICON.home, ICON.pay, ICON.transfer, ICON.clock, ICON.grid].map((ic, i) => h('span', { class: `pv-tab${i === 0 ? ' is-on' : ''}` }, h('span', { class: 'pv-tab-ic', html: svg(ic) }), t(`tab${i}`, 'pv-tab-label'))),
    );
    const screen = h('div', { class: 'pv-screen', lang }, status, h('div', { class: 'pv-scroll' }, head, balance, cards, actions, promo, ops), tabs, h('i', { class: 'pv-gesture', 'aria-hidden': 'true' }));
    const phone = h('div', { class: 'pv-phone' }, screen, h('i', { class: 'pv-btn pv-power', 'aria-hidden': 'true' }), h('i', { class: 'pv-btn pv-vol', 'aria-hidden': 'true' }));
    const el = h('figure', { class: 'pv-device', 'aria-label': `Превью, ${LANG_NAME[lang]}` }, phone);
    if (this.all) el.append(h('figcaption', { class: 'pv-caption mono', text: `${LANG_LABEL[lang]} · ${LANG_NAME[lang]}` }));
    const d: Device = {
      lang,
      el,
      phone,
      screen,
      promo,
      track,
      slides: [{ canvas: own, doc }, ...others.map((canvas, i) => ({ canvas, doc: () => this.neighbours[i] }))],
      dots,
      index: 0,
    };
    this.fillStrings(d);
    this.swipe(d);
    return d;
  }

  private fillStrings(d: Device) {
    const s = STRINGS[d.lang];
    const value: Record<string, string> = {
      greeting: s.greeting,
      name: s.name,
      initial: s.name[0],
      balance: s.balance,
      amount: s.amount,
      currency: s.currency,
      accounts: s.accounts,
      recent: s.recent,
      all: s.all,
    };
    s.cards.forEach((c, i) => (value[`card${i}`] = c));
    s.actions.forEach((c, i) => (value[`action${i}`] = c));
    s.tabs.forEach((c, i) => (value[`tab${i}`] = c));
    s.ops.forEach((o, i) => {
      value[`op${i}.title`] = o.title;
      value[`op${i}.meta`] = o.meta;
      value[`op${i}.amount`] = o.amount;
    });
    d.screen.setAttribute('lang', d.lang);
    d.slides[0].canvas.setAttribute('aria-label', `Баннер, ${LANG_NAME[d.lang]}`);
    for (const el of d.screen.querySelectorAll<HTMLElement>('[data-s]')) el.textContent = value[el.dataset.s!] ?? '';
  }

  /* ---------- carousel ---------- */

  private go(d: Device, index: number) {
    const n = d.slides.length;
    d.index = Math.max(0, Math.min(n - 1, index));
    d.track.style.transform = `translateX(${-d.index * (SLOT.w + SLOT.gap)}px)`;
    d.dots.forEach((dot, i) => dot.classList.toggle('is-on', i === d.index));
  }

  /** Swipe the banners like in the app; a short flick is enough, the ends rubber-band. */
  private swipe(d: Device) {
    let start: { x: number; t: number; id: number } | null = null;
    let dx = 0;
    const step = SLOT.w + SLOT.gap;
    d.promo.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      start = { x: e.clientX, t: performance.now(), id: e.pointerId };
      dx = 0;
      d.promo.setPointerCapture(e.pointerId);
      d.track.classList.add('is-dragging');
    });
    d.promo.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      dx = (e.clientX - start.x) / this.scale;
      const max = (d.slides.length - 1) * step;
      let x = -d.index * step + dx;
      if (x > 0) x = x * 0.35;
      if (x < -max) x = -max + (x + max) * 0.35;
      d.track.style.transform = `translateX(${x}px)`;
    });
    const end = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const fast = Math.abs(dx) > 24 && performance.now() - start.t < 260;
      start = null;
      d.track.classList.remove('is-dragging');
      if (dx < -step / 3 || (fast && dx < 0)) this.go(d, d.index + 1);
      else if (dx > step / 3 || (fast && dx > 0)) this.go(d, d.index - 1);
      else this.go(d, d.index);
    };
    d.promo.addEventListener('pointerup', end);
    d.promo.addEventListener('pointercancel', end);
  }

  /* ---------- the flight from the editor ---------- */

  /**
   * FLIP: a copy of the banner starts exactly over the editor's banner and lands in the slot as
   * the phone arrives; the slot's own canvas takes over when it lands.
   */
  private fly(doc: BannerDoc, own: HTMLCanvasElement, from: DOMRect, to: DOMRect) {
    const fly = h('canvas', { class: 'pv-flyer', 'aria-hidden': 'true' });
    drawBanner(fly, doc, this.lang, from.width);
    const k = to.width / from.width;
    fly.style.left = `${from.left}px`;
    fly.style.top = `${from.top}px`;
    document.body.append(fly);
    own.style.opacity = '0';
    void fly.offsetWidth;
    const done = () => {
      own.style.opacity = '';
      fly.remove();
    };
    requestAnimationFrame(() => {
      fly.classList.add('is-flying');
      fly.style.transform = `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${k})`;
      fly.style.borderRadius = `${(SLOT.radius * this.scale) / k}px`;
    });
    fly.addEventListener('transitionend', (e) => e.propertyName === 'transform' && done());
    window.setTimeout(done, 1400);
  }
}

/* ---------- icons of the app screen (24px line icons) ---------- */

const ICON = {
  bell: '<path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  chev: '<path d="M9.5 6l6 6-6 6"/>',
  transfer: '<path d="M4.5 8.5h14l-3.5-3.5"/><path d="M19.5 15.5h-14l3.5 3.5"/>',
  pay: '<rect x="4.5" y="3.5" width="15" height="17" rx="2.5"/><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4"/>',
  loan: '<circle cx="12" cy="12" r="8.5"/><path d="M9 15l6-6"/><circle cx="9.3" cy="9.3" r="1.1"/><circle cx="14.7" cy="14.7" r="1.1"/>',
  deposit: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="12" cy="12" r="3.2"/><path d="M12 8.8V7.5M15.2 12h1.3"/>',
  cart: '<path d="M3.5 4.5h2.2l2 10.5h10l1.8-7.5H7"/><circle cx="9.5" cy="19" r="1.3"/><circle cx="16.5" cy="19" r="1.3"/>',
  car: '<path d="M4.5 16.5v-4l2-5h11l2 5v4"/><path d="M3.5 12.5h17v4h-17z"/><circle cx="7.5" cy="16.5" r="1.6"/><circle cx="16.5" cy="16.5" r="1.6"/>',
  arrowIn: '<path d="M12 4.5v12"/><path d="M6.5 11l5.5 5.5 5.5-5.5"/><path d="M5 20h14"/>',
  bag: '<path d="M5.5 8h13l-1 12h-11z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  home: '<path d="M4 11l8-6.5 8 6.5v8.5h-5.5v-5h-5v5H4z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/>',
};

const svg = (paths: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

const SYS_ICONS =
  '<svg viewBox="0 0 18 12" aria-hidden="true"><path d="M1 11h2.2V8.2H1zM5 11h2.2V6.2H5zM9 11h2.2V4H9zM13 11h2.2V1.5H13z" fill="currentColor"/></svg>' +
  '<svg viewBox="0 0 16 12" aria-hidden="true"><path d="M8 11.2l2.3-2.6a3.2 3.2 0 0 0-4.6 0zM3.5 6.3a6.4 6.4 0 0 1 9 0l1.6-1.8a8.8 8.8 0 0 0-12.2 0z" fill="currentColor"/></svg>' +
  '<svg viewBox="0 0 26 12" aria-hidden="true"><rect x="0.5" y="0.5" width="22" height="11" rx="3" fill="none" stroke="currentColor" opacity=".45"/><rect x="2" y="2" width="16" height="8" rx="1.8" fill="currentColor"/><path d="M24 4v4a2 2 0 0 0 0-4z" fill="currentColor" opacity=".45"/></svg>';
