/**
 * Coach: a short tour, ported from prototype/js/app.js (tour). A card with dots, back and next,
 * and a spotlight ring that springs from target to target. Steps name their target as a rect, so
 * a canvas region works as well as an element. Esc closes, arrows step.
 */
import { $$, kit } from './core';

export interface CoachStep {
  target: () => DOMRect | null;
  title: string;
  text: string;
}

export class Coach {
  private wrap: HTMLElement;
  private body: HTMLElement;
  private dots: HTMLElement;
  private back: HTMLButtonElement;
  private next: HTMLButtonElement;
  private count: HTMLElement;
  private spot: HTMLElement;
  private step = -1;
  private on = false;

  constructor(
    private steps: CoachStep[],
    private opts: { label: string; done?: string; onStop?: () => void },
  ) {
    this.wrap = el('div', 'coach-wrap');
    const card = el('div', 'coach glass');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', opts.label);
    const head = el('div', 'coach-head');
    this.dots = el('div', 'dots');
    const close = el('button', 'cell clear icon-btn coach-close') as HTMLButtonElement;
    close.setAttribute('aria-label', 'Закрыть');
    close.innerHTML = '<svg class="i"><use href="#i-close"/></svg>';
    head.append(this.dots, close);
    this.body = el('div', 'coach-body');
    this.body.setAttribute('aria-live', 'polite');
    const foot = el('div', 'coach-foot');
    this.back = el('button', 'cell sm clear') as HTMLButtonElement;
    this.back.textContent = 'Назад';
    this.count = el('span', 'caps coach-count');
    this.next = el('button', 'cell sm ghost') as HTMLButtonElement;
    foot.append(this.back, this.count, this.next);
    card.append(head, this.body, foot);
    this.wrap.append(card);
    this.spot = el('div', 'spot');
    this.spot.setAttribute('aria-hidden', 'true');
    document.body.append(this.spot, this.wrap);

    for (const [i, s] of steps.entries()) {
      const st = el('div', 'coach-step out-right');
      st.dataset.i = String(i);
      const t = el('h3', 'coach-title');
      t.textContent = s.title;
      const p = el('p', 'coach-text');
      p.textContent = s.text;
      st.append(t, p);
      this.body.append(st);
      this.dots.append(document.createElement('i'));
    }
    this.next.addEventListener('click', () => (this.step < this.steps.length - 1 ? this.go(this.step + 1) : this.stop()));
    this.back.addEventListener('click', () => this.step > 0 && this.go(this.step - 1));
    close.addEventListener('click', () => this.stop());
    window.addEventListener('resize', () => this.place());
    document.addEventListener(
      'keydown',
      (e) => {
        if (!this.on) return;
        if (e.key === 'Escape') this.stop();
        else if (e.key === 'ArrowRight') this.next.click();
        else if (e.key === 'ArrowLeft') this.back.click();
        else return;
        e.preventDefault();
        e.stopPropagation();
      },
      true,
    );
  }

  get isOn() {
    return this.on;
  }

  start() {
    this.on = true;
    kit.app?.classList.remove('chrome-hidden');
    $$('.chrome .float').forEach((f) => f.classList.add('is-pinned'));
    this.wrap.classList.add('is-open');
    this.spot.classList.add('is-on');
    this.go(0);
    setTimeout(() => this.next.focus({ preventScroll: true }), 300);
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    this.wrap.classList.remove('is-open');
    this.spot.classList.remove('is-on');
    $$('.chrome .float').forEach((f) => f.classList.remove('is-pinned'));
    this.opts.onStop?.();
  }

  private go(i: number) {
    this.step = i;
    $$('.coach-step', this.body).forEach((st, k) => {
      st.classList.toggle('out-left', k < i);
      st.classList.toggle('out-right', k > i);
      st.setAttribute('aria-hidden', String(k !== i));
    });
    $$('i', this.dots).forEach((d, k) => {
      d.classList.toggle('on', k === i);
      d.classList.toggle('done', k < i);
    });
    this.back.style.visibility = i === 0 ? 'hidden' : 'visible';
    this.next.textContent = i === this.steps.length - 1 ? (this.opts.done ?? 'Готово') : 'Дальше';
    this.count.textContent = `${i + 1} / ${this.steps.length}`;
    this.place();
  }

  /** The ring around the target; the card next to it, below when there is room, else above. */
  place() {
    if (!this.on) return;
    const r = this.steps[this.step].target();
    if (!r) return;
    const pad = 6;
    this.spot.style.transform = `translate(${r.left - pad}px, ${r.top - pad}px)`;
    this.spot.style.width = `${r.width + pad * 2}px`;
    this.spot.style.height = `${r.height + pad * 2}px`;
    const card = this.wrap.getBoundingClientRect();
    const w = card.width || 340;
    const h = card.height || 190;
    const clampX = (x: number) => Math.max(12, Math.min(innerWidth - w - 12, x));
    const clampY = (y: number) => Math.max(12, Math.min(innerHeight - h - 12, y));
    let left = clampX(r.left + r.width / 2 - w / 2);
    let top = r.bottom + 18;
    if (top + h > innerHeight - 12) top = r.top - 18 - h;
    if (top < 12) {
      // a tall target (a side panel): beside it, never over it
      top = clampY(r.top + r.height / 2 - h / 2);
      left = r.left - 18 - w >= 12 ? r.left - 18 - w : r.right + 18 + w <= innerWidth - 12 ? r.right + 18 : left;
    }
    this.wrap.style.left = `${left}px`;
    this.wrap.style.top = `${top}px`;
  }
}

function el(tag: string, cls: string) {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
