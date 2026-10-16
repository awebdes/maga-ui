import * as THREE from 'three/webgpu';
import { Baker } from '../geometry/bake';
import { FORM_DEFAULTS, type FormMode, type FormParams } from '../geometry/profiles';
import { rasterizeSvg } from '../shape/svg';
import { disc } from '../scene/slab';
import { buildSafe } from '../examples/safe';
import { buildHouse } from '../examples/house';
import { buildPin } from '../examples/pin';
import { partMesh, type Example, type Part } from '../examples/parts';
import type { BuildContext } from '../examples/context';
import { shortGlyph } from './glyphs';

export type SceneId = 'safe' | 'house' | 'pin' | 'glyph';
export type FormChoice = FormMode | 'badge';
export type Quality = 'preview' | 'final';

export interface ShapeState {
  scene: SceneId;
  glyph: { name: string; svg: string };
  form: FormChoice;
  /** dock sliders, percent */
  depth: number;
  roundness: number;
  puff: number;
}

/** Mesh resolution (cells across the shape) and simplification per quality. */
const QUALITY: Record<Quality, { resolution: number; simplify: number }> = {
  preview: { resolution: 160, simplify: 0 },
  final: { resolution: 448, simplify: 3e-4 },
};
/** coverage pixels per unit: the distance field is cached per shape in the worker */
const COVERAGE_RES = 1280;

export function formParams(s: Pick<ShapeState, 'form' | 'depth' | 'roundness' | 'puff'>): FormParams {
  if (s.form === 'badge') return { mode: 'extrude', depth: Math.max(0.04, (s.depth / 100) * 0.5), roundness: s.roundness / 100, puff: 0 };
  return { mode: s.form, depth: s.depth / 100, roundness: s.roundness / 100, puff: s.puff / 100 };
}

/** Dock values for a form: depth / roundness / puff in percent. */
export function formDefaults(form: FormChoice) {
  if (form === 'badge') return { depth: 24, roundness: 40, puff: 0 };
  const d = FORM_DEFAULTS[form];
  return { depth: Math.round(d.depth * 100), roundness: Math.round(d.roundness * 100), puff: Math.round(d.puff * 100) };
}

/**
 * Builds the scene content for a shape state. Glyph meshes are baked in a worker: a coarse
 * preview first, then a fine, simplified mesh once edits settle. Stale bakes are dropped.
 */
export class Subject {
  readonly root = new THREE.Group();
  private baker = new Baker();
  private cache = new Map<string, Promise<THREE.BufferGeometry>>();
  private order: string[] = [];
  private version = 0;
  private cachedGeos = new WeakSet<THREE.BufferGeometry>();
  private safe: Example | null = null;
  /** true when the shown content is final quality */
  final = false;
  example: Example | null = null;

  constructor(private onBusy: (busy: boolean) => void = () => {}) {
    this.root.name = 'subject';
  }

  private geometryKey(name: string, form: FormParams, q: Quality) {
    return `${name}|${form.mode}|${form.depth.toFixed(3)}|${form.roundness.toFixed(3)}|${form.puff.toFixed(3)}|${q}`;
  }

  /** Baked glyph geometry, longest side 1, centered, front toward +Z. Cached. */
  glyphGeometry(name: string, svg: string, form: FormParams, q: Quality): Promise<THREE.BufferGeometry> {
    const key = this.geometryKey(name, form, q);
    let p = this.cache.get(key);
    if (!p) {
      const { resolution, simplify } = QUALITY[q];
      p = this.baker
        .bake(`${name}@${COVERAGE_RES}`, () => rasterizeSvg(svg, { resolution: COVERAGE_RES, margin: 0.2 }), form, resolution, { simplify })
        .then((r) => {
          this.cachedGeos.add(r.geometry);
          return r.geometry;
        });
      p.catch(() => this.cache.delete(key));
      this.cache.set(key, p);
      this.order.push(key);
      while (this.order.length > 24) {
        const old = this.order.shift()!;
        const g = this.cache.get(old);
        this.cache.delete(old);
        // geometries still on screen are disposed when the content is replaced
        g?.then((geo) => {
          if (!this.inUse(geo)) geo.dispose();
        });
      }
    } else {
      this.order.splice(this.order.indexOf(key), 1);
      this.order.push(key);
    }
    return p;
  }

  private inUse(g: THREE.BufferGeometry) {
    let used = false;
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).geometry === g) used = true;
    });
    return used;
  }

  /** Hero mesh for the current form: the glyph alone, or a badge (coin + glyph). */
  private async hero(s: ShapeState, q: Quality): Promise<THREE.Object3D> {
    const form = formParams(s);
    const geo = await this.glyphGeometry(s.glyph.name, s.glyph.svg, form, q);
    if (s.form !== 'badge') {
      const m = partMesh(geo, 'body', `glyph-${s.glyph.name}`);
      return m;
    }
    const g = new THREE.Group();
    g.name = 'badge';
    const coinDepth = 0.16;
    const coinMesh = partMesh(disc(0.82, coinDepth, 0.05), 'coin', 'badge-coin');
    const glyph = partMesh(geo, 'accent', `glyph-${s.glyph.name}`);
    glyph.scale.setScalar(0.62);
    glyph.position.z = coinDepth / 2 + (form.depth * 0.62) / 2 - 0.004;
    g.add(coinMesh, glyph);
    return g;
  }

  /**
   * Rebuilds the content. Resolves to true when the root changed, false when a newer update
   * superseded this one.
   */
  async update(s: ShapeState, q: Quality): Promise<boolean> {
    const v = ++this.version;
    this.onBusy(true);
    try {
      let ex: Example;
      if (s.scene === 'safe') {
        this.safe ??= buildSafe();
        ex = this.safe;
      } else {
        const ctx: BuildContext = {
          hero: () => this.hero(s, q),
          glyph: async (name: string, form: FormParams, part: Part) => {
            const g = shortGlyphOrNull(name);
            const geo = await this.glyphGeometry(name, g, form, q);
            return partMesh(geo, part, `glyph-${name}`);
          },
        };
        if (s.scene === 'house') ex = await buildHouse(ctx);
        else if (s.scene === 'pin') ex = await buildPin(ctx);
        else {
          const root = new THREE.Group();
          root.name = 'glyph';
          root.add(await ctx.hero());
          ex = { id: 'glyph', name: s.glyph.name, root, camera: {} };
        }
      }
      if (v !== this.version) return false;
      const old = [...this.root.children];
      this.root.clear();
      this.root.add(ex.root);
      this.example = ex;
      this.final = q === 'final' || s.scene === 'safe';
      // free satellites that are not cached glyph geometry (slabs, coins)
      for (const o of old) {
        if (o === this.safe?.root) continue;
        o.traverse((c) => {
          const m = c as THREE.Mesh;
          if (m.isMesh && !this.isCachedGeometry(m.geometry) && !this.inUse(m.geometry)) m.geometry.dispose();
        });
      }
      return true;
    } finally {
      if (v === this.version) this.onBusy(false);
    }
  }

  private isCachedGeometry(g: THREE.BufferGeometry) {
    return this.cachedGeos.has(g);
  }
}

function shortGlyphOrNull(name: string) {
  return shortGlyph(name).svg;
}
