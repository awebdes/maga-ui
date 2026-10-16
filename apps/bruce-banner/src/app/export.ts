/**
 * Export sheet: every enabled language at a glance with its problems, two size presets (the app's
 * @1x/@2x/@3x, and the legacy 4K long edge), PNG or JPG, one ZIP. Empty titles and overflow stop
 * the ZIP until you confirm; contrast never does.
 */
import { zipSync } from 'fflate';
import { LANG_LABEL, type Lang } from '../engine';
import { drawBanner, renderToBlob } from '../render/draw';
import { juice, kit, pop, toast } from '../ui/kit/core';
import { initSeg } from '../ui/kit/components';
import { download, h, icon, slug } from './dom';
import { LEGACY, fileName, plural, textsOf, type Format, type Preset } from './files';
import { exportBannerFile } from './storage';
import type { Editor } from './state';

const SCALES = [1, 2, 3];

export class ExportSheet {
  private preset: Preset = 'app';
  private format: Format = 'png';
  private busy = false;
  private override = false;
  private list: HTMLElement;
  private go: HTMLButtonElement;
  private goLabel: HTMLElement;
  private warn: HTMLElement;

  constructor(
    private editor: Editor,
    private sheet: HTMLElement,
    private openBtn: HTMLElement,
  ) {
    this.list = sheet.querySelector('#exp-langs')!;
    this.go = sheet.querySelector('#exp-zip')!;
    this.goLabel = this.go.querySelector('.label')!;
    this.warn = sheet.querySelector('#exp-warn')!;
    openBtn.addEventListener('click', () => this.toggle());
    sheet.querySelector('#exp-close')!.addEventListener('click', () => pop.close(sheet, { restore: true }));
    const presetSeg = sheet.querySelector<HTMLElement>('#exp-preset')!;
    initSeg(presetSeg);
    presetSeg.addEventListener('change', (e) => {
      this.preset = (e as CustomEvent<{ value: Preset }>).detail.value;
      this.renderInfo();
    });
    const fmtSeg = sheet.querySelector<HTMLElement>('#exp-format')!;
    initSeg(fmtSeg);
    fmtSeg.addEventListener('change', (e) => {
      this.format = (e as CustomEvent<{ value: Format }>).detail.value;
      this.renderInfo();
    });
    this.go.addEventListener('click', () => void this.zip());
    sheet.querySelector('#exp-copy')!.addEventListener('click', () => void this.copyTexts());
    sheet.querySelector('#exp-file')!.addEventListener('click', () => void this.saveFile());
    this.warn.querySelector('button')!.addEventListener('click', () => {
      this.override = true;
      this.renderInfo();
    });
  }

  toggle() {
    if (pop.isOpen(this.sheet)) {
      pop.close(this.sheet);
      return;
    }
    if (!this.editor.doc) return;
    this.override = false;
    pop.open(this.sheet, this.openBtn);
    this.render();
  }

  get isOpen() {
    return pop.isOpen(this.sheet);
  }

  /** Language rows with live thumbnails; called on open and on edits while open. */
  render() {
    const doc = this.editor.doc;
    if (!doc || !this.isOpen) return;
    this.list.replaceChildren();
    for (const lang of doc.languages.enabled) {
      const canvas = h('canvas', { 'aria-hidden': 'true' });
      drawBanner(canvas, doc, lang, 196);
      const issues = this.editor.issues(lang).filter((i) => i.severity !== 'hint');
      const state = issues.some((i) => i.severity === 'error') ? 'error' : issues.length ? 'warn' : 'ok';
      const one = h('button', { class: 'cell clear icon-btn sm', 'aria-label': `Скачать ${LANG_LABEL[lang]}`, 'data-tip': `Только ${LANG_LABEL[lang]}` }, icon('i-download', 'i i-sm'));
      one.addEventListener('click', () => void this.single(lang));
      this.list.append(
        h(
          'div',
          { class: 'exp-row', 'data-state': state },
          canvas,
          h('div', { class: 'exp-meta' }, h('span', { class: 'mono exp-lang', text: LANG_LABEL[lang] }), h('span', { class: 'exp-issues', text: issues.length ? issues.map((i) => i.message).join(' · ') : 'Всё в порядке' })),
          one,
        ),
      );
    }
    this.renderInfo();
  }

