/**
 * Timeline: one row per object. Diamonds are whole-object keys; drag to retime (snaps to 0.05 s
 * and to the playhead, Shift for free, ⌥ drag copies), double-click a row to key it there.
 * Text rows show the in-animation as a bar: drag to move, pull the right edge to change length.
 */
import { initSeg } from '@kit/components';
import { EASES, addKey, keyAt, round3, sortKeys, type Ease, type Key, type TargetId, uid, cloneState } from './doc';
import type { Editor } from './editor';

const PAD = 12;
const fmt = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};

interface Row {
  id: TargetId;
  label: string;
  icon: string;
  kind: 'camera' | 'device' | 'text';
}

export class Timeline {
  private el: HTMLElement;
  private playBtn!: HTMLButtonElement;
  private loopBtn!: HTMLButtonElement;
  private timeEl!: HTMLElement;
  private keyBtn!: HTMLButtonElement;
  private easeWrap!: HTMLElement;
  private easeSeg!: ReturnType<typeof initSeg>;
  private labels!: HTMLElement;
  private tracks!: HTMLElement;
  private ruler!: HTMLElement;
  private rowsEl!: HTMLElement;
  private playhead!: HTMLElement;
  private width = 600;

  constructor(
    private ed: Editor,
    private hooks: { togglePlay: () => void; keySelection: () => void },
  ) {
    this.el = document.getElementById('timeline')!;
    this.build();
    new ResizeObserver(() => {
      this.width = this.tracks.clientWidth;
      this.render();
    }).observe(this.tracks);
  }

  private build() {
    this.el.innerHTML = `
      <div class="tl-head">
        <button class="cell clear icon-btn" data-r="play" data-tip="Play" data-kbd="Space" aria-label="Play"><svg class="i"><use href="#i-play"/></svg></button>
        <button class="cell clear icon-btn" data-r="loop" data-tip="Loop" aria-label="Loop" aria-pressed="true"><svg class="i"><use href="#i-loop"/></svg></button>
        <span class="tl-time mono" data-r="time"></span>
        <button class="cell ghost sm tl-key-btn" data-r="key" data-tip="Key the selection at the playhead" data-kbd="K"><svg class="i i-sm"><use href="#i-key"/></svg><span>Key</span></button>
        <button class="cell clear icon-btn sm" data-r="prev" data-tip="Previous key" data-kbd="J" aria-label="Previous key"><svg class="i i-sm" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
        <button class="cell clear icon-btn sm" data-r="next" data-tip="Next key" data-kbd="L" aria-label="Next key"><svg class="i i-sm" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>
        <div class="tl-ease" data-r="ease" hidden>
          <span class="caps">Arrive</span>
          <div class="seg" data-r="easeseg" aria-label="How motion arrives at the key">${EASES.map((e) => `<button data-value="${e.id}">${e.label}</button>`).join('')}</div>
          <button class="cell clear icon-btn sm" data-r="delkey" data-tip="Delete key" data-kbd="⌫" aria-label="Delete key"><svg class="i i-sm"><use href="#i-trash"/></svg></button>
        </div>
        <span class="spacer"></span>
      </div>
      <div class="tl-body">
        <div class="tl-labels" data-r="labels"></div>
        <div class="tl-tracks" data-r="tracks">
          <div class="tl-ruler" data-r="ruler"></div>
          <div class="tl-rows" data-r="rows"></div>
          <div class="tl-playhead" data-r="playhead"></div>
        </div>
      </div>`;
    const r = <T extends HTMLElement>(n: string) => this.el.querySelector(`[data-r="${n}"]`) as T;
    this.playBtn = r('play');
    this.loopBtn = r('loop');
    this.timeEl = r('time');
    this.keyBtn = r('key');
    this.easeWrap = r('ease');
    this.labels = r('labels');
    this.tracks = r('tracks');
    this.ruler = r('ruler');
    this.rowsEl = r('rows');
    this.playhead = r('playhead');
    this.easeSeg = initSeg(r('easeseg'));

    this.playBtn.addEventListener('click', () => this.hooks.togglePlay());
    this.loopBtn.addEventListener('click', () => {
      this.ed.loop = !this.ed.loop;
      this.loopBtn.setAttribute('aria-pressed', String(this.ed.loop));
    });
    this.keyBtn.addEventListener('click', () => this.hooks.keySelection());
    r('prev').addEventListener('click', () => this.jumpKey(-1));
    r('next').addEventListener('click', () => this.jumpKey(1));
    r('easeseg').addEventListener('change', (e) => {
      const f = this.ed.findKey(this.ed.selKey);
      if (!f) return;
      this.ed.change(() => (f.key.ease = (e as CustomEvent).detail.value as Ease), { commit: true });
    });
    r('delkey').addEventListener('click', () => this.deleteKey());

    // scrub on the ruler and on empty row space
    this.tracks.addEventListener('pointerdown', (e) => this.onTracksDown(e));
  }

