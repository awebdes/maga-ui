/**
 * Prompt card, ported from prototype/js/components.js (initPrompt): a textarea that grows with its
 * text up to a cap, a live counter, and ⌘/Ctrl+Enter to submit. Markup:
 *   <div class="prompt glass" data-max="400">
 *     <textarea class="field" rows="1"></textarea>
 *     <div class="prompt-row"> … <span class="prompt-count"></span> … </div>
 *   </div>
 * Emits `submit` with { value } on ⌘Enter (plain Enter too when `data-enter-submits`).
 */
import { $, emit } from './core';

export interface PromptApi {
  readonly value: string;
  set(v: string): void;
  focus(): void;
  fit(): void;
}

const prompts = new WeakMap<HTMLElement, PromptApi>();

export function initPrompt(el: HTMLElement): PromptApi {
  const existing = prompts.get(el);
  if (existing) return existing;
  const t = $<HTMLTextAreaElement>('textarea', el)!;
  const count = $('.prompt-count', el);
  const max = Number(el.dataset.max ?? 400);
  const cap = Number(el.dataset.capHeight ?? 160);
  t.maxLength = max;
  const fit = () => {
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, cap) + 'px';
    t.style.overflowY = t.scrollHeight > cap ? 'auto' : 'hidden';
  };
  const upd = () => {
    if (count) count.textContent = `${t.value.length} / ${max}`;
    el.classList.toggle('has-text', t.value.trim().length > 0);
  };
  t.addEventListener('input', () => {
    fit();
    upd();
  });
  t.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const submit = e.metaKey || e.ctrlKey || (el.dataset.enterSubmits !== undefined && !e.shiftKey);
    if (!submit) return;
    e.preventDefault();
    emit(el, 'submit', { value: t.value.trim() });
  });
  window.addEventListener('resize', fit);
  requestAnimationFrame(fit);
  upd();
  const api: PromptApi = {
    get value() {
      return t.value.trim();
    },
    set(v: string) {
      t.value = v;
      fit();
      upd();
    },
    focus() {
      t.focus();
      t.setSelectionRange(t.value.length, t.value.length);
    },
    fit,
  };
  prompts.set(el, api);
  return api;
}

/**
 * Drop zone + file picker for images (the prototype's media tile, reduced to what the banner
 * editor needs). Emits `file` with { file } for a picked or dropped image.
 */
export function initDrop(el: HTMLElement, opts: { accept?: string } = {}) {
  if (el.dataset.dropReady) return;
  el.dataset.dropReady = '1';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = opts.accept ?? 'image/png,image/jpeg,image/webp';
  input.hidden = true;
  el.appendChild(input);
  const pick = (file: File | undefined) => {
    if (file) emit(el, 'file', { file });
  };
  el.addEventListener('click', (e) => {
    if (e.target !== input) input.click();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener('change', () => {
    pick(input.files?.[0]);
    input.value = '';
  });
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.classList.add('is-over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('is-over'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('is-over');
    pick(e.dataTransfer?.files[0]);
  });
}
