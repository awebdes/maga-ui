/**
 * Narrow-band surface nets over the 2.5D implicit from `profiles.ts`.
 *
 * - Columns (d, half-width) are precomputed per grid corner, so evaluating F at a corner is a
 *   few flops.
 * - Only cells that can contain surface are visited: the top/bottom skins near ±top(column)
 *   and the side walls where columns change sign.
 * - Vertices are Newton-projected onto the continuous surface and get normals from its
 *   gradient, so flat faces are exactly flat and reflections stay clean.
 */
import { type Field, sampleBilinear } from './field';
import { type FormParams, type Column, makeColumn, evalColumn, columnTop } from './profiles';

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** world-space bounds of the shape outline (z excluded) */
  bounds: { minX: number; minY: number; maxX: number; maxY: number; maxZ: number };
  stats: { cells: number; visited: number; vertices: number; triangles: number; ms: number };
}

export interface MeshOptions {
  /** cells across the longest side of the shape */
  resolution: number;
  /** Newton steps per vertex */
  projectSteps?: number;
}

const EDGES: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7], // x
  [0, 2], [1, 3], [4, 6], [5, 7], // y
  [0, 4], [1, 5], [2, 6], [3, 7], // z
];

class GrowF32 {
  a: Float32Array;
  n = 0;
  constructor(cap: number) {
    this.a = new Float32Array(cap);
  }
  push3(x: number, y: number, z: number) {
    if (this.n + 3 > this.a.length) {
      const b = new Float32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = x;
    this.a[this.n++] = y;
    this.a[this.n++] = z;
  }
  view() {
    return this.a.slice(0, this.n);
  }
}

class GrowU32 {
  a: Uint32Array;
  n = 0;
  constructor(cap: number) {
    this.a = new Uint32Array(cap);
  }
  push3(x: number, y: number, z: number) {
    if (this.n + 3 > this.a.length) {
      const b = new Uint32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = x;
    this.a[this.n++] = y;
    this.a[this.n++] = z;
  }
  view() {
    return this.a.slice(0, this.n);
  }
}

/** Bounds of the solid part of the field (d < 0). */
export function solidBounds(field: Field) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let y = 0; y < field.h; y++) {
    for (let x = 0; x < field.w; x++) {
      if (field.d[y * field.w + x] < 0) {
        const wx = field.x0 + x * field.px;
        const wy = field.y0 + y * field.px;
        if (wx < minX) minX = wx;
        if (wx > maxX) maxX = wx;
        if (wy < minY) minY = wy;
        if (wy > maxY) maxY = wy;
      }
    }
  }
  if (maxX < minX) return null;
  return { minX: minX - field.px, minY: minY - field.px, maxX: maxX + field.px, maxY: maxY + field.px };
}

