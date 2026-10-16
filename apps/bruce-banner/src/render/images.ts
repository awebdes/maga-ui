import { ASSETS, isBlobRef, type BannerDoc, type DrawableImage } from '../engine';

const urls = import.meta.glob('../brand/img/*', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** URL of a library asset, or of a stored blob registered with `registerBlob`. */
export function assetUrl(ref: string): string | null {
  if (isBlobRef(ref)) return blobUrls.get(ref) ?? null;
  const a = ASSETS.find((x) => x.id === ref);
  return a ? (urls[`../brand/img/${a.file}`] ?? null) : null;
}

const blobUrls = new Map<string, string>();
const cache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement | null>>();
const listeners = new Set<(ref: string) => void>();

/** Makes a stored image drawable under its ref. */
export function registerBlob(ref: string, blob: Blob) {
  if (blobUrls.has(ref)) return;
  blobUrls.set(ref, URL.createObjectURL(blob));
}

export const hasBlob = (ref: string) => blobUrls.has(ref);

/** Decoded image for the renderer, or null (and a load starts) while it is not ready. */
export function getImage(ref: string): DrawableImage | null {
  const img = cache.get(ref);
  if (img) return img;
  void loadImage(ref);
  return null;
}

export function loadImage(ref: string): Promise<HTMLImageElement | null> {
  const hit = cache.get(ref);
  if (hit) return Promise.resolve(hit);
  const p = pending.get(ref);
  if (p) return p;
  const url = assetUrl(ref);
  if (!url) return Promise.resolve(null);
  const next = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      cache.set(ref, img);
      pending.delete(ref);
      listeners.forEach((fn) => fn(ref));
      resolve(img);
    };
    img.onerror = () => {
      pending.delete(ref);
      resolve(null);
    };
    img.src = url;
  });
  pending.set(ref, next);
  return next;
}

/** Calls back whenever an image finishes loading: redraw. */
export function onImageLoad(fn: (ref: string) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function imageRefs(doc: BannerDoc): string[] {
  const refs = new Set<string>();
  for (const l of doc.layers) {
    if (l.kind === 'image' || l.kind === 'card' || l.kind === 'imageClip') refs.add(l.src);
    else if (l.kind === 'pill') refs.add(l.icon);
  }
  return [...refs];
}

/** Waits for every image a document draws (before export or a thumbnail). */
export async function preloadDoc(doc: BannerDoc) {
  await Promise.all(imageRefs(doc).map(loadImage));
}

export const brandImagesAvailable = () => ASSETS.every((a) => !!urls[`../brand/img/${a.file}`]);
