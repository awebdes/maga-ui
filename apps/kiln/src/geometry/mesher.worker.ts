/// <reference lib="webworker" />
import { fieldFromCoverage, localHalfWidth, type Field } from './field';
import { meshField, meshTopology } from './mesher';
import { simplifyMesh } from './simplify';
import type { FormParams } from './profiles';

export interface BakeRequest {
  id: number;
  /** cache key for the coverage (same shape → reuse the distance field) */
  key: string;
  coverage?: { data: Float32Array; w: number; h: number; px: number; x0: number; y0: number };
  form: FormParams;
  resolution: number;
  checkTopology?: boolean;
  /** relative error for meshoptimizer; 0 or undefined keeps the raw surface nets mesh */
  simplify?: number;
}

export interface BakeResponse {
  id: number;
  ok: boolean;
  error?: string;
  positions?: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  indices?: Uint32Array;
  bounds?: { minX: number; minY: number; maxX: number; maxY: number; maxZ: number };
  stats?: {
    fieldMs: number;
    meshMs: number;
    simplifyMs: number;
    rawTriangles: number;
    vertices: number;
    triangles: number;
    visited: number;
    cells: number;
    closed?: boolean;
    genus?: number;
  };
}

const fields = new Map<string, { field: Field; halfWidth: Map<number, Float32Array>; ms: number }>();

self.onmessage = async (e: MessageEvent<BakeRequest>) => {
  const req = e.data;
  try {
    let entry = fields.get(req.key);
    let fieldMs = 0;
    if (!entry) {
      if (!req.coverage) throw new Error('Shape data missing');
      const t0 = performance.now();
      const c = req.coverage;
      const field = fieldFromCoverage(c.data, c.w, c.h, c.px, c.x0, c.y0);
      fieldMs = performance.now() - t0;
      entry = { field, halfWidth: new Map(), ms: fieldMs };
      fields.set(req.key, entry);
      if (fields.size > 8) fields.delete(fields.keys().next().value!);
    }
    // half-width radius depends on the form depth; cache per depth
    const radius = Math.max(req.form.depth, 0.05);
    const rk = Math.round(radius * 1000);
    let hw = entry.halfWidth.get(rk);
    if (!hw) {
      hw = localHalfWidth(entry.field, radius);
      entry.halfWidth.set(rk, hw);
    }
    const raw = meshField(entry.field, hw, req.form, { resolution: req.resolution });
    let simplifyMs = 0;
    let m = { positions: raw.positions, normals: raw.normals, uvs: raw.uvs, indices: raw.indices };
    if (req.simplify) {
      const t1 = performance.now();
      try {
        m = await simplifyMesh(m, req.simplify);
      } catch (err) {
        // WebAssembly can be blocked by the host page's CSP; the raw mesh is still valid
        console.warn('Mesh simplification unavailable, using the raw mesh', err);
      }
      simplifyMs = performance.now() - t1;
    }
    const topo = req.checkTopology ? meshTopology(m.indices, m.positions.length / 3) : undefined;
    const res: BakeResponse = {
      id: req.id,
      ok: true,
      positions: m.positions,
      normals: m.normals,
      uvs: m.uvs,
      indices: m.indices,
      bounds: raw.bounds,
      stats: {
        fieldMs,
        meshMs: raw.stats.ms,
        simplifyMs,
        rawTriangles: raw.stats.triangles,
        vertices: m.positions.length / 3,
        triangles: m.indices.length / 3,
        visited: raw.stats.visited,
        cells: raw.stats.cells,
        closed: topo?.closed,
        genus: topo?.genus,
      },
    };
    (self as unknown as Worker).postMessage(res, [
      m.positions.buffer,
      m.normals.buffer,
      m.uvs.buffer,
      m.indices.buffer,
    ]);
  } catch (err) {
    const res: BakeResponse = { id: req.id, ok: false, error: (err as Error).message };
    (self as unknown as Worker).postMessage(res);
  }
};