export function meshField(field: Field, halfWidth: Float32Array, form: FormParams, opts: MeshOptions): MeshData {
  const t0 = performance.now();
  const sb = solidBounds(field);
  if (!sb) throw new Error('The shape is empty');
  let maxW = 0;
  for (let i = 0; i < halfWidth.length; i++) if (halfWidth[i] > maxW) maxW = halfWidth[i];

  const sizeX = sb.maxX - sb.minX;
  const sizeY = sb.maxY - sb.minY;
  const s = Math.max(sizeX, sizeY) / opts.resolution;
  const pad = 2;
  const nx = Math.ceil(sizeX / s) + pad * 2; // cells
  const ny = Math.ceil(sizeY / s) + pad * 2;
  const X0 = sb.minX - pad * s;
  const Y0 = sb.minY - pad * s;
  const cx = nx + 1; // corners
  const cy = ny + 1;

  // per-corner columns
  const nC = cx * cy;
  const colD = new Float32Array(nC);
  const colR = new Float32Array(nC);
  const colHz = new Float32Array(nC);
  const colKz = new Float32Array(nC);
  const colTop = new Float32Array(nC);
  const col: Column = { d: 0, r: 0, hz: 0, kz: 1 };
  let maxTop = 0;
  for (let j = 0; j < cy; j++) {
    const y = Y0 + j * s;
    for (let i = 0; i < cx; i++) {
      const x = X0 + i * s;
      const d = sampleBilinear(field, field.d, x, y);
      const w = sampleBilinear(field, halfWidth, x, y);
      makeColumn(form, d, w, maxW, col);
      const k = j * cx + i;
      colD[k] = col.d;
      colR[k] = col.r;
      colHz[k] = col.hz;
      colKz[k] = col.kz;
      const top = columnTop(col);
      colTop[k] = top;
      if (top > maxTop) maxTop = top;
    }
  }

  const Z0 = -maxTop - pad * s;
  const nz = Math.ceil((2 * maxTop) / s) + pad * 2;

  // lazily evaluated corner values, two slices at a time
  const sliceVal = [new Float32Array(nC), new Float32Array(nC)];
  const sliceStamp = [new Int32Array(nC).fill(-1), new Int32Array(nC).fill(-1)];
  const evalCorner = (ci: number, k: number) => {
    const b = k & 1;
    if (sliceStamp[b][ci] === k) return sliceVal[b][ci];
    col.d = colD[ci];
    col.r = colR[ci];
    col.hz = colHz[ci];
    col.kz = colKz[ci];
    const v = evalColumn(col, Z0 + k * s);
    sliceVal[b][ci] = v;
    sliceStamp[b][ci] = k;
    return v;
  };

  // per-cell culling info
  const nCells = nx * ny;
  const cellMixed = new Uint8Array(nCells);
  const cellAllOut = new Uint8Array(nCells);
  const cellMinTop = new Float32Array(nCells);
  const cellMaxTop = new Float32Array(nCells);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c00 = j * cx + i;
      const cs = [c00, c00 + 1, c00 + cx, c00 + cx + 1];
      let inside = 0;
      let mn = Infinity;
      let mx = -Infinity;
      for (const c of cs) {
        const t = colTop[c];
        if (t >= 0) {
          inside++;
          if (t < mn) mn = t;
          if (t > mx) mx = t;
        }
      }
      const ci = j * nx + i;
      cellAllOut[ci] = inside === 0 ? 1 : 0;
      cellMixed[ci] = inside > 0 && inside < 4 ? 1 : 0;
      cellMinTop[ci] = inside ? mn : 0;
      cellMaxTop[ci] = inside ? mx : 0;
    }
  }

  // Per cell and per cube edge: which vertex the surface crossing on that edge belongs to.
  // A cell can hold up to four vertices (one per connected inside region), which keeps the
  // output 2-manifold where plain surface nets would pinch thin features into one vertex.
  const eV = [new Int32Array(nCells * 12), new Int32Array(nCells * 12)];
  const eStamp = [new Int32Array(nCells).fill(-1), new Int32Array(nCells).fill(-1)];
  const getEV = (i: number, j: number, k: number, e: number) => {
    const b = k & 1;
    const ci = j * nx + i;
    return eStamp[b][ci] === k ? eV[b][ci * 12 + e] : -1;
  };
  const parent = new Int8Array(8);
  const find = (a: number): number => {
    while (parent[a] !== a) a = parent[a];
    return a;
  };
  const compSum = new Float64Array(8 * 3);
  const compCount = new Int32Array(8);
  const compVert = new Int32Array(8);

  const est = Math.max(1024, Math.round(nCells * 2.5));
  const pos = new GrowF32(est * 3);
  const tri = new GrowU32(est * 6);
  let vCount = 0;
  let visited = 0;
  const vals = new Float32Array(8);
  const eps = s * 1.01;

  for (let k = 0; k < nz; k++) {
    const za = Z0 + k * s;
    const zb = za + s;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const ci = j * nx + i;
        if (cellAllOut[ci]) continue;
        // conservative culling: does the slab touch a skin or a wall?
        const mn = cellMinTop[ci];
        const mx = cellMaxTop[ci];
        let touch: boolean;
        if (cellMixed[ci]) touch = zb >= -mx - eps && za <= mx + eps;
        else touch = (za <= mx + eps && zb >= mn - eps) || (za <= -mn + eps && zb >= -mx - eps);
        if (!touch) continue;
        visited++;

        const c00 = j * cx + i;
        vals[0] = evalCorner(c00, k);
        vals[1] = evalCorner(c00 + 1, k);
        vals[2] = evalCorner(c00 + cx, k);
        vals[3] = evalCorner(c00 + cx + 1, k);
        vals[4] = evalCorner(c00, k + 1);
        vals[5] = evalCorner(c00 + 1, k + 1);
        vals[6] = evalCorner(c00 + cx, k + 1);
        vals[7] = evalCorner(c00 + cx + 1, k + 1);
        let mask = 0;
        for (let q = 0; q < 8; q++) if (vals[q] < 0) mask |= 1 << q;
        if (mask === 0 || mask === 255) continue;

        // connected components of inside corners (joined along cube edges only, so a face
        // with diagonal inside corners stays split in both cells that share it)
        for (let q = 0; q < 8; q++) parent[q] = q;
        for (let e = 0; e < 12; e++) {
          const [a, b] = EDGES[e];
          if (vals[a] < 0 && vals[b] < 0) {
            const ra = find(a), rb = find(b);
            if (ra !== rb) parent[ra] = rb;
          }
        }
        compSum.fill(0);
        compCount.fill(0);
        const b = k & 1;
        const base = ci * 12;
        for (let e = 0; e < 12; e++) {
          const [a, c] = EDGES[e];
          const fa = vals[a];
          const fc = vals[c];
          if ((fa < 0) === (fc < 0)) {
            eV[b][base + e] = -1;
            continue;
          }
          const t = fa / (fa - fc);
          const ax = a & 1, ay = (a >> 1) & 1, az = (a >> 2) & 1;
          const cx2 = c & 1, cy2 = (c >> 1) & 1, cz2 = (c >> 2) & 1;
          const root = find(fa < 0 ? a : c);
          compSum[root * 3] += ax + (cx2 - ax) * t;
          compSum[root * 3 + 1] += ay + (cy2 - ay) * t;
          compSum[root * 3 + 2] += az + (cz2 - az) * t;
          compCount[root]++;
          eV[b][base + e] = root; // temporarily the component root
        }
        for (let q = 0; q < 8; q++) {
          if (compCount[q] === 0) continue;
          const n = compCount[q];
          pos.push3(
            X0 + (i + compSum[q * 3] / n) * s,
            Y0 + (j + compSum[q * 3 + 1] / n) * s,
            Z0 + (k + compSum[q * 3 + 2] / n) * s,
          );
          compVert[q] = vCount++;
        }
        for (let e = 0; e < 12; e++) {
          const r = eV[b][base + e];
          if (r >= 0) eV[b][base + e] = compVert[r];
        }
        eStamp[b][ci] = k;

        // faces for the three grid edges leaving corner 0, shared with already visited cells
        const inside0 = (mask & 1) !== 0;
        // x edge: local edges 0 (this), 1 (j-1), 3 (j-1, k-1), 2 (k-1)
        if (((mask >> 1) & 1) !== (mask & 1) && j > 0 && k > 0) {
          const v0 = eV[b][base + 0], v1 = getEV(i, j - 1, k, 1), v2 = getEV(i, j - 1, k - 1, 3), v3 = getEV(i, j, k - 1, 2);
          if (v1 >= 0 && v2 >= 0 && v3 >= 0) quad(v0, v1, v2, v3, inside0);
        }
        // y edge: local edges 4 (this), 6 (k-1), 7 (i-1, k-1), 5 (i-1)
        if (((mask >> 2) & 1) !== (mask & 1) && k > 0 && i > 0) {
          const v0 = eV[b][base + 4], v1 = getEV(i, j, k - 1, 6), v2 = getEV(i - 1, j, k - 1, 7), v3 = getEV(i - 1, j, k, 5);
          if (v1 >= 0 && v2 >= 0 && v3 >= 0) quad(v0, v1, v2, v3, inside0);
        }
        // z edge: local edges 8 (this), 9 (i-1), 11 (i-1, j-1), 10 (j-1)
        if (((mask >> 4) & 1) !== (mask & 1) && i > 0 && j > 0) {
          const v0 = eV[b][base + 8], v1 = getEV(i - 1, j, k, 9), v2 = getEV(i - 1, j - 1, k, 11), v3 = getEV(i, j - 1, k, 10);
          if (v1 >= 0 && v2 >= 0 && v3 >= 0) quad(v0, v1, v2, v3, inside0);
        }
      }
    }
  }

  function quad(a: number, b: number, c: number, d: number, insideCorner: boolean) {
    // winding so triangles face out of the solid (positive signed volume)
    if (!insideCorner) {
      const t = b;
      b = d;
      d = t;
    }
    // split along the shorter diagonal
    const P = pos.a;
    const dac = dist2(P, a, c);
    const dbd = dist2(P, b, d);
    if (dac <= dbd) {
      tri.push3(a, b, c);
      tri.push3(a, c, d);
    } else {
      tri.push3(a, b, d);
      tri.push3(b, c, d);
    }
  }

  const positions = pos.view();
  const indices = tri.view();

  // project onto the continuous surface and take normals from its gradient
  const steps = opts.projectSteps ?? 2;
  const normals = new Float32Array(positions.length);
  const F = (x: number, y: number, z: number) => {
    const d = sampleBilinear(field, field.d, x, y);
    const w = sampleBilinear(field, halfWidth, x, y);
    makeColumn(form, d, w, maxW, col);
    return evalColumn(col, z);
  };
  const h = Math.max(s * 0.35, field.px * 0.75);
  const maxStep = s * 0.5;
  for (let v = 0; v < vCount; v++) {
    let x = positions[v * 3];
    let y = positions[v * 3 + 1];
    let z = positions[v * 3 + 2];
    let gx = 0, gy = 0, gz = 1;
    for (let it = 0; it <= steps; it++) {
      gx = (F(x + h, y, z) - F(x - h, y, z)) / (2 * h);
      gy = (F(x, y + h, z) - F(x, y - h, z)) / (2 * h);
      gz = (F(x, y, z + h) - F(x, y, z - h)) / (2 * h);
      if (it === steps) break;
      const f = F(x, y, z);
      const g2 = gx * gx + gy * gy + gz * gz;
      if (g2 < 1e-12) break;
      let dx = (f * gx) / g2, dy = (f * gy) / g2, dz = (f * gz) / g2;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len > maxStep) {
        const sc = maxStep / len;
        dx *= sc;
        dy *= sc;
        dz *= sc;
      }
      x -= dx;
      y -= dy;
      z -= dz;
    }
    positions[v * 3] = x;
    positions[v * 3 + 1] = y;
    positions[v * 3 + 2] = z;
    const gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    normals[v * 3] = gx / gl;
    normals[v * 3 + 1] = gy / gl;
    normals[v * 3 + 2] = gz / gl;
  }

  // planar UVs over the outline bounds
  const size = Math.max(sizeX, sizeY);
  const uvs = new Float32Array(vCount * 2);
  for (let v = 0; v < vCount; v++) {
    uvs[v * 2] = (positions[v * 3] - sb.minX) / size;
    uvs[v * 2 + 1] = (positions[v * 3 + 1] - sb.minY) / size;
  }

  return {
    positions,
    normals,
    uvs,
    indices,
    bounds: { ...sb, maxZ: maxTop },
    stats: {
      cells: nx * ny * nz,
      visited,
      vertices: vCount,
      triangles: indices.length / 3,
      ms: performance.now() - t0,
    },
  };
}

function dist2(P: Float32Array, a: number, b: number) {
  const dx = P[a * 3] - P[b * 3];
  const dy = P[a * 3 + 1] - P[b * 3 + 1];
  const dz = P[a * 3 + 2] - P[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}

/** Topology check used by tests: every edge must be shared by exactly two triangles. */
export function meshTopology(indices: Uint32Array, vertexCount: number) {
  const edges = new Map<number, number>();
  const key = (a: number, b: number) => (a < b ? a * vertexCount + b : b * vertexCount + a);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const k = key(p, q);
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  let boundary = 0;
  let nonManifold = 0;
  for (const n of edges.values()) {
    if (n === 1) boundary++;
    else if (n > 2) nonManifold++;
  }
  const V = vertexCount;
  const E = edges.size;
  const Fc = indices.length / 3;
  const euler = V - E + Fc;
  return { boundary, nonManifold, euler, genus: (2 - euler) / 2, closed: boundary === 0 && nonManifold === 0 };
}

/** Signed volume (positive when triangles wind counter-clockwise seen from outside). */
export function signedVolume(positions: Float32Array, indices: Uint32Array) {
  let v = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}
