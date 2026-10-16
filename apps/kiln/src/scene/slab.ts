import * as THREE from 'three/webgpu';

/**
 * Profile sweeps around rounded rectangles: coins, tiles, dials, handles and the safe body with
 * its door groove. Every ring of the sweep is a rounded rectangle; a 2D profile (half height `w`,
 * depth `z`, profile normal) says how the rings stack. Normals are analytic, so flat faces stay
 * perfectly flat and rounded edges perfectly smooth, at a few thousand triangles per part.
 */

export interface ProfilePoint {
  /** half height of the ring; the half width is `w + (width - height) / 2` */
  w: number;
  z: number;
  /** profile normal: radial (outward) and z components */
  nw: number;
  nz: number;
  /** corner radius of this ring; defaults to the slab's corner radius offset by the inset */
  r?: number;
}

/**
 * Quarter or partial circle in the (w, z) profile plane, angles in degrees (0 = +w, 90 = +z).
 * `concave` flips the normals for grooves and inner fillets.
 */
export function arc(cw: number, cz: number, radius: number, a0: number, a1: number, steps = 8, concave = false): ProfilePoint[] {
  const out: ProfilePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((a0 + ((a1 - a0) * i) / steps) * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.push({ w: cw + radius * c, z: cz + radius * s, nw: concave ? -c : c, nz: concave ? -s : s });
  }
  return out;
}

export interface SweepOptions {
  /** full width and height of the outer outline */
  width: number;
  height: number;
  /** outline corner radius at w = height / 2 */
  corner: number;
  /** arc segments per outline corner */
  segments?: number;
  /** fan the first / last ring into a flat cap */
  capStart?: boolean;
  capEnd?: boolean;
  /** connect the last ring back to the first (rings, handles) */
  closed?: boolean;
}

/** Sweeps a profile around a rounded rectangle outline. */
export function sweep(profile: ProfilePoint[], opts: SweepOptions): THREE.BufferGeometry {
  const M = opts.segments ?? 16;
  const N = 4 * (M + 1);
  const dxw = (opts.width - opts.height) / 2;
  const outer = opts.height / 2;
  // outline directions: shared by every ring so corresponding points share a normal
  const cos = new Float32Array(N);
  const sin = new Float32Array(N);
  const quadrant = new Int8Array(N);
  for (let k = 0; k < 4; k++) {
    for (let j = 0; j <= M; j++) {
      const a = ((k + j / M) * Math.PI) / 2;
      const i = k * (M + 1) + j;
      cos[i] = Math.cos(a);
      sin[i] = Math.sin(a);
      quadrant[i] = k;
    }
  }
  const signX = [1, -1, -1, 1];
  const signY = [1, 1, -1, -1];

  const positions: number[] = [];
  const normals: number[] = [];
  const tangents: number[] = [];
  const uvs: number[] = [];
  const rings = profile.length;
  for (const p of profile) {
    const hw = p.w + dxw;
    const hh = p.w;
    const rDefault = opts.corner - (outer - p.w);
    const r = Math.max(0, Math.min(p.r ?? rDefault, hw, hh));
    for (let i = 0; i < N; i++) {
      const k = quadrant[i];
      const cx = signX[k] * (hw - r);
      const cy = signY[k] * (hh - r);
      const x = cx + r * cos[i];
      const y = cy + r * sin[i];
      positions.push(x, y, p.z);
      const nx = cos[i] * p.nw;
      const ny = sin[i] * p.nw;
      const len = Math.hypot(nx, ny, p.nz) || 1;
      normals.push(nx / len, ny / len, p.nz / len);
      // analytic tangent along the outline: never degenerate, unlike tangents derived from planar UVs
      tangents.push(-sin[i], cos[i], 0, 1);
      uvs.push(x, y);
    }
  }
  const index: number[] = [];
  const tri = (a: number, b: number, c: number) => {
    // orient each triangle by the analytic normals: robust for any profile direction
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const ux = positions[b * 3] - ax, uy = positions[b * 3 + 1] - ay, uz = positions[b * 3 + 2] - az;
    const vx = positions[c * 3] - ax, vy = positions[c * 3 + 1] - ay, vz = positions[c * 3 + 2] - az;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const area = Math.hypot(fx, fy, fz);
    if (area < 1e-12) return;
    const nx = normals[a * 3] + normals[b * 3] + normals[c * 3];
    const ny = normals[a * 3 + 1] + normals[b * 3 + 1] + normals[c * 3 + 1];
    const nz = normals[a * 3 + 2] + normals[b * 3 + 2] + normals[c * 3 + 2];
    if (fx * nx + fy * ny + fz * nz >= 0) index.push(a, b, c);
    else index.push(a, c, b);
  };
  const bands = opts.closed ? rings : rings - 1;
  for (let ri = 0; ri < bands; ri++) {
    const r0 = ri * N;
    const r1 = ((ri + 1) % rings) * N;
    for (let i = 0; i < N; i++) {
      const i1 = (i + 1) % N;
      tri(r0 + i, r0 + i1, r1 + i1);
      tri(r0 + i, r1 + i1, r1 + i);
    }
  }
  const cap = (ring: number) => {
    const p = profile[ring];
    const c = positions.length / 3;
    positions.push(0, 0, p.z);
    normals.push(0, 0, Math.sign(p.nz) || 1);
    tangents.push(1, 0, 0, 1);
    uvs.push(0, 0);
    for (let i = 0; i < N; i++) tri(c, ring * N + i, ring * N + ((i + 1) % N));
  };
  if (opts.capStart) cap(0);
  if (opts.capEnd) cap(rings - 1);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('tangent', new THREE.Float32BufferAttribute(tangents, 4));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  return g;
}