  /* ---------- geometry ---------- */

  private get dur() {
    return this.ed.doc.format.duration;
  }
  private x(t: number) {
    return PAD + (t / this.dur) * (this.width - PAD * 2);
  }
  private t(x: number) {
    return Math.min(this.dur, Math.max(0, ((x - PAD) / (this.width - PAD * 2)) * this.dur));
  }
  private localX(e: PointerEvent) {
    return e.clientX - this.tracks.getBoundingClientRect().left;
  }

  private rows(): Row[] {
    const p = this.ed.doc;
    return [
      { id: 'camera', label: 'Camera', icon: 'i-camera', kind: 'camera' },
      ...p.devices.map((d) => ({ id: d.id, label: d.name, icon: d.model === 'laptop' ? 'i-laptop' : d.model === 'tablet' ? 'i-tablet' : 'i-phone', kind: 'device' as const })),
      ...p.texts.map((t) => ({ id: t.id, label: t.name, icon: 'i-text', kind: 'text' as const })),
    ];
  }

  /* ---------- render ---------- */

  render() {
    const ed = this.ed;
    const rows = this.rows();
    // ruler
    const step = this.dur > 16 ? 2 : this.dur > 8 ? 1 : 0.5;
    let html = '';
    for (let t = 0; t <= this.dur + 1e-6; t += step) {
      const major = Math.abs(t - Math.round(t)) < 1e-6 && (step < 2 || Math.round(t) % 2 === 0);
      html += `<div class="tl-tick${major ? ' major' : ''}" style="left:${this.x(t)}px">${major ? `<span>${Math.round(t)}s</span>` : ''}</div>`;
    }
    this.ruler.innerHTML = html;

    this.labels.innerHTML = '';
    this.rowsEl.innerHTML = '';
    for (const row of rows) {
      const sel = ed.sel === row.id;
      const lab = document.createElement('div');
      lab.className = 'tl-label';
      lab.setAttribute('aria-selected', String(sel));
      lab.innerHTML = `<svg class="i"><use href="#${row.icon}"/></svg><span></span>`;
      lab.querySelector('span')!.textContent = row.label;
      lab.addEventListener('pointerdown', () => ed.select(row.id));
      this.labels.append(lab);

      const tr = document.createElement('div');
      tr.className = 'tl-row';
      tr.dataset.id = row.id;
      tr.setAttribute('aria-selected', String(sel));
      if (row.kind === 'text') {
        const t = ed.text(row.id)!;
        if (t.anim !== 'none') {
          const bar = document.createElement('div');
          bar.className = 'tl-bar';
          bar.style.left = this.x(t.start) + 'px';
          bar.style.width = Math.max(10, this.x(t.start + t.dur) - this.x(t.start)) + 'px';
          bar.innerHTML = `<span></span><i class="grip"></i>`;
          bar.querySelector('span')!.textContent = t.anim;
          bar.addEventListener('pointerdown', (e) => this.dragBar(e, row.id, (e.target as HTMLElement).classList.contains('grip')));
          tr.append(bar);
        }
      } else {
        const track = ed.track(row.id)!;
        const keys = track.keys as Key<unknown>[];
        for (let i = 1; i < keys.length; i++) {
          const seg = document.createElement('div');
          seg.className = 'tl-seg';
          seg.style.left = this.x(keys[i - 1].t) + 'px';
          seg.style.width = Math.max(0, this.x(keys[i].t) - this.x(keys[i - 1].t)) + 'px';
          tr.append(seg);
        }
        if (row.kind === 'device') {
          const d = ed.device(row.id)!;
          if (d.float.amp > 0 || d.spin !== 0) {
            const m = document.createElement('div');
            m.className = 'tl-mod';
            m.style.left = this.x(0) + 'px';
            m.style.right = PAD + 'px';
            m.title = 'Float / spin modifier';
            tr.append(m);
          }
        }
        for (const k of keys) {
          const kd = document.createElement('div');
          kd.className = 'tl-keyf';
          kd.dataset.key = k.id;
          kd.dataset.ease = k.ease;
          kd.style.left = this.x(k.t) + 'px';
          kd.setAttribute('aria-selected', String(ed.selKey === k.id));
          kd.title = `${k.t.toFixed(2)} s · ${k.ease}`;
          kd.addEventListener('pointerdown', (e) => this.dragKey(e, row.id, k.id));
          kd.addEventListener('dblclick', () => ed.setTime(k.t));
          tr.append(kd);
        }
        tr.addEventListener('dblclick', (e) => {
          if ((e.target as HTMLElement).closest('.tl-keyf')) return;
          const t = this.snapT(this.t(this.localX(e as PointerEvent)), false);
          ed.change(() => {
            const k = addKey(ed.track(row.id) as never, t) as Key<unknown>;
            ed.selKey = k.id;
          }, { commit: true });
          ed.setTime(t);
        });
      }
      this.rowsEl.append(tr);
    }
    const end = document.createElement('div');
    end.className = 'tl-end';
    end.style.width = PAD + 'px';
    this.rowsEl.append(end);
    this.updateHead();
    this.updatePlayhead();
  }

