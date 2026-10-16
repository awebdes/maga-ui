/// <reference lib="webworker" />
// Keys a generated PNG off its magenta background off the main thread; replies with a trimmed PNG.
import { crop, keyMagenta } from './chroma';

self.onmessage = async (e: MessageEvent<{ id: number; png: Blob }>) => {
  const { id, png } = e.data;
  try {
    const bmp = await createImageBitmap(png);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    const src = ctx.getImageData(0, 0, bmp.width, bmp.height);
    const keyed = keyMagenta(src.data, src.width, src.height);
    if (!keyed.bbox) throw new Error('На картинке не нашлось объекта');
    const cut = crop(keyed);
    const out = new OffscreenCanvas(cut.width, cut.height);
    out.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(cut.data), cut.width, cut.height), 0, 0);
    const blob = await out.convertToBlob({ type: 'image/png' });
    self.postMessage({ id, blob, width: cut.width, height: cut.height, borderFlat: keyed.borderFlat });
  } catch (err) {
    self.postMessage({ id, error: (err as Error).message });
  }
};
