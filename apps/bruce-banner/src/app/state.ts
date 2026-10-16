/**
 * The editor store: the document, the selection, the language being viewed and undo. Every edit
 * goes through `change` (one undo step) or a `begin` / `live` / `end` gesture (one step at the end),
 * as in Kiln. The language and the "all languages" view are view state: not in the document, not
 * in undo.
 */
import { History, layoutBanner, layoutIssues, numberIssues, type BannerDoc, type BannerLayout, type Issue, type Lang } from '../engine';
import { measure } from '../render/measure';

export interface EditorEvent {
  doc?: boolean;
  /** a running gesture (drag, slider, typing): no history step yet */
  live?: boolean;
  selection?: boolean;
  view?: boolean;
  /** the whole document was replaced (open, undo) */
  replaced?: boolean;
}

export type Mode = 'home' | 'variants' | 'editor' | 'preview';

export class Editor {
  doc: BannerDoc | null = null;
  selection: string | null = null;
  lang: Lang = 'ru';
  allLangs = false;
  mode: Mode = 'home';
  readonly history = new History<BannerDoc>();
  /** bumps on every document change: caches key on it */
  version = 0;
  private gestureStart: BannerDoc | null = null;
  private listeners = new Set<(e: EditorEvent) => void>();
  private layouts = new Map<string, BannerLayout>();
  private issueCache = new Map<string, Issue[]>();
  /** checks that need pixels (contrast), set by the app; mid-gesture the last result stands */
  pixelChecks: ((doc: BannerDoc, lang: Lang, lay: BannerLayout) => Issue[]) | null = null;
  private pixelCache = new Map<Lang, Issue[]>();

  subscribe(fn: (e: EditorEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: EditorEvent) {
    if (e.doc) {
      this.version++;
      this.layouts.clear();
      this.issueCache.clear();
    }
    this.listeners.forEach((fn) => fn(e));
  }

  /** Fonts finished loading: every cached width is stale. */
  invalidateLayout() {
    this.emit({ doc: true, live: true });
  }

  /** One undoable edit on a copy of the document. */
  change(fn: (draft: BannerDoc) => void) {
    if (!this.doc) return;
    if (this.gestureStart) this.end();
    const before = this.doc;
    const next = structuredClone(before);
    fn(next);
    if (JSON.stringify(next) === JSON.stringify(before)) return;
    next.updatedAt = Date.now();
    this.history.push(before);
    this.doc = next;
    this.pruneSelection();
    this.emit({ doc: true });
  }

  begin() {
    if (this.doc && !this.gestureStart) this.gestureStart = this.doc;
  }

  /**
   * A step of a gesture. `fromStart` applies `fn` to the document as it was when the gesture began
   * (absolute drags and scales: no drift), otherwise to the current one (nudges, typing).
   */
  live(fn: (draft: BannerDoc) => void, opts: { fromStart?: boolean } = {}) {
    if (!this.doc) return;
    this.begin();
    const next = structuredClone(opts.fromStart && this.gestureStart ? this.gestureStart : this.doc);
    fn(next);
    this.doc = next;
    this.emit({ doc: true, live: true });
  }

  end() {
    const start = this.gestureStart;
    this.gestureStart = null;
    if (start && this.doc && JSON.stringify(start) !== JSON.stringify(this.doc)) {
      this.doc.updatedAt = Date.now();
      this.history.push(start);
      this.emit({ doc: true });
    }
  }

  cancel() {
    const start = this.gestureStart;
    this.gestureStart = null;
    if (!start) return;
    this.doc = start;
    this.pruneSelection();
    this.emit({ doc: true });
  }

  get inGesture() {
    return this.gestureStart !== null;
  }

  /** Opens a document; history starts fresh for it. */
  open(doc: BannerDoc) {
    this.gestureStart = null;
    this.pixelCache.clear();
    this.history.clear();
    this.doc = doc;
    this.selection = null;
    if (!doc.languages.enabled.includes(this.lang)) this.lang = doc.languages.primary;
    this.emit({ doc: true, selection: true, replaced: true, view: true });
  }

  /** Replaces the document inside the session (a variant, an import). Undoable. */
  replace(doc: BannerDoc) {
    if (this.doc) this.history.push(this.doc);
    this.doc = doc;
    this.selection = null;
    this.emit({ doc: true, selection: true, replaced: true });
  }

  close() {
    this.doc = null;
    this.selection = null;
    this.history.clear();
    this.emit({ doc: true, selection: true, replaced: true });
  }

  undo() {
    if (!this.doc) return;
    const d = this.history.undo(this.doc);
    if (d) this.restore(d);
  }

  redo() {
    if (!this.doc) return;
    const d = this.history.redo(this.doc);
    if (d) this.restore(d);
  }

  private restore(d: BannerDoc) {
    this.gestureStart = null;
    this.doc = d;
    this.pruneSelection();
    this.emit({ doc: true, selection: true });
  }

  select(id: string | null) {
    if (id === this.selection) return;
    this.selection = id;
    this.emit({ selection: true });
  }

  setLang(lang: Lang) {
    if (lang === this.lang) return;
    this.lang = lang;
    this.emit({ view: true });
  }

  setAllLangs(on: boolean) {
    if (on === this.allLangs) return;
    this.allLangs = on;
    this.emit({ view: true });
  }

  setMode(mode: Mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.emit({ view: true });
  }

  /** Layout of the current document in a language, cached per version. */
  layout(lang: Lang = this.lang): BannerLayout | null {
    if (!this.doc) return null;
    let l = this.layouts.get(lang);
    if (!l) {
      l = layoutBanner(this.doc, lang, measure);
      this.layouts.set(lang, l);
    }
    return l;
  }

  /** Layout and number problems in a language. */
  issues(lang: Lang = this.lang): Issue[] {
    if (!this.doc) return [];
    let list = this.issueCache.get(lang);
    if (!list) {
      const lay = this.layout(lang)!;
      let px = this.pixelCache.get(lang) ?? [];
      if (this.pixelChecks && !this.gestureStart) {
        px = this.pixelChecks(this.doc, lang, lay);
        this.pixelCache.set(lang, px);
      }
      list = [...layoutIssues(this.doc, lay), ...numberIssues(this.doc, lang), ...px];
      this.issueCache.set(lang, list);
    }
    return list;
  }

  private pruneSelection() {
    if (this.selection && !this.doc?.layers.some((l) => l.id === this.selection)) {
      this.selection = null;
      this.emit({ selection: true });
    }
  }
}
