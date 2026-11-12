/**
 * The library in the editor: the open banner's status next to its name, a save pushed to the team
 * a moment after it lands in this browser, and a choice when a colleague saved in between.
 */
import type { BannerDoc } from '../engine';
import { pop, toast } from '../ui/kit/core';
import { h, icon } from './dom';
import { LibraryError, STATUS_LABEL, fetchFromTeam, identity, listTeam, pushToTeam, setTeamStatus, syncedVersion, type Status, type TeamBanner } from './library';
import type { Editor } from './state';

const PUSH_DELAY = 2500;

export class Team {
  /** the library as the last list showed it */
  readonly index = new Map<string, TeamBanner>();
  private timer = 0;
  private pending: { doc: BannerDoc; thumb: Blob | null } | null = null;
  private chain: Promise<void> = Promise.resolve();
  private statusBtn: HTMLButtonElement;
  private statusMenu: HTMLElement;
  private bar: HTMLElement;

  constructor(
    private editor: Editor,
    private hooks: { reopen(doc: BannerDoc): void; note(text: string, tip?: string): void },
  ) {
    this.statusBtn = h('button', { class: 'cell clear st-btn', 'aria-haspopup': 'menu', 'aria-controls': 'st-menu', 'data-tip': 'Статус в библиотеке команды' }, h('span', { class: 'st-pill' }));
    this.statusMenu = h(
      'div',
      { class: 'menu below', id: 'st-menu', role: 'menu', style: 'width:220px' },
      ...(Object.keys(STATUS_LABEL) as Status[]).map((s) => {
        const b = h('button', { class: 'menu-item', role: 'menuitem', 'data-status': s }, h('span', { class: `st-dot is-${s}` }), h('span', { text: STATUS_LABEL[s] }));
        b.addEventListener('click', () => {
          pop.closeAll();
          void this.setStatus(s);
        });
        return b;
      }),
    );
    this.statusBtn.addEventListener('click', () => pop.toggle(this.statusMenu, this.statusBtn));
    const island = document.querySelector('#home-btn')!.parentElement!;
    island.insertBefore(h('span', { class: 'bar-sep st-sep', 'aria-hidden': 'true' }), island.querySelector('#home-btn')!.nextSibling);
    island.insertBefore(this.statusBtn, island.querySelector('.st-sep')!.nextSibling);
    island.append(this.statusMenu);
    this.bar = h('div', { class: 'conflict-bar glass', role: 'alert', hidden: true });
    document.querySelector('#status')!.parentElement!.append(this.bar);
    editor.subscribe(() => this.render());
  }

  async list() {
    const all = await listTeam();
    this.index.clear();
    for (const b of all) this.index.set(b.id, b);
    return all;
  }

  /** The library has a newer save than this browser's copy (or this browser has none). */
  needsFetch(id: string, hasLocal: boolean) {
    if (!identity.ready()) return false;
    if (!hasLocal) return true;
    const known = this.index.get(id);
    return !!known && known.version > (syncedVersion(id) ?? 0);
  }

  async fetch(id: string) {
    const r = await fetchFromTeam(id);
    this.index.set(id, { ...r.banner, thumbUrl: this.index.get(id)?.thumbUrl ?? null });
    return r.doc;
  }

  /** Called after each local save: the latest copy goes to the library a moment later. */
  pushLater(doc: BannerDoc, thumb: Blob | null) {
    if (!identity.ready()) return;
    this.pending = { doc, thumb };
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), PUSH_DELAY);
  }

  flush(force = false): Promise<void> {
    clearTimeout(this.timer);
    this.chain = this.chain.then(async () => {
      const job = this.pending;
      this.pending = null;
      if (!job) return;
      try {
        const banner = await pushToTeam(job.doc, job.thumb, force);
        this.index.set(banner.id, { ...banner, thumbUrl: this.index.get(banner.id)?.thumbUrl ?? null });
        if (this.editor.doc?.id === banner.id) {
          this.hideConflict();
          this.hooks.note('В библиотеке команды');
        }
        this.render();
      } catch (e) {
        const err = e as LibraryError;
        if (err.code === 'conflict' && err.current) this.showConflict(job.doc, err.current);
        else this.hooks.note('Только в этом браузере', `Библиотека: ${err.message}`);
      }
    });
    return this.chain;
  }

  private showConflict(doc: BannerDoc, current: TeamBanner) {
    if (this.editor.doc?.id !== doc.id) return;
    const when = new Date(current.updated_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
    const theirs = h('button', { class: 'cell sm', text: `Открыть версию: ${current.updated_by ?? 'коллега'}` });
    const mine = h('button', { class: 'cell sm primary', text: 'Оставить мою' });
    theirs.addEventListener('click', async () => {
      this.hideConflict();
      try {
        this.hooks.reopen(await this.fetch(doc.id));
      } catch (e) {
        toast('Не открылось', (e as Error).message, 'error');
      }
    });
    mine.addEventListener('click', () => {
      this.hideConflict();
      this.pending = { doc: this.editor.doc ?? doc, thumb: null };
      void this.flush(true);
    });
    this.bar.replaceChildren(icon('i-warn', 'i i-sm'), h('span', { text: `${current.updated_by ?? 'Коллега'} изменил баннер в ${when}` }), theirs, mine);
    this.bar.hidden = false;
    this.hooks.note('Есть правка коллеги');
  }

  private hideConflict() {
    this.bar.hidden = true;
  }

  private async setStatus(status: Status) {
    const doc = this.editor.doc;
    if (!doc) return;
    try {
      // a banner the library has not seen yet goes there first
      if (!this.index.has(doc.id)) {
        this.pending = { doc, thumb: null };
        await this.flush();
      }
      const b = await setTeamStatus(doc.id, status);
      this.index.set(b.id, { ...b, thumbUrl: this.index.get(b.id)?.thumbUrl ?? null });
      this.render();
      toast(STATUS_LABEL[status], 'статус увидит вся команда');
    } catch (e) {
      toast('Статус не сменился', (e as Error).message, 'error');
    }
  }

  render() {
    const doc = this.editor.doc;
    const on = identity.ready() && !!doc;
    this.statusBtn.hidden = !on;
    (this.statusBtn.previousElementSibling as HTMLElement).hidden = !on;
    if (!on) {
      this.hideConflict();
      return;
    }
    if (this.bar.dataset.doc !== doc.id) {
      this.hideConflict();
      this.bar.dataset.doc = doc.id;
    }
    const status = this.index.get(doc.id)?.status ?? 'draft';
    const pill = this.statusBtn.querySelector('.st-pill')!;
    pill.className = `st-pill is-${status}`;
    pill.textContent = STATUS_LABEL[status];
    this.statusMenu.querySelectorAll<HTMLElement>('[data-status]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.status === status)));
  }
}
