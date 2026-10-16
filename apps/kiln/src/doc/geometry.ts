import * as THREE from 'three/webgpu';
import { Baker } from '../geometry/bake';
import type { FormParams } from '../geometry/profiles';
import { rasterizeSvg } from '../shape/svg';
import { loadAllGlyphs, shortGlyphOrNull } from '../app/glyphs';
import type { FormValues } from './scene';

export type Quality = 'preview' | 'final';

/** Mesh resolution (cells across the shape) and simplification per quality. */
const QUALITY: Record<Quality, { resolution: number; simplify: number }> = {
  preview: { resolution: 160, simplify: 0 },
  final: { resolution: 448, simplify: 3e-4 },
};
/** coverage pixels per unit: the distance field is cached per shape in the worker */
const COVERAGE_RES = 1280;

/** Dock percent values → mesher parameters (glyph longest side = 1 unit). */
export function formParams(f: FormValues): FormParams {
  return { mode: f.mode, depth: f.depth / 100, roundness: f.roundness / 100, puff: f.puff / 100 };
}

/**
 * Baked glyph meshes, shared by every object that uses the same icon and form. Objects get
 * clones, so each one owns its vertex colors (gradients are written per mesh).
 *
 * SVG text is kept here, keyed by `GlyphRef.ref`, not in the scene document.
 */
export class GeometryCache {
  private baker = new Baker();
  private cache = new Map<string, Promise<THREE.BufferGeometry>>();
  private order: string[] = [];
  private svgs = new Map<string, string>();

  /** Stores SVG text for a ref; uploads get `upload:<hash>` refs. */
  register(ref: string, svg: string) {
    this.svgs.set(ref, svg);
  }

  /** SVG text when it is at hand without loading (uploads, picked icons, the shortlist). */
  svgIfKnown(ref: string): string | null {
    const known = this.svgs.get(ref);
    if (known) return known;
    return ref.startsWith('phosphor:') ? shortGlyphOrNull(ref.slice('phosphor:'.length)) : null;
  }

  async svgFor(ref: string): Promise<string> {
    const known = this.svgs.get(ref);
    if (known) return known;
    if (ref.startsWith('phosphor:')) {
      const name = ref.slice('phosphor:'.length);
      const short = shortGlyphOrNull(name);
      if (short) return short;
      const all = await loadAllGlyphs();
      const hit = all.find((g) => g.name === name);
      if (hit) {
        this.svgs.set(ref, hit.svg);
        return hit.svg;
      }
    }
    throw new Error(`The shape “${ref.split(':').pop()}” is not available`);
  }

  /** Master geometry for a glyph and form. Callers must clone before changing it. */
  glyph(ref: string, form: FormValues, q: Quality): Promise<THREE.BufferGeometry> {
    const p = formParams(form);
    const key = `${ref}|${p.mode}|${p.depth.toFixed(3)}|${p.roundness.toFixed(3)}|${p.puff.toFixed(3)}|${q}`;
    let geo = this.cache.get(key);
    if (geo) {
      this.order.splice(this.order.indexOf(key), 1);
      this.order.push(key);
      return geo;
    }
    const { resolution, simplify } = QUALITY[q];
    geo = this.svgFor(ref).then((svg) =>
      this.baker
        .bake(`${ref}@${COVERAGE_RES}`, () => rasterizeSvg(svg, { resolution: COVERAGE_RES, margin: 0.2 }), p, resolution, { simplify })
        .then((r) => r.geometry),
    );
    geo.catch(() => this.cache.delete(key));
    this.cache.set(key, geo);
    this.order.push(key);
    while (this.order.length > 32) {
      const old = this.order.shift()!;
      this.cache.get(old)?.then((g) => g.dispose());
      this.cache.delete(old);
    }
    return geo;
  }
}

/** Content hash for uploaded SVG text. */
export async function svgRef(svg: string) {
  const bytes = new TextEncoder().encode(svg);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
  return `upload:${hex}`;
}
