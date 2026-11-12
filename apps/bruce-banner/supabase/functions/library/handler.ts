/**
 * The team library behind one Supabase Edge Function. Pure: a Request in, a Response out, the data
 * behind a `Store`, so vitest runs it in Node with a memory store and the dev server serves it for
 * the e2e. No imports, so Deno and Node read it alike.
 *
 * Every call is a POST of `{ op, ... }` with the team code in `x-team-code` and the person's name in
 * `x-team-name` (URI-encoded). The code is checked against sha256 hashes in `team_codes`; the
 * database itself is closed to the publishable key (RLS on, no policies), only this function's
 * service role reads and writes it.
 *
 * Saves are versioned: a save names the version it started from and gets 409 with the current row
 * when someone else saved in between, so nobody overwrites a colleague silently.
 */

export type Status = 'draft' | 'review' | 'approved';
export const STATUSES: Status[] = ['draft', 'review', 'approved'];

export interface BannerRow {
  id: string;
  name: string;
  template: string | null;
  theme: string | null;
  status: Status;
  version: number;
  thumb: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ImageMeta {
  ref: string;
  w?: number;
  h?: number;
  source?: 'ai' | 'upload';
  subject?: string;
}

export interface SaveInput {
  id: string;
  name: string;
  template: string | null;
  theme: string | null;
  doc: unknown;
  by: string;
  thumb: string | null;
}

export type SaveResult = { ok: true; row: BannerRow } | { ok: false; current: BannerRow };

export interface Store {
  codeOk(hash: string): Promise<boolean>;
  list(): Promise<BannerRow[]>;
  get(id: string): Promise<(BannerRow & { doc: unknown }) | null>;
  /** `base` null: a banner new to the library (a deleted one with the same id comes back) */
  save(input: SaveInput, base: number | null): Promise<SaveResult>;
  setStatus(id: string, status: Status, by: string): Promise<BannerRow | null>;
  remove(id: string): Promise<boolean>;
  putThumb(id: string, bytes: Uint8Array, type: string): Promise<string>;
  /** short-lived download URLs by storage path */
  signed(bucket: 'banner-images' | 'banner-thumbs', paths: string[]): Promise<Record<string, string>>;
  knownImages(refs: string[]): Promise<string[]>;
  uploadUrl(path: string): Promise<string>;
  addImages(items: ImageMeta[], by: string): Promise<void>;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-team-code, x-team-name',
  'access-control-max-age': '86400',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } });
const fail = (status: number, error: string, message: string, extra: Record<string, unknown> = {}) => json({ error, message, ...extra }, status);

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const REF = /^blob:[0-9a-f]{64}$/;
const MAX_DOC = 1_000_000;
const MAX_THUMB = 400_000;

export const refPath = (ref: string) => ref.slice('blob:'.length);

export async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Every image a document draws, by ref. */
export function docRefs(doc: unknown): string[] {
  const found = JSON.stringify(doc ?? null).match(/"blob:[0-9a-f]{64}"/g) ?? [];
  return [...new Set(found.map((s) => s.slice(1, -1)))];
}

function personName(req: Request) {
  try {
    return decodeURIComponent(req.headers.get('x-team-name') ?? '').trim().slice(0, 60) || 'Без имени';
  } catch {
    return 'Без имени';
  }
}

function b64Bytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function withThumbs(store: Store, rows: BannerRow[]) {
  const urls = await store.signed('banner-thumbs', rows.map((r) => r.thumb).filter((t): t is string => !!t));
  return rows.map((r) => ({ ...r, thumbUrl: r.thumb ? (urls[r.thumb] ?? null) : null }));
}

