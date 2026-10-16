import * as THREE from 'three/webgpu';

/**
 * Material presets. Every preset is a MeshPhysicalMaterial so both the raster preview and
 * the path tracer read the same values. Colors are sRGB hex (converted by three.js).
 *
 * Green clay is a satin plastic: diffuse + a light clearcoat. No sheen: it adds a white haze at
 * grazing angles that the references don't have.
 */

export interface MaterialSpec {
  id: string;
  name: string;
  color: string;
  roughness: number;
  metalness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  /** dielectric specular strength (1 = 4% at normal incidence) */
  specularIntensity?: number;
  /** self-glow in the base hue: stands in for the extra light the references aim at accents */
  emissive?: string;
  emissiveIntensity?: number;
  sheen?: number;
  sheenColor?: string;
  sheenRoughness?: number;
  /** vertex-color gradient stops (sRGB hex) along the gradient axis */
  gradient?: string[];
  /** gradient direction in object space, normalized by the mesher bounds */
  gradientAngle?: number;
  doubleSided?: boolean;
}

export const GREEN_CLAY: MaterialSpec[] = [
  {
    // albedo fitted to the reference safe under the filmic view transform: linear (0.066, 0.5, 0.0095)
    id: 'green-clay',
    name: 'Green clay',
    color: '#49bc18',
    roughness: 0.55,
    specularIntensity: 0.3,
    clearcoat: 0.05,
    clearcoatRoughness: 0.35,
  },
  {
    id: 'orange-gradient',
    name: 'Orange gradient',
    color: '#ffffff',
    gradient: ['#ff9a12', '#ff6400', '#f24000'],
    gradientAngle: -35,
    roughness: 0.5,
    specularIntensity: 0.4,
    clearcoat: 0.1,
    clearcoatRoughness: 0.3,
    emissive: '#ff5200',
    emissiveIntensity: 0.45,
  },
  {
    id: 'coin-grey',
    name: 'Coin grey',
    color: '#f8f9f6',
    roughness: 0.5,
    specularIntensity: 0.5,
    clearcoat: 0.1,
    clearcoatRoughness: 0.3,
  },
  {
    id: 'white-plastic',
    name: 'White plastic',
    color: '#f2f3ef',
    roughness: 0.45,
    clearcoat: 0.25,
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

/** Swatches in the material panel: the Green clay set first, then neutrals and metals. */
export const MATERIAL_LIBRARY: MaterialSpec[] = [
  ...GREEN_CLAY.filter((m) => m.id !== 'chrome'),
  { id: 'mint-clay', name: 'Mint clay', color: '#3ccf9a', roughness: 0.55, clearcoat: 0.15, clearcoatRoughness: 0.35 },
  { id: 'sky-clay', name: 'Sky clay', color: '#3d8bff', roughness: 0.55, clearcoat: 0.15, clearcoatRoughness: 0.35 },
  { id: 'coral', name: 'Coral', color: '#ff5a4e', roughness: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.3 },
  { id: 'graphite', name: 'Graphite', color: '#2b2d31', roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.25 },
  { id: 'gold', name: 'Gold', color: '#f2c14e', roughness: 0.22, metalness: 1 },
  GREEN_CLAY.find((m) => m.id === 'chrome')!,
];

/** CSS color for swatch spheres and the material button. */
export function swatchColor(spec: MaterialSpec) {
  if (spec.gradient) return `linear-gradient(135deg, ${spec.gradient.join(', ')})`;
  return spec.color;
}

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
    specularIntensity: spec.specularIntensity ?? 1,
    emissive: new THREE.Color(spec.emissive ?? '#000000'),
    emissiveIntensity: spec.emissiveIntensity ?? 0,
    sheen: spec.sheen ?? 0,
    sheenColor: new THREE.Color(spec.sheenColor ?? '#ffffff'),
    sheenRoughness: spec.sheenRoughness ?? 1,
    vertexColors: Boolean(spec.gradient),
    side: spec.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  m.name = spec.id;
  return m;
}

/** Shader-relevant switches: a change here needs a pipeline rebuild, value changes don't. */
function featureKey(m: THREE.MeshPhysicalMaterial) {
  return [m.vertexColors, m.side, m.clearcoat > 0, m.sheen > 0, m.metalness > 0, m.emissiveIntensity > 0].join();
}

/**
 * Writes a spec into an existing material, so slider drags reuse the compiled pipeline. Flags a
 * rebuild only when a feature switches on or off.
 */
export function syncMaterial(m: THREE.MeshPhysicalMaterial, spec: MaterialSpec) {
  const before = featureKey(m);
  m.color.set(spec.color);
  m.roughness = spec.roughness;
  m.metalness = spec.metalness ?? 0;
  m.clearcoat = spec.clearcoat ?? 0;
  m.clearcoatRoughness = spec.clearcoatRoughness ?? 0;
  m.specularIntensity = spec.specularIntensity ?? 1;
  m.emissive.set(spec.emissive ?? '#000000');
  m.emissiveIntensity = spec.emissiveIntensity ?? 0;
  m.sheen = spec.sheen ?? 0;
  m.sheenColor.set(spec.sheenColor ?? '#ffffff');
  m.sheenRoughness = spec.sheenRoughness ?? 1;
  m.vertexColors = Boolean(spec.gradient);
  m.side = spec.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
  m.name = spec.id;
  if (featureKey(m) !== before) m.needsUpdate = true;
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
