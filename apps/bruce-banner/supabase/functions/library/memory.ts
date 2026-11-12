/**
 * The library in memory, for unit tests and the dev server (`VITE_LIBRARY_URL=/api/library`): the
 * same handler as production, files served and accepted at `<base>/<bucket>/<path>`.
 */
import type { BannerRow, ImageMeta, SaveInput, SaveResult, Status, Store } from './handler.ts';

export class MemoryStore implements Store {
  codes = new Set<string>();
  rows = new Map<string, BannerRow & { doc: unknown; deleted: boolean }>();
  images = new Map<string, ImageMeta & { by: string }>();
  files = new Map<string, { bytes: Uint8Array; type: string }>();
  private clock = 0;

  constructor(private fileBase: string) {}

  private now() {
    // strictly increasing, so «updated last» is stable within one millisecond
    this.clock = Math.max(this.clock + 1, Date.now());
    return new Date(this.clock).toISOString();
  }

  private bare(r: BannerRow & { doc: unknown; deleted: boolean }): BannerRow {
    const { doc: _doc, deleted: _deleted, ...row } = r;
    return row;
  }

  async codeOk(hash: string) {
    return this.codes.has(hash);
  }

  async list() {
    return [...this.rows.values()].filter((r) => !r.deleted).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((r) => this.bare(r));
  }

  async get(id: string) {
    const r = this.rows.get(id);
    return r && !r.deleted ? { ...this.bare(r), doc: structuredClone(r.doc) } : null;
  }

  async save(input: SaveInput, base: number | null): Promise<SaveResult> {
    const cur = this.rows.get(input.id);
    const live = cur && !cur.deleted ? cur : undefined;
    if (live && live.version !== base) return { ok: false, current: this.bare(live) };
    const at = this.now();
    const row = {
      id: input.id,
      name: input.name,
      template: input.template,
      theme: input.theme,
      status: (live?.status ?? 'draft') as Status,
      version: (cur?.version ?? 0) + 1,
      thumb: input.thumb ?? cur?.thumb ?? null,
      created_by: live?.created_by ?? input.by,
      updated_by: input.by,
      created_at: live?.created_at ?? at,
      updated_at: at,
      doc: structuredClone(input.doc),
      deleted: false,
    };
    this.rows.set(input.id, row);
    return { ok: true, row: this.bare(row) };
  }

  async setStatus(id: string, status: Status, by: string) {
    const r = this.rows.get(id);
    if (!r || r.deleted) return null;
    Object.assign(r, { status, updated_by: by, updated_at: this.now() });
    return this.bare(r);
  }

  async remove(id: string) {
    const r = this.rows.get(id);
    if (!r || r.deleted) return false;
    r.deleted = true;
    return true;
  }

  async putThumb(id: string, bytes: Uint8Array, type: string) {
    const path = `${id}.${type === 'image/png' ? 'png' : 'webp'}`;
    this.files.set(`banner-thumbs/${path}`, { bytes, type });
    return path;
  }

  async signed(bucket: string, paths: string[]) {
    return Object.fromEntries(paths.filter((p) => this.files.has(`${bucket}/${p}`)).map((p) => [p, `${this.fileBase}/${bucket}/${p}`]));
  }

  async knownImages(refs: string[]) {
    return refs.filter((r) => this.images.has(r));
  }

  async uploadUrl(path: string) {
    return `${this.fileBase}/banner-images/${path}`;
  }

  async addImages(items: ImageMeta[], by: string) {
    for (const i of items) if (!this.images.has(i.ref)) this.images.set(i.ref, { ...i, by });
  }
}
