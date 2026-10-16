/**
 * The bottom island: which language the banner shows, how each language is doing (a dot per
 * language: fits, squeezed, does not fit), all languages at once, and the AI review notice.
 */
import { LANG_LABEL, LANGS, confirmLanguage, type Lang } from '../engine';
import { initSeg } from '../ui/kit/components';
import type { Editor } from './state';

export type LangState = 'ok' | 'hint' | 'warn' | 'error';

export class Dock {
  private seg: ReturnType<typeof initSeg>;
  private allBtn: HTMLElement;
  private review: HTMLElement;
  private reviewText: HTMLElement;

  constructor(
    private editor: Editor,
    private root: HTMLElement,
    private hooks: { translateAll(): void; aiEnabled(): boolean },
  ) {
    const segEl = root.querySelector<HTMLElement>('#lang-seg')!;
    this.seg = initSeg(segEl);
    segEl.addEventListener('change', (e) => this.editor.setLang((e as CustomEvent<{ value: Lang }>).detail.value));
    this.allBtn = root.querySelector('#all-langs')!;
    this.allBtn.addEventListener('change', (e) => this.editor.setAllLangs((e as CustomEvent<{ value: boolean }>).detail.value));
    this.review = root.querySelector('#review-chip')!;
    this.reviewText = this.review.querySelector('.review-text')!;
    this.review.querySelector('#review-ok')!.addEventListener('click', () => this.editor.change((d) => confirmLanguage(d, this.editor.lang)));
    root.querySelector('#translate-all')?.addEventListener('click', () => this.hooks.translateAll());
  }

  /** The worst problem in a language. */
  stateOf(lang: Lang): LangState {
    const list = this.editor.issues(lang);
    if (list.some((i) => i.severity === 'error')) return 'error';
    if (list.some((i) => i.severity === 'warn')) return 'warn';
    if (list.some((i) => i.severity === 'hint')) return 'hint';
    return 'ok';
  }

  render() {
    const doc = this.editor.doc;
    if (!doc) return;
    let changed = false;
    for (const lang of LANGS) {
      const btn = this.root.querySelector<HTMLElement>(`#lang-seg [data-value="${lang}"]`)!;
      const on = doc.languages.enabled.includes(lang);
      if (btn.hidden === on) {
        btn.hidden = !on;
        changed = true;
      }
      const st = on ? this.stateOf(lang) : 'ok';
      btn.dataset.state = st;
      const issues = this.editor.issues(lang).filter((i) => i.severity !== 'hint');
      btn.setAttribute('data-tip', issues.length ? `${LANG_LABEL[lang]}: ${issues.map((i) => i.message).join('; ')}` : `${LANG_LABEL[lang]}: всё влезает`);
    }
    if (this.seg.value !== this.editor.lang) this.seg.set(this.editor.lang, { silent: true });
    if (changed) requestAnimationFrame(() => this.seg.place(false));
    this.allBtn.setAttribute('aria-pressed', String(this.editor.allLangs));
    this.allBtn.toggleAttribute('disabled', doc.languages.enabled.length < 2);

    // AI-written copy in the language on screen waits for a human look
    const lang = this.editor.lang;
    const aiSlots = Object.values(doc.copy).filter((s) => s.src[lang] === 'ai' && s[lang].trim());
    this.review.hidden = aiSlots.length === 0;
    this.reviewText.textContent = `${LANG_LABEL[lang]} написан AI — проверьте`;
    const tr = this.root.querySelector<HTMLElement>('#translate-all');
    if (tr) tr.hidden = !this.hooks.aiEnabled() || doc.languages.enabled.length < 2;
  }
}
