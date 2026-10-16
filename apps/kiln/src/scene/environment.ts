import * as THREE from 'three/webgpu';

/**
 * Procedural studio environment: a soft gradient dome plus rectangular softboxes.
 *
 * Lights are panels in the environment rather than scene lights, so the path tracer
 * importance-samples them through the environment map (fast, noise-free convergence),
 * and clearcoat/metal reflections show the same panels a photo studio would.
 *
 * Angles: azimuth 0 = toward +Z (in front of the object, behind the default camera),
 * +90 = toward +X (right). Elevation 0 = horizon, +90 = straight up.
 */

export type RGB = [number, number, number];

export interface Softbox {
  /** degrees */
  az: number;
  /** degrees */
  el: number;
  /** angular width / height, degrees */
  w: number;
  h: number;
  /** radiance multiplier (linear) */
  intensity: number;
  color?: RGB;
  /** 0 = hard rectangle edge, 1 = very soft */
  soft?: number;
  /** superellipse exponent: 2 = ellipse, 8 = rounded rectangle */
  shape?: number;
}

export interface StudioSpec {
  zenith: RGB;
  horizon: RGB;
  ground: RGB;
  panels: Softbox[];
}

const DEG = Math.PI / 180;

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Kelvin → linear RGB (normalized so the brightest channel is 1). Tanner Helland fit. */
export function kelvinToRgb(k: number): RGB {
  const t = k / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = (v: number) => {
    const s = Math.min(255, Math.max(0, v)) / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const out: RGB = [c(r), c(g), c(b)];
  const m = Math.max(...out);
  return [out[0] / m, out[1] / m, out[2] / m];
}

/** Fills an RGBA float buffer (row 0 = bottom, v = 0) with the studio. */
export function renderStudio(spec: StudioSpec, width = 1024, height = 512): Float32Array {
  const data = new Float32Array(width * height * 4);
  const panels = spec.panels.map((p) => ({
    az: p.az * DEG,
    el: p.el * DEG,
    hw: (p.w * DEG) / 2,
    hh: (p.h * DEG) / 2,
    soft: p.soft ?? 0.35,
    shape: p.shape ?? 6,
    color: p.color ?? ([1, 1, 1] as RGB),
    intensity: p.intensity,
  }));

  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    const el = (v - 0.5) * Math.PI; // -90..90
    const cosEl = Math.cos(el);
    // sky gradient
    let base: RGB;
    if (el >= 0) {
      const t = Math.pow(el / (Math.PI / 2), 0.6);
      base = [
        spec.horizon[0] + (spec.zenith[0] - spec.horizon[0]) * t,
        spec.horizon[1] + (spec.zenith[1] - spec.horizon[1]) * t,
        spec.horizon[2] + (spec.zenith[2] - spec.horizon[2]) * t,
      ];
    } else {
      const t = smoothstep(0, 0.35, -el / (Math.PI / 2));
      base = [
        spec.horizon[0] + (spec.ground[0] - spec.horizon[0]) * t,
        spec.horizon[1] + (spec.ground[1] - spec.horizon[1]) * t,
        spec.horizon[2] + (spec.ground[2] - spec.horizon[2]) * t,
      ];
    }
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      // three.js equirect: u = atan2(d.z, d.x) / 2π + 0.5
      const phi = (u - 0.5) * Math.PI * 2;
      const dx = cosEl * Math.cos(phi);
      const dz = cosEl * Math.sin(phi);
      const az = Math.atan2(dx, dz); // 0 toward +Z, +90° toward +X

      let r = base[0], g = base[1], b = base[2];
      for (const p of panels) {
        const lx = (wrapAngle(az - p.az) * Math.cos(p.el)) / p.hw;
        const ly = (el - p.el) / p.hh;
        if (Math.abs(lx) > 1.6 || Math.abs(ly) > 1.6) continue;
        const d = Math.pow(Math.pow(Math.abs(lx), p.shape) + Math.pow(Math.abs(ly), p.shape), 1 / p.shape);
        const m = 1 - smoothstep(1 - p.soft, 1 + p.soft * 0.25, d);
        if (m <= 0) continue;
        r += p.color[0] * p.intensity * m;
        g += p.color[1] * p.intensity * m;
        b += p.color[2] * p.intensity * m;
      }
      const o = (y * width + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 1;
    }
  }
  return data;
}

export function studioTexture(spec: StudioSpec, width = 1024, height = 512): THREE.DataTexture {
  const tex = new THREE.DataTexture(
    renderStudio(spec, width, height),
    width,
    height,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** High-key studio for the Green clay style: bright dome, big soft key from top-left. */
export function greenClayStudio(opts: { keyAz?: number; keyEl?: number; intensity?: number; softness?: number; warmth?: number } = {}): StudioSpec {
  const {
    keyAz = -40,
    keyEl = 42,
    intensity = 1,
    softness = 0.5,
    warmth = 5600,
  } = opts;
  const keyColor = kelvinToRgb(warmth);
  const size = 50 + softness * 50; // degrees
  return {
    zenith: [0.95, 0.96, 0.97],
    horizon: [0.78, 0.8, 0.8],
    ground: [0.3, 0.31, 0.3],
    panels: [
      // key: big softbox, top-left of camera
      { az: keyAz, el: keyEl, w: size, h: size * 0.8, intensity: 4.2 * intensity * (75 / size) ** 2, color: keyColor, soft: 0.45 },
      // fill: low, front-right
      { az: 55, el: 12, w: 70, h: 40, intensity: 0.9 * intensity, soft: 0.6 },
      // top strip: highlights on top faces
      { az: 160, el: 62, w: 140, h: 22, intensity: 2.0 * intensity, soft: 0.5 },
      // rim: behind-right edge light
      { az: 125, el: 20, w: 26, h: 70, intensity: 1.6 * intensity, soft: 0.4 },
    ],
  };
}