  private blockers() {
    const doc = this.editor.doc!;
    return doc.languages.enabled.flatMap((l) => this.editor.issues(l).filter((i) => i.severity === 'error'));
  }

  private renderInfo() {
    const doc = this.editor.doc;
    if (!doc) return;
    const n = doc.languages.enabled.length * (this.preset === 'app' ? SCALES.length : 1);
    const blockers = this.blockers();
    const blocked = blockers.length > 0 && !this.override;
    this.warn.hidden = blockers.length === 0;
    this.warn.querySelector('.t')!.textContent = blockers.map((b) => `${LANG_LABEL[b.lang]}: ${b.message}`).join(' · ');
    this.warn.querySelector('button')!.hidden = this.override;
    this.go.toggleAttribute('disabled', blocked || this.busy);
    if (!this.busy) this.goLabel.textContent = `Скачать ZIP · ${n} ${plural(n, 'файл', 'файла', 'файлов')}`;
    const meta = this.sheet.querySelector('#exp-meta')!;
    meta.textContent = this.preset === 'app' ? `${doc.format.w}×${doc.format.h}, ${doc.format.w * 2}×${doc.format.h * 2}, ${doc.format.w * 3}×${doc.format.h * 3}` : `${LEGACY.w}×${LEGACY.h}, как в старом Bruce Banner`;
  }

  private async single(lang: Lang) {
    const doc = this.editor.doc;
    if (!doc) return;
    const scale = this.preset === 'app' ? 3 : 1;
    const blob = await renderToBlob(doc, lang, scale, this.mime(), this.preset === 'legacy' ? LEGACY : undefined);
    download(blob, fileName(doc, lang, this.preset, scale, this.format));
  }

  private mime() {
    return this.format === 'jpg' ? ('image/jpeg' as const) : ('image/png' as const);
  }

  private async zip() {
    const doc = this.editor.doc;
    if (!doc || this.busy) return;
    this.busy = true;
    kit.busy = true;
    juice.hold(this.openBtn, true);
    this.go.classList.add('is-busy');
    const jobs: { lang: Lang; scale: number }[] = [];
    for (const lang of doc.languages.enabled) for (const scale of this.preset === 'app' ? SCALES : [1]) jobs.push({ lang, scale });
    const files: Record<string, Uint8Array> = {};
    try {
      let i = 0;
      for (const j of jobs) {
        this.goLabel.textContent = `Рисуем ${++i} из ${jobs.length}…`;
        this.go.style.setProperty('--p', String(i / jobs.length));
        const blob = await renderToBlob(doc, j.lang, j.scale, this.mime(), this.preset === 'legacy' ? LEGACY : undefined);
        files[fileName(doc, j.lang, this.preset, j.scale, this.format)] = new Uint8Array(await blob.arrayBuffer());
      }
      files['texts.txt'] = new TextEncoder().encode(textsOf(doc));
      // PNG and JPEG are compressed already: store
      const zip = zipSync(files, { level: 0 });
      download(new Blob([zip as BlobPart], { type: 'application/zip' }), `bruce-banner_${slug(doc.name)}.zip`);
      toast('ZIP готов', `${jobs.length} ${plural(jobs.length, 'файл', 'файла', 'файлов')} + тексты`);
    } catch (e) {
      toast('Не получилось собрать ZIP', (e as Error).message, 'error');
    } finally {
      this.busy = false;
      kit.busy = false;
      juice.hold(this.openBtn, false);
      this.go.classList.remove('is-busy');
      this.go.style.removeProperty('--p');
      this.renderInfo();
    }
  }

  private async copyTexts() {
    const doc = this.editor.doc;
    if (!doc) return;
    try {
      await navigator.clipboard.writeText(textsOf(doc));
      toast('Тексты скопированы', doc.languages.enabled.map((l) => LANG_LABEL[l]).join(' · '));
    } catch {
      toast('Буфер обмена недоступен', 'тексты лежат в ZIP, файл texts.txt', 'error');
    }
  }

  private async saveFile() {
    const doc = this.editor.doc;
    if (!doc) return;
    download(await exportBannerFile(doc), `${slug(doc.name)}.banner.json`);
  }
}