export interface SlabOptions {
  width: number;
  height: number;
  depth: number;
  /** outline corner radius; height / 2 on a square makes a disc */
  corner: number;
  /** front / back edge radius */
  edge: number;
  backEdge?: number;
  segments?: number;
}

/** Rounded slab centered on the origin, front face toward +Z: tiles, coins, dots, bars. */
export function slab(o: SlabOptions): THREE.BufferGeometry {
  const h = o.height / 2;
  const d = o.depth / 2;
  const e = Math.min(o.edge, d, h);
  const eb = Math.min(o.backEdge ?? o.edge, d, h);
  const profile = [...arc(h - eb, -d + eb, eb, -90, 0, 6), ...arc(h - e, d - e, e, 0, 90, 8)];
  return sweep(profile, { width: o.width, height: o.height, corner: o.corner, segments: o.segments, capStart: true, capEnd: true });
}

/** Disc of radius `radius`, front face toward +Z. */
export function disc(radius: number, depth: number, edge: number, backEdge?: number, segments = 24) {
  return slab({ width: radius * 2, height: radius * 2, depth, corner: radius, edge, backEdge, segments });
}

export interface LoopOptions {
  /** outer outline */
  width: number;
  height: number;
  corner: number;
  /** wall thickness (the hole is the outline inset by this) */
  wall: number;
  holeCorner?: number;
  depth: number;
  edge: number;
  segments?: number;
}

/** Closed loop (a ring with a hole): dial rings, handles. Front face toward +Z. */
export function loop(o: LoopOptions): THREE.BufferGeometry {
  const ho = o.height / 2;
  const hi = ho - o.wall;
  const d = o.depth / 2;
  const e = Math.min(o.edge, o.wall / 2, d);
  const rIn = o.holeCorner ?? Math.max(0, o.corner - o.wall);
  const outer = (pts: ProfilePoint[]) => pts.map((p) => ({ ...p, r: o.corner - (ho - p.w) }));
  const inner = (pts: ProfilePoint[]) => pts.map((p) => ({ ...p, r: rIn + (p.w - hi) }));
  const profile = [
    // inner wall, back to front (normals face the hole)
    ...inner(arc(hi + e, -d + e, e, 270, 180, 5)),
    ...inner(arc(hi + e, d - e, e, 180, 90, 6)),
    // front face, then outer wall front to back
    ...outer(arc(ho - e, d - e, e, 90, 0, 6)),
    ...outer(arc(ho - e, -d + e, e, 0, -90, 5)),
  ];
  return sweep(profile, { width: o.width, height: o.height, corner: o.corner, segments: o.segments, closed: true });
}
