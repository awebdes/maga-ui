import { encode } from 'fast-png';
import { toDisplay, DEFAULT_VIEW, type FloatImage, type ViewSettings } from './view-transform';

/**
 * Encodes a linear float image as PNG (RGBA, straight alpha).
 * Canvas `toBlob` is not used: it premultiplies alpha and damages soft edges.
 */
export function encodePng(img: FloatImage, depth: 8 | 16 = 8, view: ViewSettings = DEFAULT_VIEW): Uint8Array {
  const px = toDisplay(img, depth, view);
  return encode({
    width: px.width,
    height: px.height,
    data: px.data,
    depth: px.depth,
    channels: 4,
  });
}

export function pngBlob(bytes: Uint8Array): Blob {
  // copy into a fresh ArrayBuffer so the Blob owns its memory
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: 'image/png' });
}

/** Composites onto a solid background in display space, as a design tool places a PNG. */
export function encodeOnBackground(img: FloatImage, depth: 8 | 16, view: ViewSettings, background: [number, number, number]): Uint8Array {
  const px = toDisplay(img, depth, view);
  const max = depth === 16 ? 65535 : 255;
  const d = px.data;
  const bg = background.map((c) => Math.round((c / 255) * max));
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / max;
    d[i] = Math.round(d[i] * a + bg[0] * (1 - a));
    d[i + 1] = Math.round(d[i + 1] * a + bg[1] * (1 - a));
    d[i + 2] = Math.round(d[i + 2] * a + bg[2] * (1 - a));
    d[i + 3] = max;
  }
  return encode({ width: px.width, height: px.height, data: d, depth: px.depth, channels: 4 });
}