  updatePlayhead() {
    this.playhead.style.transform = `translateX(${this.x(this.ed.time)}px)`;
    this.timeEl.innerHTML = `<b>${fmt(this.ed.time)}</b> / ${fmt(this.dur)}`;
    this.updateKeyBtn();
  }

  updateHead() {
    const ed = this.ed;
    this.playBtn.innerHTML = `<svg class="i"><use href="#${ed.playing ? 'i-pause' : 'i-play'}"/></svg>`;
    this.playBtn.dataset.tip = ed.playing ? 'Pause' : 'Play';
    const f = ed.findKey(ed.selKey);
    this.easeWrap.hidden = !f;
    if (f) this.easeSeg.set(f.key.ease, { silent: true });
    this.updateKeyBtn();
  }

  private updateKeyBtn() {
    const tr = this.ed.track(this.ed.sel);
    this.keyBtn.disabled = !tr;
    const on = !!tr && !!keyAt(tr.keys as Key<unknown>[], this.ed.time);
    this.keyBtn.classList.toggle('is-on', on);
    this.keyBtn.querySelector('span')!.textContent = on ? 'Keyed' : 'Key';
  }

  /* ---------- interactions ---------- */

  private snapT(t: number, free: boolean) {
    if (free) return round3(t);
    const ph = this.ed.time;
    if (Math.abs(this.x(t) - this.x(ph)) < 6) return ph;
    return round3(Math.round(t / 0.05) * 0.05);
  }

