import { encode } from 'fast-png';
import { toDisplay, type FloatImage } from './view-transform';

/**
 * Encodes a linear float image as PNG (RGBA, straight alpha).
 * Canvas `toBlob` is not used: it premultiplies alpha and damages soft edges.
 */
export function encodePng(img: FloatImage, depth: 8 | 16 = 8): Uint8Array {
  const px = toDisplay(img, depth);
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
