/**
 * The banner where it will live: its slot in the banner carousel of the Ipoteka home screen
 * (Figma «1.0. Home Page», First Enter / Main), on an iPhone at 375×812, where the slot is 328×106,
 * so the banner shows 1:1. The language switches the banner and the whole screen; «Все языки» puts
 * a phone per language side by side. On entry the banner flies from the editor into its slot; with
 * reduced motion it fades.
 */
import { LANG_LABEL, type BannerDoc, type Lang } from '../engine';
import { drawBanner } from '../render/draw';
import { initSeg, initToggle, type SegApi } from '../ui/kit/components';
import { reduced } from '../ui/kit/core';
import { h, icon } from '../app/dom';
import type { Editor, EditorEvent } from '../app/state';
import { STRINGS, type ScreenStrings } from './strings';
import './preview.css';

const PHONE = { w: 375, h: 812, bezel: 12 };
/** the banner slot in the home screen's carousel, as in Figma */
export const SLOT = { x: 16, w: 328, h: 106, radius: 18, gap: 10 };
const LANG_NAME: Record<Lang, string> = { ru: 'Русский', uz: 'O‘zbekcha', en: 'English' };

// screen pictures are brand files (gitignored while the repo is public): a missing one leaves an empty spot
const pics = import.meta.glob('../brand/home/*', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const pic = (file: string) => pics[`../brand/home/${file}`] ?? '';
const icons = import.meta.glob('./icons/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const ico = (name: string) => icons[`./icons/${name}.svg`] ?? '';

interface Device {
  lang: Lang;
  el: HTMLElement;
  phone: HTMLElement;
  screen: HTMLElement;
  promo: HTMLElement;
  track: HTMLElement;
  own: HTMLCanvasElement;
  slides: number;
  index: number;
}

export class Preview {
  private lang: Lang = 'ru';
  private all = false;
  private scale = 1;
  private devices: Device[] = [];
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
    this.root.hidden = false;
    this.root.classList.remove('is-open', 'is-leaving');
    this.build();
    const from = this.all || reduced() ? null : this.hooks.sourceRect();
    const own = this.devices[0]?.own;
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
      h('div', { class: 'pv-top' }, h('div', { class: 'island glass' }, back), h('p', { class: 'pv-note', text: 'Главная Ipoteka из Figma, баннер в карусели 328×106. Соседние баннеры листаются.' })),
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
    drawBanner(d.own, this.editor.doc!, d.lang, SLOT.w, { dpr });
  }

  /* ---------- one phone ---------- */

  private device(lang: Lang): Device {
    const t = (key: keyof ScreenStrings | string, cls = '') => h('span', { class: `pv-t ${cls}`.trim(), 'data-s': key });
    // a picture missing from the build leaves its spot empty rather than a broken image
    const img = (src: string, cls: string) => (src ? h('img', { class: cls, src, alt: '', draggable: 'false' }) : null);
    const status = h(
      'div',
      { class: 'pv-status' },
      h('span', { class: 'pv-time', text: '9:41' }),
      h('span', { class: 'pv-sys' }, img(ico('sb-cell'), 'pv-sb-cell'), img(ico('sb-wifi'), 'pv-sb-wifi'), h('i', { class: 'pv-battery', 'aria-hidden': 'true' }), img(ico('sb-cap'), 'pv-sb-cap')),
    );
    const hero = h('div', { class: 'pv-hero', 'aria-hidden': 'true' }, img(pic('header-bg.jpg'), 'pv-hero-bg'), img(pic('header-shape.svg'), 'pv-hero-shape'));
    const head = h(
      'header',
      { class: 'pv-head' },
      status,
      h('div', { class: 'pv-circles' }, img(ico('btn-user'), 'pv-circle'), img(ico('btn-qr-bell'), 'pv-circle-pair')),
      h('section', { class: 'pv-balance' }, t('balance', 'pv-bal-label'), h('div', { class: 'pv-bal-amount' }, t('amount', 'pv-amount'), t('currency', 'pv-cur'))),
      h(
        'div',
        { class: 'pv-tile' },
        h('span', { class: 'pv-tile-card' }, img(ico('plus'), 'pv-plus')),
        h('span', { class: 'pv-tile-text' }, t('newCard', 'pv-tile-title'), t('newCardSub', 'pv-tile-sub')),
      ),
    );
    const search = h(
      'section',
      { class: 'pv-widget pv-search' },
      h('span', { class: 'pv-input' }, t('search', 'pv-placeholder')),
      h('span', { class: 'pv-qr' }, img(ico('scan-qr'), 'pv-qr-ic')),
    );
    const own = h('canvas', { class: 'pv-banner', role: 'img', 'aria-label': `Баннер, ${LANG_NAME[lang]}` });
    // the banners that are already in the carousel, as drawn in Figma
    const autoloan = h(
      'div',
      { class: 'pv-slide pv-autoloan', 'aria-hidden': 'true' },
      h('span', { class: 'pv-al-title' }, t('autoloan.0'), h('br'), t('autoloan.1')),
      h('span', { class: 'pv-al-more' }, t('more')),
      h('span', { class: 'pv-al-car' }, img(pic('car.png'), '')),
    );
    const daromax = h(
      'div',
      { class: 'pv-slide pv-daromax', 'aria-hidden': 'true' },
      img(pic('glow-dark.svg'), 'pv-dm-glow'),
      t('daromax', 'pv-dm-title'),
      img(pic('deposit.png'), 'pv-dm-pic'),
      h('span', { class: 'pv-chip pv-dm-chip' }, t('upTo18')),
    );
    const card = h(
      'div',
      { class: 'pv-slide pv-pink', 'aria-hidden': 'true' },
      h('span', { class: 'pv-pk-text' }, t('card', 'pv-pk-title'), t('cardSub', 'pv-pk-sub')),
      img(pic('card-pink.png'), 'pv-pk-pic'),
    );
    const track = h('div', { class: 'pv-track' }, h('div', { class: 'pv-slide is-own' }, own), autoloan, daromax, card);
    const promo = h('section', { class: 'pv-widget pv-promo', 'aria-label': 'Баннеры' }, track);
    const loans = h(
      'section',
      { class: 'pv-widget pv-group' },
      t('loans', 'pv-h'),
      h(
        'div',
        { class: 'pv-wide pv-loans', 'aria-hidden': 'true' },
        img(pic('glow-light.svg'), 'pv-wide-glow'),
        h('span', { class: 'pv-ln-money' }, img(pic('money.png'), '')),
        h('span', { class: 'pv-chip pv-ln-chip' }, t('in2min')),
        h('span', { class: 'pv-wide-title' }, t('loansBanner.0'), h('br'), t('loansBanner.1')),
      ),
    );
    const deposits = h(
      'section',
      { class: 'pv-widget pv-group' },
      t('deposits', 'pv-h'),
      h(
        'div',
        { class: 'pv-wide pv-deposits', 'aria-hidden': 'true' },
        img(pic('glow-light.svg'), 'pv-wide-glow'),
        h('span', { class: 'pv-wide-title' }, t('depositsBanner.0'), h('br'), t('depositsBanner.1')),
        img(pic('deposit.png'), 'pv-dp-pic'),
      ),
    );
    const tabNames = ['nav-home', 'nav-wallet', 'nav-transfer', 'nav-history', 'nav-chat'];
    const tabs = h(
      'nav',
      { class: 'pv-tabs' },
      ...tabNames.map((n, i) => h('span', { class: `pv-tab${i === 0 ? ' is-on' : ''}` }, img(ico(n), 'pv-tab-ic'), t(`tabs.${i}`, 'pv-tab-label'))),
      h('i', { class: 'pv-gesture', 'aria-hidden': 'true' }),
    );
    const scroll = h('div', { class: 'pv-scroll' }, hero, head, h('div', { class: 'pv-widgets' }, search, promo, loans, deposits));
    const screen = h('div', { class: 'pv-screen', lang }, scroll, h('i', { class: 'pv-island', 'aria-hidden': 'true' }), tabs);
    const phone = h(
      'div',
      { class: 'pv-phone' },
      screen,
      h('i', { class: 'pv-btn pv-power', 'aria-hidden': 'true' }),
      h('i', { class: 'pv-btn pv-vol', 'aria-hidden': 'true' }),
      h('i', { class: 'pv-btn pv-vol2', 'aria-hidden': 'true' }),
    );
    const el = h('figure', { class: 'pv-device', 'aria-label': `Превью, ${LANG_NAME[lang]}` }, phone);
    if (this.all) el.append(h('figcaption', { class: 'pv-caption mono', text: `${LANG_LABEL[lang]} · ${LANG_NAME[lang]}` }));
    const d: Device = { lang, el, phone, screen, promo, track, own, slides: track.children.length, index: 0 };
    this.fillStrings(d);
    this.swipe(d);
    return d;
  }

  private fillStrings(d: Device) {
    const s = STRINGS[d.lang] as unknown as Record<string, string | string[]>;
    d.screen.setAttribute('lang', d.lang);
    d.own.setAttribute('aria-label', `Баннер, ${LANG_NAME[d.lang]}`);
    for (const el of d.screen.querySelectorAll<HTMLElement>('[data-s]')) {
      const [key, i] = el.dataset.s!.split('.');
      const v = s[key];
      el.textContent = (Array.isArray(v) ? v[Number(i)] : v) ?? '';
    }
  }

  /* ---------- carousel ---------- */

  private go(d: Device, index: number) {
    d.index = Math.max(0, Math.min(d.slides - 1, index));
    d.track.style.transform = `translateX(${-d.index * (SLOT.w + SLOT.gap)}px)`;
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
      const max = (d.slides - 1) * step;
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