  private onTracksDown(e: PointerEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('.tl-keyf, .tl-bar')) return;
    const row = target.closest<HTMLElement>('.tl-row');
    if (row?.dataset.id && e.detail < 2) this.ed.select(row.dataset.id);
    else if (!row && this.ed.selKey) this.ed.select(this.ed.sel);
    if (this.ed.playing) this.hooks.togglePlay();
    const scrub = (ev: PointerEvent) => this.ed.setTime(ev.shiftKey ? this.t(this.localX(ev)) : this.snapFrame(this.t(this.localX(ev))));
    scrub(e);
    this.tracks.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => scrub(ev);
    const up = () => {
      this.tracks.removeEventListener('pointermove', move);
      this.tracks.removeEventListener('pointerup', up);
      this.tracks.removeEventListener('pointercancel', up);
    };
    this.tracks.addEventListener('pointermove', move);
    this.tracks.addEventListener('pointerup', up);
    this.tracks.addEventListener('pointercancel', up);
  }

  private snapFrame(t: number) {
    const fps = this.ed.doc.format.fps;
    return Math.round(t * fps) / fps;
  }

  private dragKey(e: PointerEvent, owner: TargetId, keyId: string) {
    e.stopPropagation();
    if (e.button !== 0) return;
    const ed = this.ed;
    const track = ed.track(owner)!;
    let key = (track.keys as Key<unknown>[]).find((k) => k.id === keyId)!;
    if (e.altKey) {
      const copy = { ...key, id: uid('k'), s: cloneState(key.s) } as Key<never>;
      (track.keys as Key<unknown>[]).push(copy);
      key = copy;
    }
    ed.sel = owner;
    ed.selKey = key.id;
    ed.emit('sel');
    const x0 = e.clientX;
    const t0 = key.t;
    let moved = false;
    // rows are rebuilt on every change, so follow the pointer on the window
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      moved = true;
      const t = this.snapT(t0 + ((ev.clientX - x0) / (this.width - PAD * 2)) * this.dur, ev.shiftKey);
      key.t = Math.min(this.dur, Math.max(0, t));
      sortKeys(track.keys as Key<unknown>[]);
      ed.time = key.t;
      ed.emit('doc');
      ed.emit('time');
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!moved) ed.setTime(key.t);
      ed.commit();
      this.render();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  private dragBar(e: PointerEvent, id: string, resize: boolean) {
    e.stopPropagation();
    const ed = this.ed;
    ed.select(id);
    const t = ed.text(id)!;
    const x0 = e.clientX;
    const s0 = t.start;
    const d0 = t.dur;
    const move = (ev: PointerEvent) => {
      const dt = ((ev.clientX - x0) / (this.width - PAD * 2)) * this.dur;
      if (resize) t.dur = Math.max(0.1, this.snapT(d0 + dt, ev.shiftKey));
      else t.start = Math.min(this.dur - 0.1, Math.max(0, this.snapT(s0 + dt, ev.shiftKey)));
      ed.time = Math.min(this.dur, t.start + t.dur);
      ed.emit('doc');
      ed.emit('time');
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      ed.commit();
      this.render();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  deleteKey() {
    const ed = this.ed;
    const f = ed.findKey(ed.selKey);
    if (!f) return false;
    ed.change(() => {
      const ks = f.track.keys as Key<unknown>[];
      const i = ks.findIndex((k) => k.id === f.key.id);
      // the last key's pose becomes the static pose
      if (ks.length === 1) (f.track as { base: unknown }).base = cloneState(f.key.s);
      ks.splice(i, 1);
      ed.selKey = null;
    }, { commit: true });
    return true;
  }

  jumpKey(dir: 1 | -1) {
    const ed = this.ed;
    const tr = ed.track(ed.sel);
    const all = tr ? (tr.keys as Key<unknown>[]).map((k) => k.t) : [ed.doc.camera.keys, ...ed.doc.devices.map((d) => d.keys)].flat().map((k) => k.t);
    const ts = [...new Set(all)].sort((a, b) => a - b);
    const t = dir > 0 ? ts.find((x) => x > ed.time + 1e-4) : [...ts].reverse().find((x) => x < ed.time - 1e-4);
    if (t !== undefined) ed.setTime(t);
  }
}
