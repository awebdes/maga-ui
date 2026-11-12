/**
 * Supabase Edge Function `library`: the handler over Postgres and Storage with the service role,
 * which the runtime provides as SUPABASE_SERVICE_ROLE_KEY. JWT verification is off: callers send
 * the publishable key and the team code; the code is the access check (see handler.ts).
 * Deployed with the Supabase MCP or `supabase functions deploy library --no-verify-jwt`.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import { handle, type BannerRow, type ImageMeta, type SaveInput, type SaveResult, type Status, type Store } from './handler.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const COLUMNS = 'id, name, template, theme, status, version, thumb, created_by, updated_by, created_at, updated_at';
const HOUR = 3600;

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

const store: Store = {
  async codeOk(hash) {
    const r = await db.from('team_codes').select('code_hash').eq('code_hash', hash).maybeSingle();
    return !!must(r);
  },

  async list() {
    return must(await db.from('banners').select(COLUMNS).is('deleted_at', null).order('updated_at', { ascending: false }).limit(300)) as BannerRow[];
  },

  async get(id) {
    return must(await db.from('banners').select(`${COLUMNS}, doc`).eq('id', id).is('deleted_at', null).maybeSingle()) as (BannerRow & { doc: unknown }) | null;
  },

  async save(input: SaveInput, base: number | null): Promise<SaveResult> {
    const cur = must(await db.from('banners').select(`${COLUMNS}, deleted_at`).eq('id', input.id).maybeSingle()) as (BannerRow & { deleted_at: string | null }) | null;
    const live = cur && !cur.deleted_at ? cur : null;
    if (live && live.version !== base) return { ok: false, current: live };
    const at = new Date().toISOString();
    const fields = { name: input.name, template: input.template, theme: input.theme, doc: input.doc, updated_by: input.by, updated_at: at, ...(input.thumb ? { thumb: input.thumb } : {}) };
    if (!cur) {
      const row = must(await db.from('banners').insert({ id: input.id, ...fields, created_by: input.by, created_at: at, version: 1 }).select(COLUMNS).single()) as BannerRow;
      return { ok: true, row };
    }
    // the version in the filter makes a save that raced another one update nothing
    const q = db.from('banners').update({ ...fields, version: cur.version + 1, ...(live ? {} : { deleted_at: null, status: 'draft', created_by: input.by, created_at: at }) }).eq('id', input.id).eq('version', cur.version);
    const rows = must(await q.select(COLUMNS)) as BannerRow[];
    if (rows.length) return { ok: true, row: rows[0] };
    const now = must(await db.from('banners').select(COLUMNS).eq('id', input.id).single()) as BannerRow;
    return { ok: false, current: now };
  },

  async setStatus(id: string, status: Status, by: string) {
    return must(await db.from('banners').update({ status, updated_by: by, updated_at: new Date().toISOString() }).eq('id', id).is('deleted_at', null).select(COLUMNS).maybeSingle()) as BannerRow | null;
  },

  async remove(id) {
    const rows = must(await db.from('banners').update({ deleted_at: new Date().toISOString() }).eq('id', id).is('deleted_at', null).select('id')) as { id: string }[];
    return rows.length > 0;
  },

  async putThumb(id, bytes, type) {
    const path = `${id}.${type === 'image/png' ? 'png' : 'webp'}`;
    must(await db.storage.from('banner-thumbs').upload(path, bytes, { contentType: type, upsert: true }));
    return path;
  },

  async signed(bucket, paths) {
    if (!paths.length) return {};
    const list = must(await db.storage.from(bucket).createSignedUrls(paths, HOUR)) as { path: string | null; signedUrl: string; error: string | null }[];
    return Object.fromEntries(list.filter((s) => s.path && !s.error).map((s) => [s.path!, s.signedUrl]));
  },

  async knownImages(refs) {
    if (!refs.length) return [];
    return (must(await db.from('images').select('ref').in('ref', refs)) as { ref: string }[]).map((r) => r.ref);
  },

  async uploadUrl(path) {
    return (must(await db.storage.from('banner-images').createSignedUploadUrl(path, { upsert: true })) as { signedUrl: string }).signedUrl;
  },

  async addImages(items: ImageMeta[], by: string) {
    if (!items.length) return;
    must(await db.from('images').upsert(items.map((i) => ({ ...i, created_by: by })), { onConflict: 'ref', ignoreDuplicates: true }));
  },
};

Deno.serve(async (req) => {
  try {
    return await handle(req, store);
  } catch (e) {
    console.error('library', (e as Error).message);
    return new Response(JSON.stringify({ error: 'internal', message: 'Библиотека не ответила, попробуйте ещё раз' }), {
      status: 500,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json; charset=utf-8' },
    });
  }
});
