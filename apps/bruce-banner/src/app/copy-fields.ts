/**
 * Text fields for one or more copy slots in every enabled language, side by side: the inspector
 * and the floating editor share them. Typing is one undo step per focus; Uzbek gets its ‘ on the
 * fly; each language shows whether it fits and whether an AI wrote it.
 */
import { LANG_LABEL, normalizeUz, setText, slotLabel, type FitStatus, type Lang, type SlotKey } from '../engine';
import { h } from './dom';
import type { Editor } from './state';

export interface SlotSpec {
  key: SlotKey;
  label?: string;
  /** titles take line breaks, badges and numbers are one line */
  multiline: boolean;
  /** the text layer whose fit status applies */
  layerId?: string;
  placeholder?: Partial<Record<Lang, string>>;
}

const STATUS_TEXT: Record<FitStatus, string> = { ok: 'Влезает', shrunk: 'Уменьшен, чтобы влезть', overflow: 'Не влезает', empty: 'Пусто' };

export class CopyFields {
  readonly el: HTMLElement;
  private inputs: { key: SlotKey; lang: Lang; input: HTMLTextAreaElement | HTMLInputElement; status: HTMLElement; ai: HTMLElement; spec: SlotSpec }[] = [];

  constructor(
    private editor: Editor,
    slots: SlotSpec[],
    opts: { onEnter?: () => void } = {},
  ) {
    this.el = h('div', { class: 'copy-fields' });
    const doc = editor.doc!;
    for (const spec of slots) {
      const group = h('div', { class: 'copy-slot' });
      if (slots.length > 1 || spec.label) group.append(h('div', { class: 'copy-slot-label caps', text: spec.label ?? slotLabel(spec.key) }));
      for (const lang of doc.languages.enabled) {
        const id = `cf-${spec.key}-${lang}-${Math.random().toString(36).slice(2, 6)}`;
        const input = spec.multiline ? h('textarea', { class: 'field copy-input', rows: 1, id, spellcheck: 'true', lang }) : h('input', { class: 'field copy-input', id, type: 'text', spellcheck: 'true', lang });
        input.placeholder = spec.placeholder?.[lang] ?? '';
        const status = h('span', { class: 'copy-status', 'aria-live': 'polite' });
        const ai = h('span', { class: 'copy-ai', text: 'AI', title: 'Текст написал AI, проверьте' });
        const row = h('div', { class: 'copy-row', 'data-lang': lang }, h('label', { class: 'copy-lang mono', for: id, text: LANG_LABEL[lang] }), input, ai, status);
        group.append(row);
        input.addEventListener('focus', () => {
          this.editor.begin();
          if (this.editor.lang !== lang) this.editor.setLang(lang);
        });
        input.addEventListener('input', () => {
          if (lang === 'uz') {
            const fixed = normalizeUz(input.value);
            if (fixed !== input.value) {
              const pos = input.selectionStart;
              input.value = fixed;
              input.setSelectionRange(pos, pos);
            }
          }
          if (input instanceof HTMLTextAreaElement) autosize(input);
          this.editor.live((d) => setText(d, spec.key, lang, input.value, 'user'));
        });
        input.addEventListener('blur', () => this.editor.end());
        input.addEventListener('keydown', (e) => {
          const ke = e as KeyboardEvent;
          if (ke.key === 'Enter' && (!spec.multiline || ke.metaKey || ke.ctrlKey)) {
            ke.preventDefault();
            opts.onEnter?.();
          }
          if (ke.key === 'Escape') {
            (input as HTMLElement).blur();
          }
        });
        this.inputs.push({ key: spec.key, lang, input, status, ai, spec });
      }
      this.el.append(group);
    }
    this.sync();
  }

  /** Pulls values (except the field being typed in) and statuses from the document. */
  sync() {
    const doc = this.editor.doc;
    if (!doc) return;
    for (const f of this.inputs) {
      const slot = doc.copy[f.key];
      const value = slot?.[f.lang] ?? '';
      if (document.activeElement !== f.input && f.input.value !== value) f.input.value = value;
      if (f.input instanceof HTMLTextAreaElement) autosize(f.input);
      f.ai.hidden = slot?.src[f.lang] !== 'ai';
      let st: FitStatus = value.trim() ? 'ok' : 'empty';
      if (f.spec.layerId && value.trim()) st = this.editor.layout(f.lang)?.texts[f.spec.layerId]?.status ?? st;
      f.status.dataset.status = st;
      f.status.title = STATUS_TEXT[st];
      f.status.setAttribute('aria-label', `${LANG_LABEL[f.lang]}: ${STATUS_TEXT[st]}`);
    }
  }

  focus(lang: Lang) {
    const f = this.inputs.find((x) => x.lang === lang) ?? this.inputs[0];
    if (!f) return;
    f.input.focus();
    const len = f.input.value.length;
    f.input.setSelectionRange(len, len);
  }
}

function autosize(t: HTMLTextAreaElement) {
  t.style.height = 'auto';
  t.style.height = `${Math.min(t.scrollHeight, 120)}px`;
}
