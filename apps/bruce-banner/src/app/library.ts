/**
 * The team library: banners shared by everyone with the team code, in Supabase behind the
 * `library` edge function (see supabase/functions/library). This browser keeps working on its own
 * copy in IndexedDB as before; a save is pushed a few seconds later with the version it started
 * from, so a colleague's newer save is never overwritten silently (409 → the person chooses).
 *
 * Off when the build has no VITE_LIBRARY_URL: then everything stays in this browser, as before.
 */
import type { BannerDoc } from '../engine';
import { store } from '../ui/kit/core';
import { accessCode } from './ai-client';
import { docBlobRefs, getArtMeta, getImageBlob, putImage, saveProject } from './storage';

export type Status = 'draft' | 'review' | 'approved';
export const STATUS_LABEL: Record<Status, string> = { draft: 'Черновик', review: 'На согласовании', approved: 'Утверждён' };

export interface TeamBanner {
  id: string;
  name: string;
  template: string | null;
  theme: string | null;
  status: Status;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  thumbUrl: string | null;
}

export class LibraryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
    readonly current?: TeamBanner,
  ) {
    super(message);
  }
}

const URL_ = (import.meta.env.VITE_LIBRARY_URL as string | undefined)?.trim() ?? '';
const KEY = (import.meta.env.VITE_LIBRARY_KEY as string | undefined)?.trim() ?? '';

export const libraryOn = () => URL_.length > 0;

export const identity = {
  name: () => store.get<string>('name', ''),
  code: () => accessCode.get(),
  ready: () => libraryOn() && !!identity.name() && !!identity.code(),
  set(name: string, code: string) {
    store.set('name', name.trim());
    accessCode.set(code);
  },
};

/** the library version each banner in this browser was last in step with */
const versions = {
  all: () => store.get<Record<string, number>>('lib-versions', {}),
  get: (id: string) => versions.all()[id] ?? null,
  set(id: string, v: number | null) {
    const all = versions.all();
    if (v === null) delete all[id];
    else all[id] = v;
    store.set('lib-versions', all);
  },
};
export const syncedVersion = versions.get;

async function call<T>(op: string, body: Record<string, unknown> = {}, who = { name: identity.name(), code: identity.code() }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(URL_, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(KEY ? { apikey: KEY, authorization: `Bearer ${KEY}` } : {}),
        'x-team-code': who.code,
        'x-team-name': encodeURIComponent(who.name),
      },
      body: JSON.stringify({ op, ...body }),
    });
  } catch {
    throw new LibraryError('offline', navigator.onLine ? 'Библиотека не отвечает' : 'Нет интернета');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string; current?: TeamBanner };
  if (!res.ok) throw new LibraryError(data.error ?? 'internal', data.message ?? `Ошибка ${res.status}`, res.status, data.current);
  return data as T;
}

/** Checks a name and code before keeping them. */
export async function join(name: string, code: string) {
  try {
    await call('hello', {}, { name: name.trim(), code: code.trim() });
  } catch (e) {
    if (e instanceof LibraryError && e.code === 'unauthorized') throw new LibraryError('unauthorized', 'Код не подошёл — проверьте его у команды дизайна', 401);
    throw e;
  }
  identity.set(name, code);
}

export async function listTeam(): Promise<TeamBanner[]> {
  return (await call<{ banners: TeamBanner[] }>('list')).banners;
}

/** Brings a banner from the library into this browser (pictures included) and returns it. */
export async function fetchFromTeam(id: string): Promise<{ doc: BannerDoc; banner: TeamBanner }> {
  const r = await call<{ banner: TeamBanner & { doc: BannerDoc }; images: Record<string, string | null> }>('get', { id });
  for (const [ref, url] of Object.entries(r.images)) {
    if (!url) continue;
    const res = await fetch(url);
    if (!res.ok) continue;
    const stored = await putImage(await res.blob());
    if (stored !== ref) console.warn('library image changed', ref, stored);
  }
  const { doc, ...banner } = r.banner;
  await saveProject(doc);
  versions.set(id, banner.version);
  return { doc, banner };
}

async function uploadPictures(doc: BannerDoc) {
  const refs = docBlobRefs(doc);
  if (!refs.length) return;
  const items = await Promise.all(refs.map(async (ref) => {
    const m = await getArtMeta(ref);
    return { ref, w: m?.w, h: m?.h, source: m?.source, subject: m?.subject };
  }));
  const { upload } = await call<{ upload: Record<string, string> }>('images.prepare', { items });
  const sent: typeof items = [];
  for (const item of items) {
    const url = upload[item.ref];
    if (!url) continue;
    const blob = await getImageBlob(item.ref);
    if (!blob) continue;
    const res = await fetch(url, { method: 'PUT', headers: { 'content-type': blob.type || 'image/png', 'x-upsert': 'true' }, body: blob });
    if (res.ok) sent.push(item);
  }
  if (sent.length) await call('images.commit', { items: sent });
}

const toB64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/**
 * Pushes this browser's copy. `force` saves over whatever the library has (the person chose
 * «Оставить мою»); otherwise a newer save in the library comes back as a LibraryError 'conflict'.
 */
export async function pushToTeam(doc: BannerDoc, thumb?: Blob | null, force = false): Promise<TeamBanner> {
  await uploadPictures(doc);
  const b64 = thumb ? await toB64(thumb) : null;
  const send = (base: number | null) => call<{ banner: TeamBanner }>('save', { doc, baseVersion: base, ...(b64 && b64.length < 390_000 ? { thumb: b64, thumbType: 'image/png' } : {}) });
  try {
    const { banner } = await send(versions.get(doc.id));
    versions.set(doc.id, banner.version);
    return banner;
  } catch (e) {
    if (force && e instanceof LibraryError && e.code === 'conflict' && e.current) {
      const { banner } = await send(e.current.version);
      versions.set(doc.id, banner.version);
      return banner;
    }
    throw e;
  }
}

export async function setTeamStatus(id: string, status: Status): Promise<TeamBanner> {
  return (await call<{ banner: TeamBanner }>('status', { id, status })).banner;
}

export async function deleteFromTeam(id: string) {
  await call('delete', { id });
  versions.set(id, null);
}
