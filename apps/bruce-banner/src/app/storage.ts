/**
 * Local persistence in IndexedDB (idb-keyval), one database per store so listing the index never
 * loads documents or images: index (name, dates), docs, blobs (user and AI images, by SHA-256)
 * and thumbs. Everything stays in this browser; `.banner.json` carries a banner to a colleague.
 */
import { createStore, del, entries, get, keys, set, type UseStore } from 'idb-keyval';
import { isBlobRef, type BannerDoc } from '../engine';
import { hasBlob, registerBlob } from '../render/images';

export interface ProjectMeta {
  id: string;
  name: string;
  template: string;
  theme: string;
  createdAt: number;
  updatedAt: number;
}

/** a picture someone drew with AI or uploaded: reusable in any banner of this browser */
export interface ArtMeta {
  ref: string;
  w: number;
  h: number;
  source: 'ai' | 'upload';
  at: number;
  subject?: string;
}

/** how many of the latest pictures survive clean-up even when no banner uses them */
const KEEP_ART = 40;

let stores: { index: UseStore; docs: UseStore; blobs: UseStore; thumbs: UseStore; art: UseStore } | null = null;
let available = typeof indexedDB !== 'undefined';

function db() {
  stores ??= {
    index: createStore('bruce-banner-index', 'kv'),
    docs: createStore('bruce-banner-docs', 'kv'),
    blobs: createStore('bruce-banner-blobs', 'kv'),
    thumbs: createStore('bruce-banner-thumbs', 'kv'),
    art: createStore('bruce-banner-art', 'kv'),
  };
  return stores;
}

/** Wraps IndexedDB calls: private mode or blocked storage degrades to "not saved", not a crash. */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  if (!available) return fallback;
  try {
    return await fn();
  } catch (e) {
    console.warn('storage unavailable', e);
    available = false;
    return fallback;
  }
}

export const storageAvailable = () => available;

export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await safe(() => entries<string, ProjectMeta>(db().index), []);
  return all.map(([, m]) => m).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id: string): Promise<BannerDoc | null> {
  const doc = await safe(() => get<BannerDoc>(id, db().docs), undefined);
  if (!doc) return null;
  await registerDocBlobs(doc);
  return doc;
}

export async function saveProject(doc: BannerDoc) {
  const meta: ProjectMeta = { id: doc.id, name: doc.name, template: doc.template, theme: doc.theme, createdAt: doc.createdAt, updatedAt: doc.updatedAt };
  return safe(async () => {
    await set(doc.id, doc, db().docs);
    await set(doc.id, meta, db().index);
    return true;
  }, false);
}

export async function deleteProject(id: string) {
  await safe(async () => {
    await del(id, db().docs);
    await del(id, db().index);
    await del(id, db().thumbs);
  }, undefined);
  await gcBlobs();
}

export async function saveThumb(id: string, blob: Blob) {
  await safe(() => set(id, blob, db().thumbs), undefined);
}

export async function loadThumb(id: string): Promise<Blob | null> {
  return (await safe(() => get<Blob>(id, db().thumbs), undefined)) ?? null;
}

/* ---------- images ---------- */

async function sha256(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Stores an image once by content and returns its ref (`blob:<sha256>`), drawable right away.
 * With `art`, it also joins «Мои картинки».
 */
export async function putImage(blob: Blob, art?: Omit<ArtMeta, 'ref' | 'at'>): Promise<string> {
  const ref = `blob:${await sha256(blob)}`;
  registerBlob(ref, blob);
  await safe(async () => {
    if (!(await get(ref, db().blobs))) await set(ref, blob, db().blobs);
    if (art) await set(ref, { ...art, ref, at: Date.now() } satisfies ArtMeta, db().art);
  }, undefined);
  if (art) window.dispatchEvent(new CustomEvent('bb:art'));
  return ref;
}

/** «Мои картинки», newest first, drawable. */
export async function listArt(limit = 24): Promise<ArtMeta[]> {
  const all = (await safe(() => entries<string, ArtMeta>(db().art), [])).map(([, m]) => m).sort((a, b) => b.at - a.at);
  const out: ArtMeta[] = [];
  for (const m of all) {
    if (out.length >= limit) break;
    if (!hasBlob(m.ref)) {
      const blob = await getImageBlob(m.ref);
      if (!blob) continue;
      registerBlob(m.ref, blob);
    }
    out.push(m);
  }
  return out;
}

export async function getImageBlob(ref: string): Promise<Blob | null> {
  return (await safe(() => get<Blob>(ref, db().blobs), undefined)) ?? null;
}

export const docBlobRefs = (doc: BannerDoc) =>
  doc.layers.flatMap((l) => (l.kind === 'image' || l.kind === 'card' || l.kind === 'imageClip' ? [l.src] : l.kind === 'pill' ? [l.icon] : [])).filter(isBlobRef);

async function registerDocBlobs(doc: BannerDoc) {
  for (const ref of docBlobRefs(doc)) {
    if (hasBlob(ref)) continue;
    const blob = await getImageBlob(ref);
    if (blob) registerBlob(ref, blob);
  }
}

/** Deletes stored images no saved banner uses, except the latest of «Мои картинки». */
export async function gcBlobs() {
  await safe(async () => {
    const used = new Set<string>();
    for (const [, doc] of await entries<string, BannerDoc>(db().docs)) docBlobRefs(doc).forEach((r) => used.add(r));
    const art = (await entries<string, ArtMeta>(db().art)).map(([, m]) => m).sort((a, b) => b.at - a.at);
    art.slice(0, KEEP_ART).forEach((m) => used.add(m.ref));
    for (const m of art.slice(KEEP_ART)) if (!used.has(m.ref)) await del(m.ref, db().art);
    for (const k of await keys<string>(db().blobs)) if (!used.has(k)) await del(k, db().blobs);
  }, undefined);
}

/** Asks the browser not to evict our data under storage pressure. */
export async function requestPersistence() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/* ---------- .banner.json ---------- */

interface BannerFile {
  format: 'bruce-banner';
  v: 1;
  doc: BannerDoc;
  images: Record<string, { type: string; data: string }>;
}

async function toBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function exportBannerFile(doc: BannerDoc): Promise<Blob> {
  const images: BannerFile['images'] = {};
  for (const ref of docBlobRefs(doc)) {
    const blob = await getImageBlob(ref);
    if (blob) images[ref] = { type: blob.type || 'image/png', data: await toBase64(blob) };
  }
  const file: BannerFile = { format: 'bruce-banner', v: 1, doc, images };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

/** Reads a `.banner.json`; the banner gets a new id so it never overwrites the sender's copy. */
export async function importBannerFile(file: File, newId: () => string): Promise<BannerDoc> {
  const data = JSON.parse(await file.text()) as Partial<BannerFile>;
  if (data.format !== 'bruce-banner' || !data.doc || !Array.isArray(data.doc.layers)) throw new Error('Это не файл баннера');
  for (const [ref, img] of Object.entries(data.images ?? {})) {
    const bytes = Uint8Array.from(atob(img.data), (c) => c.charCodeAt(0));
    const stored = await putImage(new Blob([bytes], { type: img.type }));
    if (stored !== ref) console.warn('image ref changed on import', ref, stored);
  }
  const now = Date.now();
  return { ...data.doc, id: newId(), createdAt: now, updatedAt: now };
}
