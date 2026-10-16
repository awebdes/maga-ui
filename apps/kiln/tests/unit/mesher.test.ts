import { describe, it, expect } from 'vitest';
import { fieldFromCoverage, localHalfWidth, sampleBilinear, type Field } from '../../src/geometry/field';
import { meshField, meshTopology, signedVolume } from '../../src/geometry/mesher';
import { FORM_DEFAULTS, type FormParams } from '../../src/geometry/profiles';

/** Supersampled coverage of an analytic shape over [-0.6, 0.6]². */
function coverage(inside: (x: number, y: number) => boolean, res: number) {
  const span = 1.2;
  const px = span / res;
  const x0 = -0.6 + px / 2;
  const y0 = -0.6 + px / 2;
  const cov = new Float32Array(res * res);
  const ss = 4;
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      let c = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = x0 + (i - 0.5 + (sx + 0.5) / ss) * px;
          const y = y0 + (j - 0.5 + (sy + 0.5) / ss) * px;
          if (inside(x, y)) c++;
        }
      }
      cov[j * res + i] = c / (ss * ss);
    }
  }
  return { cov, px, x0, y0 };
}

function makeField(inside: (x: number, y: number) => boolean, res = 512): Field {
  const { cov, px, x0, y0 } = coverage(inside, res);
  return fieldFromCoverage(cov, res, res, px, x0, y0);
}

const disc = (x: number, y: number) => x * x + y * y < 0.4 * 0.4;
const ring = (x: number, y: number) => {
  const r = Math.hypot(x, y);
  return r < 0.42 && r > 0.22;
};
const bar = (x: number, y: number) => Math.abs(x) < 0.45 && Math.abs(y) < 0.012; // hairline-ish

describe('distance field', () => {
  it('is sub-pixel accurate near the outline and within 2 % far from it', () => {
    const f = makeField(disc, 256);
    const near = [[0.4, 0], [0.283, 0.283], [0.39, 0.05], [0.42, 0], [-0.3, -0.3]];
    const far = [[0, 0], [0.2, 0.1], [0.5, 0.2], [0.1, -0.45]];
    for (const [x, y] of near) {
      const expected = Math.hypot(x, y) - 0.4;
      expect(Math.abs(sampleBilinear(f, f.d, x, y) - expected)).toBeLessThan(f.px * 0.5);
    }
    for (const [x, y] of far) {
      const expected = Math.hypot(x, y) - 0.4;
      expect(Math.abs(sampleBilinear(f, f.d, x, y) - expected)).toBeLessThan(Math.abs(expected) * 0.02 + f.px * 0.25);
    }
  });

  it('local half-width is small on thin strokes and large on wide bodies', () => {
    const f = makeField((x, y) => bar(x, y) || disc(x - 0.2, y + 0.35) && false || Math.hypot(x + 0.3, y - 0.3) < 0.15, 256);
    const hw = localHalfWidth(f, 0.1);
    expect(sampleBilinear(f, hw, 0.2, 0)).toBeLessThan(0.03);
    expect(sampleBilinear(f, hw, -0.3, 0.3)).toBeGreaterThan(0.12);
  });
});

function bake(inside: (x: number, y: number) => boolean, form: FormParams, resolution = 128, fieldRes = 512) {
  const f = makeField(inside, fieldRes);
  const hw = localHalfWidth(f, form.depth);
  return meshField(f, hw, form, { resolution });
}

describe('surface nets mesher', () => {
  for (const mode of ['extrude', 'soft', 'inflate'] as const) {
    it(`${mode}: a disc gives a closed genus-0 mesh with outward winding`, () => {
      const m = bake(disc, FORM_DEFAULTS[mode]);
      const topo = meshTopology(m.indices, m.positions.length / 3);
      expect(topo.closed).toBe(true);
      expect(topo.genus).toBe(0);
      expect(signedVolume(m.positions, m.indices)).toBeGreaterThan(0);
      for (const v of m.normals) expect(Number.isFinite(v)).toBe(true);
    });
  }

  it('a ring has genus 1 (one hole)', () => {
    const m = bake(ring, FORM_DEFAULTS.soft);
    const topo = meshTopology(m.indices, m.positions.length / 3);
    expect(topo.closed).toBe(true);
    expect(topo.genus).toBe(1);
  });

  it('a hairline stays solid in soft mode instead of vanishing', () => {
    const m = bake(bar, FORM_DEFAULTS.soft, 192, 1024);
    const topo = meshTopology(m.indices, m.positions.length / 3);
    expect(m.stats.vertices).toBeGreaterThan(100);
    expect(topo.closed).toBe(true);
  });

  it('extrude keeps the requested depth and a flat top', () => {
    const form = FORM_DEFAULTS.extrude;
    const m = bake(disc, form);
    let maxZ = -Infinity;
    let flat = 0;
    let top = 0;
    for (let v = 0; v < m.positions.length / 3; v++) {
      const z = m.positions[v * 3 + 2];
      maxZ = Math.max(maxZ, z);
      if (z > form.depth / 2 - 1e-3) {
        top++;
        if (m.normals[v * 3 + 2] > 0.999) flat++;
      }
    }
    expect(maxZ).toBeCloseTo(form.depth / 2, 2);
    expect(flat / top).toBeGreaterThan(0.9);
  });

  it('bakes a preview-size grid fast', () => {
    const f = makeField(ring, 1024);
    const hw = localHalfWidth(f, 0.26);
    const m = meshField(f, hw, FORM_DEFAULTS.soft, { resolution: 192 });
    expect(m.stats.ms).toBeLessThan(400);
  });
});
