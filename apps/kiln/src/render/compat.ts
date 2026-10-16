/**
 * three r185+ always passes `swizzle: 'rgba'` in GPUTextureViewDescriptor. Chromium builds that
 * shipped the earlier texture-swizzle IDL reject the string and throw on every render pass.
 * An identity swizzle is the default, so dropping it changes nothing on browsers that accept it.
 */
let patched = false;

const BYTES_PER_TEXEL: Record<string, number> = {
  r16float: 2,
  r32float: 4,
  r32uint: 4,
  rg16float: 4,
  rg32float: 8,
  rgba8unorm: 4,
  rgba16float: 8,
  rgba32float: 16,
  rgba32uint: 16,
};

/**
 * Dawn (Chromium 141 at least) lazily clears a 3D storage texture on first use through a 2D view,
 * which fails validation and leaves the path tracer's LUT unusable. Writing zeros at creation marks
 * every subresource initialized, so the lazy clear never runs. Harmless where the bug is fixed:
 * one small upload per 3D storage texture.
 */
function patchStorage3DInit() {
  const proto = GPUDevice.prototype as GPUDevice;
  const original = proto.createTexture;
  proto.createTexture = function (this: GPUDevice, desc: GPUTextureDescriptor) {
    const bpp = BYTES_PER_TEXEL[desc.format as string];
    const storage = (desc.usage & GPUTextureUsage.STORAGE_BINDING) !== 0;
    if (desc.dimension !== '3d' || !storage || !bpp) return original.call(this, desc);
    const tex = original.call(this, { ...desc, usage: desc.usage | GPUTextureUsage.COPY_DST });
    const size = desc.size as GPUExtent3DDict | number[];
    const w0 = Array.isArray(size) ? size[0] : size.width;
    const h0 = Array.isArray(size) ? (size[1] ?? 1) : (size.height ?? 1);
    const d0 = Array.isArray(size) ? (size[2] ?? 1) : (size.depthOrArrayLayers ?? 1);
    for (let mip = 0; mip < (desc.mipLevelCount ?? 1); mip++) {
      const w = Math.max(1, w0 >> mip);
      const h = Math.max(1, h0 >> mip);
      const d = Math.max(1, d0 >> mip);
      const zeros = new Uint8Array(w * h * d * bpp);
      this.queue.writeTexture({ texture: tex, mipLevel: mip }, zeros, { bytesPerRow: w * bpp, rowsPerImage: h }, { width: w, height: h, depthOrArrayLayers: d });
    }
    return tex;
  };
}

export function patchWebGPUCompat(): void {
  if (patched || typeof GPUTexture === 'undefined') return;
  patched = true;
  if (typeof GPUDevice !== 'undefined') patchStorage3DInit();

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