export async function handle(req: Request, store: Store): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return fail(405, 'bad_request', 'POST only');
  const code = (req.headers.get('x-team-code') ?? '').trim();
  if (!code || !(await store.codeOk(await sha256Hex(code)))) return fail(401, 'unauthorized', 'Нужен код команды');
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > MAX_DOC + MAX_THUMB * 2) return fail(413, 'bad_request', 'Слишком большой запрос');
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return fail(400, 'bad_request', 'Ожидался JSON');
  }
  const by = personName(req);
  const id = typeof body.id === 'string' ? body.id : '';

  switch (body.op) {
    case 'hello':
      return json({ ok: true, name: by });

    case 'list':
      return json({ banners: await withThumbs(store, await store.list()) });

    case 'get': {
      if (!ID.test(id)) return fail(400, 'bad_request', 'Нет id');
      const row = await store.get(id);
      if (!row) return fail(404, 'not_found', 'Баннер удалён или ещё не сохранён в библиотеке');
      const refs = docRefs(row.doc);
      const urls = await store.signed('banner-images', refs.map(refPath));
      return json({ banner: row, images: Object.fromEntries(refs.map((r) => [r, urls[refPath(r)] ?? null])) });
    }

    case 'save': {
      const doc = body.doc as { id?: unknown; name?: unknown; template?: unknown; theme?: unknown } | undefined;
      if (!doc || typeof doc.id !== 'string' || !ID.test(doc.id) || typeof doc.name !== 'string') return fail(400, 'bad_request', 'Нет документа');
      if (JSON.stringify(doc).length > MAX_DOC) return fail(413, 'bad_request', 'Баннер слишком большой');
      const base = typeof body.baseVersion === 'number' ? body.baseVersion : null;
      let thumb: string | null = null;
      if (typeof body.thumb === 'string' && body.thumb.length <= MAX_THUMB) {
        const type = body.thumbType === 'image/png' ? 'image/png' : 'image/webp';
        thumb = await store.putThumb(doc.id, b64Bytes(body.thumb), type);
      }
      const r = await store.save(
        { id: doc.id, name: doc.name.slice(0, 120), template: typeof doc.template === 'string' ? doc.template : null, theme: typeof doc.theme === 'string' ? doc.theme : null, doc, by, thumb },
        base,
      );
      if (!r.ok) return fail(409, 'conflict', `${r.current.updated_by ?? 'Кто-то'} уже изменил этот баннер`, { current: r.current });
      return json({ banner: r.row });
    }

    case 'status': {
      const status = body.status as Status;
      if (!ID.test(id) || !STATUSES.includes(status)) return fail(400, 'bad_request', 'Нет статуса');
      const row = await store.setStatus(id, status, by);
      return row ? json({ banner: row }) : fail(404, 'not_found', 'Баннера нет в библиотеке');
    }

    case 'delete':
      if (!ID.test(id)) return fail(400, 'bad_request', 'Нет id');
      return json({ ok: await store.remove(id) });

    case 'images.prepare': {
      const items = (Array.isArray(body.items) ? body.items : []) as ImageMeta[];
      const refs = [...new Set(items.map((i) => i?.ref).filter((r): r is string => typeof r === 'string' && REF.test(r)))].slice(0, 50);
      const known = new Set(await store.knownImages(refs));
      const upload: Record<string, string> = {};
      for (const ref of refs) if (!known.has(ref)) upload[ref] = await store.uploadUrl(refPath(ref));
      return json({ upload });
    }

    case 'images.commit': {
      const items = ((Array.isArray(body.items) ? body.items : []) as ImageMeta[]).filter((i) => typeof i?.ref === 'string' && REF.test(i.ref)).slice(0, 50);
      await store.addImages(
        items.map((i) => ({ ref: i.ref, w: Number(i.w) || undefined, h: Number(i.h) || undefined, source: i.source === 'ai' || i.source === 'upload' ? i.source : undefined, subject: typeof i.subject === 'string' ? i.subject.slice(0, 300) : undefined })),
        by,
      );
      return json({ ok: true });
    }

    default:
      return fail(400, 'bad_request', 'Неизвестная операция');
  }
}
