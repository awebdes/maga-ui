/**
 * The start: describe the banner in a sentence (AI does the rest), or pick an official template,
 * or reopen one of yours. Templates show at their real size in the app: 328×106.
 */
import { GROUPS, TEMPLATES, docFromTemplate, type Lang } from '../engine';
import { drawBanner } from '../render/draw';
import { pop } from '../ui/kit/core';
import { initPrompt, type PromptApi } from '../ui/kit/prompt';
import { ago, h, icon } from './dom';
import { STATUS_LABEL, type TeamBanner } from './library';
import { listProjects, loadThumb } from './storage';

export interface HomeHooks {
  brief(text: string): void;
  openTemplate(id: string): void;
  openProject(id: string): void;
  duplicateProject(id: string): void;
  deleteProject(id: string): void;
  exportProject(id: string): void;
  importFile(file: File): void;
  aiState(): 'live' | 'mock' | 'off' | 'loading';
  /** the team library, when this build has one */
  team?: {
    ready(): boolean;
    list(): Promise<TeamBanner[]>;
    join(name: string, code: string): Promise<void>;
  };
}

/** What a card needs: a local banner, or a library banner (status, who, its picture). */
interface CardData {
  id: string;
  name: string;
  updatedAt: number;
  status?: TeamBanner['status'];
  by?: string | null;
  thumbUrl?: string | null;
  localOnly?: boolean;
}

export const EXAMPLES = [
  'Кредит до 100 млн сум за 2 минуты, без справок',
  'Кэшбэк 5% на АЗС по карте Humo до 30 ноября',
  'Вклад «Omonat» — до 21% годовых в сумах, от 3 месяцев',
  'Visa Gold: платите по всему миру без комиссии',
];

export class Home {
  readonly prompt: PromptApi;
  private thumbs = new Map<string, string>();
  private lang: Lang = 'ru';

