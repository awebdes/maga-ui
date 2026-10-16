import * as THREE from 'three/webgpu';
import { slab, disc } from '../scene/slab';
import { buildBriefcase, buildSafeModel } from '../examples/safe';
import type { FormValues, Kind, ModelId } from './scene';

/**
 * Canonical primitives, about one unit across at scale 1, front toward +Z. Every mesh carries
 * `userData.slot`, the material slot it takes. Depth and roundness come from the dock (percent):
 * depth is a share of the primitive's size, roundness a share of half the depth.
 */

function mesh(g: THREE.BufferGeometry, slot: string, name: string) {
  const m = new THREE.Mesh(g);
  m.name = name;
  m.userData.slot = slot;
  return m;
}

const edgeOf = (depth: number, roundness: number) => Math.max(0.001, (depth / 2) * Math.min(1, roundness / 100));

/** Percent sign: dots and a slash, about 0.4 across at scale 1 (as in the reference safe). */
function percent(f: FormValues) {
  const depth = (f.depth / 100) * 0.41;
  const edge = edgeOf(depth, f.roundness);
  const g = new THREE.Group();
  const dotA = mesh(disc(0.059, depth, Math.min(edge, 0.05)), 'main', 'percent-dot');
  dotA.position.set(-0.101, 0.098, 0);
  const dotB = mesh(disc(0.059, depth, Math.min(edge, 0.05)), 'main', 'percent-dot');
  dotB.position.set(0.101, -0.098, 0);
  const slash = mesh(slab({ width: 0.38, height: 0.062, depth, corner: 0.031, edge: Math.min(edge, 0.03) }), 'main', 'percent-slash');
  slash.rotation.z = Math.PI / 4;
  g.add(dotA, dotB, slash);
  return g;
}

/** Builds the meshes of a non-glyph object. Badges get their coin here; the icon is baked. */
export function buildPrimitive(kind: Kind, f: FormValues | undefined, model?: ModelId): THREE.Group {
  const g = new THREE.Group();
  const form = f ?? { mode: 'extrude' as const, depth: 15, roundness: 70, puff: 0 };
  switch (kind) {
    case 'coin': {
      const depth = form.depth / 100;
      g.add(mesh(disc(0.5, depth, edgeOf(depth, form.roundness)), 'main', 'coin'));
      break;
    }
    case 'badge': {
      g.add(mesh(disc(0.5, BADGE_COIN_DEPTH, 0.032), 'coin', 'badge-coin'));
      break;
    }
    case 'tile': {
      const depth = form.depth / 100;
      g.add(mesh(slab({ width: 1, height: 1, depth, corner: 0.16, edge: edgeOf(depth, form.roundness) }), 'main', 'tile'));
      break;
    }
    case 'plate': {
      const depth = form.depth / 100;
      g.add(mesh(slab({ width: 1.24, height: 1, depth, corner: 0.16, edge: edgeOf(depth, form.roundness) }), 'main', 'plate'));
      break;
    }
    case 'pill': {
      const depth = (form.depth / 100) * 1;
      const edge = edgeOf(depth, form.roundness);
      g.add(mesh(slab({ width: 1, height: 0.4, depth, corner: 0.2, edge }), 'track', 'toggle-track'));
      const r = 0.168;
      const knob = mesh(disc(r, depth * 1.35, r * 0.35), 'knob', 'toggle-knob');
      knob.position.set(-0.3, 0, depth * 0.35);
      g.add(knob);
      break;
    }
    case 'percent':
      g.add(...percent(form).children);
      break;
    case 'model':
      g.add(...(model === 'briefcase' ? buildBriefcase() : buildSafeModel()).children);
      break;
    case 'glyph':
      break;
  }
  return g;
}

/** Badge coin: one unit across; the icon sits on its front face. */
export const BADGE_COIN_DEPTH = 0.1;
/** Icon size on a badge, as a share of the coin diameter. */
export const BADGE_ICON_SCALE = 0.42;
