import * as THREE from 'three/webgpu';

/**
 * Material presets. Every preset is a MeshPhysicalMaterial so both the raster preview and
 * the path tracer read the same values. Colors are sRGB hex (converted by three.js).
 *
 * Green clay has no subsurface scattering in either renderer, so "clay" is diffuse +
 * sheen + a light clearcoat lit by a bright studio dome.
 */

export interface MaterialSpec {
  id: string;
  name: string;
  color: string;
  roughness: number;
  metalness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  sheen?: number;
  sheenColor?: string;
  sheenRoughness?: number;
  /** vertex-color gradient stops (sRGB hex) along the gradient axis */
  gradient?: string[];
  /** gradient direction in object space, normalized by the mesher bounds */
  gradientAngle?: number;
}

export const GREEN_CLAY: MaterialSpec[] = [
  {
    id: 'green-satin',
    name: 'Green satin',
    color: '#4fbf2b',
    roughness: 0.5,
    clearcoat: 0.25,
    clearcoatRoughness: 0.35,
    sheen: 0.35,
    sheenColor: '#c9f7a0',
    sheenRoughness: 0.55,
  },
  {
    id: 'orange-gradient',
    name: 'Orange gradient',
    color: '#ffffff',
    gradient: ['#ffb21a', '#ff6a00', '#f03c00'],
    gradientAngle: -35,
    roughness: 0.42,
    clearcoat: 0.3,
    clearcoatRoughness: 0.3,
    sheen: 0.25,
    sheenColor: '#ffd9a8',
    sheenRoughness: 0.5,
  },
  {
    id: 'coin-grey',
    name: 'Coin grey',
    color: '#d8dcd4',
    roughness: 0.45,
    clearcoat: 0.3,
    clearcoatRoughness: 0.3,
    sheen: 0.2,
    sheenColor: '#ffffff',
    sheenRoughness: 0.6,
  },
  {
    id: 'white-plastic',
    name: 'White plastic',
    color: '#f2f3ef',
    roughness: 0.4,
    clearcoat: 0.35,
    clearcoatRoughness: 0.25,
  },
  {
    id: 'chrome',
    name: 'Chrome',
    color: '#e9ebee',
    roughness: 0.07,
    metalness: 1,
  },
];

export function findMaterial(id: string, list: MaterialSpec[] = GREEN_CLAY) {
  const m = list.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown material ${id}`);
  return m;
}

export function buildMaterial(spec: MaterialSpec): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(spec.color),
    roughness: spec.roughness,
    metalness: spec.metalness ?? 0,
    clearcoat: spec.clearcoat ?? 0,
    clearcoatRoughness: spec.clearcoatRoughness ?? 0,
    sheen: spec.sheen ?? 0,
    sheenColor: new THREE.Color(spec.sheenColor ?? '#ffffff'),
    sheenRoughness: spec.sheenRoughness ?? 1,
    vertexColors: Boolean(spec.gradient),
  });
  m.name = spec.id;
  return m;
}

/**
 * Writes a 4-component float vertex-color gradient along `angle` (degrees, 0 = +X, 90 = +Y)
 * across the geometry's bounds. Float colors avoid the 8-bit atlas banding in 16-bit exports.
 */
export function applyGradient(geometry: THREE.BufferGeometry, stops: string[], angle = 0) {
  const pos = geometry.getAttribute('position');
  const a = (angle * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getX(i) * dx + pos.getY(i) * dy;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  const cols = stops.map((s) => new THREE.Color(s)); // linear working space
  const out = new Float32Array(pos.count * 4);
  const span = max - min || 1;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getX(i) * dx + pos.getY(i) * dy - min) / span;
    const f = t * (cols.length - 1);
    const k = Math.min(cols.length - 2, Math.floor(f));
    const w = f - k;
    const c0 = cols[k];
    const c1 = cols[k + 1];
    out[i * 4] = c0.r + (c1.r - c0.r) * w;
    out[i * 4 + 1] = c0.g + (c1.g - c0.g) * w;
    out[i * 4 + 2] = c0.b + (c1.b - c0.b) * w;
    out[i * 4 + 3] = 1;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(out, 4));
}

/** Neutral white vertex colors so every mesh shares the same attribute layout. */
export function ensureWhiteColors(geometry: THREE.BufferGeometry) {
  if (geometry.getAttribute('color')) return;
  const n = geometry.getAttribute('position').count;
  const out = new Float32Array(n * 4).fill(1);
  geometry.setAttribute('color', new THREE.BufferAttribute(out, 4));
}
