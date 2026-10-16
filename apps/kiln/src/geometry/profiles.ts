/**
 * Form profiles. Every form is 2.5D: an implicit F(d, z) of the 2D signed distance d to the
 * outline (negative inside) and the height z. F < 0 is solid.
 *
 * All modes share one primitive: the exact rounded-extrusion SDF in (d, z·k) space, with a bevel
 * radius r clamped per column to the local half-width so thin strokes stay solid.
 */

export type FormMode = 'extrude' | 'soft' | 'inflate';

export interface FormParams {
  mode: FormMode;
  /** total thickness, world units */
  depth: number;
  /** 0..1: bevel radius as a fraction of the half-depth (extrude/soft) */
  roundness: number;
  /** 0..1: how far the inflate curve reaches inward, as a fraction of the widest half-width */
  puff: number;
}

export const FORM_DEFAULTS: Record<FormMode, FormParams> = {
  extrude: { mode: 'extrude', depth: 0.22, roundness: 0.22, puff: 0 },
  soft: { mode: 'soft', depth: 0.26, roundness: 1, puff: 0 },
  inflate: { mode: 'inflate', depth: 0.3, roundness: 1, puff: 0.7 },
};

/** Per-column parameters for the implicit. */
export interface Column {
  /** signed 2D distance */
  d: number;
  /** bevel radius in (d, z') space */
  r: number;
  /** half-height in z' space */
  hz: number;
  /** z' = z * kz */
  kz: number;
}

/** Exact SDF of a rounded rectangle cross-section: |z'| <= hz, d <= 0, corners rounded by r. */
export function roundedExtrusion(d: number, zp: number, hz: number, r: number): number {
  const wx = d + r;
  const wy = Math.abs(zp) - hz + r;
  const mx = wx > 0 ? wx : 0;
  const my = wy > 0 ? wy : 0;
  const inside = Math.min(Math.max(wx, wy), 0);
  return inside + Math.sqrt(mx * mx + my * my) - r;
}

export function evalColumn(c: Column, z: number): number {
  return roundedExtrusion(c.d, z * c.kz, c.hz, c.r);
}

/** Height of the top surface over a column (z >= 0), or -1 if the column is outside the shape. */
export function columnTop(c: Column): number {
  if (c.d >= 0) return -1;
  const t = c.d + c.r; // <= r
  let top: number;
  if (t <= 0) top = c.hz;
  else {
    const s = c.r * c.r - t * t;
    top = c.hz - c.r + (s > 0 ? Math.sqrt(s) : 0);
  }
  return top / c.kz;
}

/**
 * Builds the column for a sample given the form, the signed distance d and the local
 * half-width w (deepest interior distance nearby), plus the widest half-width of the shape.
 */
export function makeColumn(form: FormParams, d: number, w: number, maxW: number, out: Column): Column {
  const h = form.depth / 2;
  if (form.mode === 'inflate') {
    // elliptical bevel: reaches `puff * maxW` inward, rises to the full half-depth
    const reach = Math.max(1e-4, form.puff * maxW);
    const r = Math.max(1e-5, Math.min(reach, 0.9 * Math.max(w, 1e-5)));
    // thin parts get lower, so they read as tubes rather than walls
    const hz = h * Math.sqrt(Math.min(1, r / reach));
    out.d = d;
    out.r = r;
    out.kz = r / hz; // scale z so the profile is an ellipse with semi-axes (r, hz)
    out.hz = r; // in z' space the half-height equals r (fully rounded top edge)
    return out;
  }
  const r = Math.max(1e-5, Math.min(form.roundness * h, 0.9 * Math.max(w, 1e-5), h));
  out.d = d;
  out.r = r;
  out.hz = h;
  out.kz = 1;
  return out;
}