  constructor(
    private root: HTMLElement,
    private hooks: HomeHooks,
  ) {
    const promptEl = root.querySelector<HTMLElement>('#brief')!;
    this.prompt = initPrompt(promptEl);
    promptEl.addEventListener('submit', () => this.submit());
    root.querySelector('#brief-go')!.addEventListener('click', () => this.submit());
    const chips = root.querySelector('#brief-examples')!;
    for (const ex of EXAMPLES) {
      const b = h('button', { class: 'chip', text: ex });
      b.addEventListener('click', () => {
        this.prompt.set(ex);
        this.prompt.focus();
      });
      chips.append(b);
    }
    const file = root.querySelector<HTMLInputElement>('#import-file')!;
    root.querySelector('#import-btn')!.addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      if (file.files?.[0]) this.hooks.importFile(file.files[0]);
      file.value = '';
    });
  }

  private submit() {
    const text = this.prompt.value;
    if (text.length < 4) {
      this.prompt.focus();
      this.root.querySelector('#brief')!.classList.add('shake');
      setTimeout(() => this.root.querySelector('#brief')!.classList.remove('shake'), 500);
      return;
    }
    this.hooks.brief(text);
  }

  /** AI availability shows on the prompt itself. */
  renderAi() {
    const state = this.hooks.aiState();
    const el = this.root.querySelector<HTMLElement>('#brief')!;
    el.dataset.ai = state;
    const note = this.root.querySelector('#brief-note')!;
    note.textContent =
      state === 'off'
        ? 'AI сейчас недоступен — начните с шаблона ниже.'
        : state === 'mock'
          ? 'Демо-режим AI: ключ Gemini ещё не подключён, ответы — заготовки.'
          : 'AI напишет текст на русском, узбекском и английском и подберёт иллюстрацию.';
  }

  renderTemplates(lang: Lang = this.lang) {
    this.lang = lang;
    const wrap = this.root.querySelector('#templates')!;
    wrap.replaceChildren();
    for (const group of GROUPS) {
      const items = TEMPLATES.filter((t) => t.group === group);
      if (!items.length) continue;
      const row = h('div', { class: 'tpl-row' });
      for (const t of items) {
        const canvas = h('canvas', { 'aria-hidden': 'true' });
        drawBanner(canvas, docFromTemplate(t.id, { now: 0 }), lang, 328);
        const card = h('button', { class: 'tpl-card', 'data-template': t.id, 'aria-label': `Шаблон: ${t.label}` }, h('span', { class: 'tpl-img' }, canvas), h('span', { class: 'tpl-name', text: t.label }));
        card.addEventListener('click', () => this.hooks.openTemplate(t.id));
        row.append(card);
      }
      wrap.append(h('section', { class: 'tpl-group' }, h('h3', { class: 'tpl-title caps', text: group }), row));
    }
  }

  async renderProjects() {
    const local = await listProjects();
    const wrap = this.root.querySelector('#projects')!;
    const section = this.root.querySelector<HTMLElement>('#projects-section')!;
    const title = section.querySelector('.home-h2')!;
    const note = section.querySelector<HTMLElement>('#projects-note')!;
    note.hidden = true;
    const team = this.hooks.team;
    if (!team) {
      title.textContent = 'Мои баннеры';
      section.hidden = local.length === 0;
      wrap.replaceChildren(...(await Promise.all(local.slice(0, 24).map((m) => this.projectCard(m)))));
      return;
    }
    section.hidden = false;
    title.textContent = 'Баннеры команды';
    if (!team.ready()) {
      wrap.replaceChildren(this.joinCard());
      return;
    }
    let shared: TeamBanner[] = [];
    try {
      shared = await team.list();
    } catch (e) {
      note.hidden = false;
      note.textContent = `${(e as Error).message}. Показаны баннеры из этого браузера.`;
    }
    const ids = new Set(shared.map((b) => b.id));
    const cards: CardData[] = [
      ...shared.map((b) => ({ id: b.id, name: b.name, updatedAt: Date.parse(b.updated_at), status: b.status, by: b.updated_by, thumbUrl: b.thumbUrl })),
      ...local.filter((m) => !ids.has(m.id)).map((m) => ({ ...m, localOnly: true })),
    ];
    if (!cards.length) {
      wrap.replaceChildren(h('p', { class: 'proj-none', text: 'Пока пусто. Первый баннер, который вы сохраните, увидит вся команда.' }));
      return;
    }
    wrap.replaceChildren(...(await Promise.all(cards.slice(0, 60).map((m) => this.projectCard(m)))));
  }

  /** Name and team code, once per browser. */
  private joinCard() {
    const name = h('input', { class: 'field', autocomplete: 'name', 'aria-label': 'Ваше имя', placeholder: 'Ваше имя — его увидят коллеги' });
    const code = h('input', { class: 'field', type: 'password', autocomplete: 'off', 'aria-label': 'Код команды', placeholder: 'Код команды' });
    const err = h('p', { class: 'join-err', role: 'alert' });
    const go = h('button', { class: 'cell primary', type: 'submit' }, h('span', { text: 'Войти' }));
    const form = h(
      'form',
      { class: 'join-card' },
      h('div', { class: 'join-text' }, h('strong', { text: 'Общая библиотека' }), h('span', { text: 'Баннеры видит и правит вся команда, со статусами «черновик → на согласовании → утверждён». Код спросите у команды дизайна.' })),
      h('div', { class: 'join-fields' }, name, code, go),
      err,
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!name.value.trim() || !code.value.trim()) {
        err.textContent = 'Нужны имя и код';
        return;
      }
      go.disabled = true;
      err.textContent = '';
      try {
        await this.hooks.team!.join(name.value, code.value);
        await this.renderProjects();
      } catch (x) {
        err.textContent = (x as Error).message;
      } finally {
        go.disabled = false;
      }
    });
    return form;
  }

  private async projectCard(m: CardData) {
    let url = m.thumbUrl ?? this.thumbs.get(`${m.id}:${m.updatedAt}`);
    if (!url) {
      const blob = await loadThumb(m.id);
      if (blob) {
        url = URL.createObjectURL(blob);
        this.thumbs.set(`${m.id}:${m.updatedAt}`, url);
      }
    }
    const meta = m.status
      ? h('span', { class: 'proj-date' }, h('span', { class: `st-pill is-${m.status}`, text: STATUS_LABEL[m.status] }), h('span', { text: `${m.by ?? ''} · ${ago(m.updatedAt)}` }))
      : h('span', { class: 'proj-date', text: m.localOnly && this.hooks.team ? `только в этом браузере · ${ago(m.updatedAt)}` : ago(m.updatedAt) });
    const open = h('button', { class: 'proj-open', 'aria-label': `Открыть «${m.name}»` }, h('span', { class: 'proj-img' }, url ? h('img', { src: url, alt: '' }) : h('span', { class: 'proj-empty' })), h('span', { class: 'proj-name', text: m.name }), meta);
    open.addEventListener('click', () => this.hooks.openProject(m.id));
    const menuId = `pm-${m.id}`;
    const more = h('button', { class: 'cell clear icon-btn sm proj-more', 'aria-label': 'Ещё', 'aria-haspopup': 'menu', 'aria-controls': menuId }, icon('i-dots', 'i i-sm'));
    const item = (label: string, ic: string, fn: () => void, confirm?: string) => {
      const text = h('span', { text: label });
      const b = h('button', { class: `menu-item${confirm ? ' danger' : ''}` }, icon(ic), text);
      b.addEventListener('click', () => {
        // a destructive item asks once more in place instead of a modal
        if (confirm && !b.classList.contains('is-armed')) {
          b.classList.add('is-armed');
          text.textContent = confirm;
          return;
        }
        pop.closeAll();
        fn();
      });
      return b;
    };
    const menu = h(
      'div',
      { class: 'menu below-end', id: menuId, style: 'width:220px' },
      item('Дублировать', 'i-duplicate', () => this.hooks.duplicateProject(m.id)),
      item('Скачать файл баннера', 'i-file', () => this.hooks.exportProject(m.id)),
      h('div', { class: 'menu-sep' }),
      item(m.status ? 'Удалить у всех' : 'Удалить', 'i-trash', () => this.hooks.deleteProject(m.id), m.status ? 'Удалится у всей команды. Ещё раз' : 'Точно удалить? Нажмите ещё раз'),
    );
    more.addEventListener('click', () =>
      pop.toggle(menu, more, {
        onClose: () => {
          const armed = menu.querySelector('.is-armed');
          if (armed) {
            armed.classList.remove('is-armed');
            armed.querySelector('span')!.textContent = m.status ? 'Удалить у всех' : 'Удалить';
          }
        },
      }),
    );
    return h('div', { class: 'proj-card' }, open, more, menu);
  }
}
