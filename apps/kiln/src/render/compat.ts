/**
 * three r185+ always passes `swizzle: 'rgba'` in GPUTextureViewDescriptor. Chromium builds that
 * shipped the earlier texture-swizzle IDL reject the string and throw on every render pass.
 * An identity swizzle is the default, so dropping it changes nothing on browsers that accept it.
 */
let patched = false;

export function patchWebGPUCompat(): void {
  if (patched || typeof GPUTexture === 'undefined') return;
  patched = true;

  const proto = GPUTexture.prototype as GPUTexture & {
    createView: (desc?: GPUTextureViewDescriptor) => GPUTextureView;
  };
  const original = proto.createView;
  proto.createView = function (this: GPUTexture, desc?: GPUTextureViewDescriptor) {
    const d = desc as (GPUTextureViewDescriptor & { swizzle?: unknown }) | undefined;
    if (d && d.swizzle === 'rgba') {
      const copy: GPUTextureViewDescriptor & { swizzle?: unknown } = { ...d };
      delete copy.swizzle;
      return original.call(this, copy);
    }
    return original.call(this, desc);
  };
}
