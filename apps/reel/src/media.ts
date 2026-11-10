/**
 * Screen media: images, videos and generated demo canvases. The document only stores ids;
 * blobs persist in IndexedDB so a reload keeps uploaded screenshots and recordings.
 */
import { bankingHome, dashboardScreen, savingsScreen, tabletScreen } from './demo-screens';

export type MediaSource = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;
export interface Media {
  id: string;
  name: string;
  kind: 'image' | 'video';
  el: MediaSource;
  w: number;
  h: number;
  url?: string;
}

const items = new Map<string, Media>();
const listeners = new Set<() => void>();
export const onMedia = (fn: () => void) => listeners.add(fn);
const changed = () => listeners.forEach((fn) => fn());

export const getMedia = (id: string | null) => (id ? items.get(id) ?? null : null);
export const allMedia = () => [...items.values()];

export const DEMO = { home: 'demo:home', savings: 'demo:savings', dashboard: 'demo:dashboard', tablet: 'demo:tablet' };

export function registerDemos() {
  const add = (id: string, name: string, cv: HTMLCanvasElement) => items.set(id, { id, name, kind: 'image', el: cv, w: cv.width, h: cv.height });
  add(DEMO.home, 'Home · demo', bankingHome());
  add(DEMO.savings, 'Savings · demo', savingsScreen());
  add(DEMO.dashboard, 'Dashboard · demo', dashboardScreen());
  add(DEMO.tablet, 'Budget · demo', tabletScreen());
}

/* ---------- loading ---------- */

async function load(id: string, name: string, blob: Blob): Promise<Media> {
  const url = URL.createObjectURL(blob);
  if (blob.type.startsWith('video/')) {
    const v = document.createElement('video');
    v.src = url;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.crossOrigin = 'anonymous';
    v.preload = 'auto';
    await new Promise<void>((res, rej) => {
      v.onloadeddata = () => res();
      v.onerror = () => rej(new Error('Video could not be decoded'));
    });
    return { id, name, kind: 'video', el: v, w: v.videoWidth, h: v.videoHeight, url };
  }
  const img = new Image();
  img.src = url;
  await img.decode();
  return { id, name, kind: 'image', el: img, w: img.naturalWidth, h: img.naturalHeight, url };
}

export async function addFile(file: File): Promise<Media> {
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) throw new Error('Use an image or a video');
  const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const m = await load(id, file.name, file);
  items.set(id, m);
  void idbPut(id, file.name, file);
  changed();
  return m;
}

/* ---------- persistence ---------- */

const DB = 'reel-media';
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('m');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbPut(id: string, name: string, blob: Blob) {
  try {
    const d = await db();
    d.transaction('m', 'readwrite').objectStore('m').put({ name, blob }, id);
  } catch {
    /* private mode: media lives until reload */
  }
}

/** restores the blobs the document still references */
export async function restore(ids: string[]) {
  const want = ids.filter((id) => id && !items.has(id) && !id.startsWith('demo:'));
  if (!want.length) return;
  try {
    const d = await db();
    await Promise.all(
      want.map(
        (id) =>
          new Promise<void>((res) => {
            const r = d.transaction('m').objectStore('m').get(id);
            r.onsuccess = async () => {
              const v = r.result as { name: string; blob: Blob } | undefined;
              if (v) {
                try {
                  items.set(id, await load(id, v.name, v.blob));
                } catch {
                  /* skip broken media */
                }
              }
              res();
            };
            r.onerror = () => res();
          }),
      ),
    );
    changed();
  } catch {
    /* no IndexedDB */
  }
}

/** keeps the store small: drops blobs no document references */
export async function prune(keep: string[]) {
  try {
    const d = await db();
    const store = d.transaction('m', 'readwrite').objectStore('m');
    const r = store.getAllKeys();
    r.onsuccess = () => (r.result as string[]).forEach((k) => !keep.includes(k) && store.delete(k));
  } catch {
    /* ignore */
  }
}

/** for project files: media as data URLs */
export async function mediaToDataUrl(id: string): Promise<{ name: string; data: string } | null> {
  const m = items.get(id);
  if (!m || id.startsWith('demo:') || !m.url) return null;
  const blob = await (await fetch(m.url)).blob();
  const data = await new Promise<string>((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.readAsDataURL(blob);
  });
  return { name: m.name, data };
}

export async function mediaFromDataUrl(id: string, name: string, data: string) {
  const blob = await (await fetch(data)).blob();
  const m = await load(id, name, blob);
  items.set(id, m);
  void idbPut(id, name, blob);
  changed();
}
