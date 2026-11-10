/**
 * Project document. Everything the editor shows is derived from this JSON plus the media store.
 *
 * Animation model: a key is a snapshot of one object's animatable state (device, camera) at a time.
 * The timeline shows one row per object; editing an object that already has keys writes a key at
 * the playhead, editing an object without keys changes its base state. Modifiers (float, spin) are
 * procedural and loop seamlessly because they count whole cycles per clip.
 */

export type Vec3 = [number, number, number];
export type ModelId = 'phone' | 'android' | 'tablet' | 'laptop';
export type Ease = 'linear' | 'smooth' | 'out' | 'spring' | 'back' | 'hold';
export const EASES: { id: Ease; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'smooth', label: 'Smooth' },
  { id: 'out', label: 'Out' },
  { id: 'spring', label: 'Spring' },
  { id: 'back', label: 'Back' },
  { id: 'hold', label: 'Hold' },
];

export interface DeviceState {
  pos: Vec3;
  /** degrees, order YXZ: yaw around world up, then pitch, then roll */
  rot: Vec3;
  scale: number;
  /** screen content scroll, 0 = top, 1 = bottom */
  scroll: number;
}
export interface CameraState {
  yaw: number;
  pitch: number;
  roll: number;
  dist: number;
  /** focal length, mm on a full-frame sensor */
  lens: number;
  target: Vec3;
}
export interface Key<S> {
  id: string;
  t: number;
  /** how motion arrives at this key */
  ease: Ease;
  s: S;
}

export interface Device {
  id: string;
  name: string;
  model: ModelId;
  finish: string;
  media: string | null;
  /** 0..1.5, screen brightness */
  glow: number;
  /** 0..1, reflection on the cover glass */
  glare: number;
  /** laptop lid angle, degrees from closed */
  lid: number;
  base: DeviceState;
  keys: Key<DeviceState>[];
  /** float: amplitude (world units) and whole cycles per clip */
  float: { amp: number; cycles: number };
  /** whole turns per clip around the device's own up axis */
  spin: number;
  visible: boolean;
}

export type TextAnim = 'none' | 'fade' | 'rise' | 'blur' | 'type' | 'pop';
export interface TextLayer {
  id: string;
  name: string;
  text: string;
  font: string;
  weight: number;
  /** cap height relative to frame height */
  size: number;
  color: string;
  align: 'left' | 'center' | 'right';
  /** anchor in frame, 0..1 */
  x: number;
  y: number;
  tracking: number;
  leading: number;
  layer: 'front' | 'behind';
  anim: TextAnim;
  start: number;
  dur: number;
  visible: boolean;
}

export type BgKind = 'solid' | 'linear' | 'radial' | 'mesh' | 'transparent';
export interface Background {
  kind: BgKind;
  a: string;
  b: string;
  c: string;
  angle: number;
  /** 0..1 film noise baked into the background */
  noise: number;
}

export type EnvPreset = 'studio' | 'softbox' | 'strips' | 'dusk';
export interface Env {
  preset: EnvPreset;
  intensity: number;
  rotation: number;
  shadow: number;
  softness: number;
}

export interface Fx {
  bloom: number;
  threshold: number;
  grain: number;
  vignette: number;
}

export interface Format {
  w: number;
  h: number;
  fps: number;
  duration: number;
}

export interface Project {
  v: 1;
  name: string;
  format: Format;
  bg: Background;
  env: Env;
  fx: Fx;
  camera: { base: CameraState; keys: Key<CameraState>[] };
  devices: Device[];
  texts: TextLayer[];
}

export type TargetId = 'camera' | string;

/* ---------- formats ---------- */

export const FORMATS: { id: string; label: string; sub: string; w: number; h: number }[] = [
  { id: 'story', label: '9:16', sub: 'Stories, Reels, Shorts', w: 1080, h: 1920 },
  { id: 'feed', label: '4:5', sub: 'Feed post', w: 1080, h: 1350 },
  { id: 'square', label: '1:1', sub: 'Square', w: 1080, h: 1080 },
  { id: 'wide', label: '16:9', sub: 'Landing, YouTube', w: 1920, h: 1080 },
  { id: 'appstore', label: 'App Store', sub: '6.9″ screenshot', w: 1290, h: 2796 },
  { id: 'play', label: 'Play feature', sub: 'Feature graphic', w: 1024, h: 500 },
];

/* ---------- models ---------- */

export const MODELS: { id: ModelId; label: string; finishes: { name: string; hex: string }[] }[] = [
  {
    id: 'phone',
    label: 'Phone · island',
    finishes: [
      { name: 'Graphite', hex: '#2a2b2e' },
      { name: 'Silver', hex: '#d9dadc' },
      { name: 'Desert', hex: '#c7b39c' },
      { name: 'Ocean', hex: '#3d5a78' },
      { name: 'Sage', hex: '#8fa58d' },
      { name: 'Ember', hex: '#d0592e' },
    ],
  },
  {
    id: 'android',
    label: 'Phone · punch-hole',
    finishes: [
      { name: 'Obsidian', hex: '#1e1f22' },
      { name: 'Porcelain', hex: '#ece8e1' },
      { name: 'Bay', hex: '#7fa6c9' },
      { name: 'Hazel', hex: '#8b8a63' },
    ],
  },
  {
    id: 'tablet',
    label: 'Tablet',
    finishes: [
      { name: 'Space', hex: '#3a3b3f' },
      { name: 'Silver', hex: '#d4d6d9' },
      { name: 'Indigo', hex: '#4c5a8c' },
    ],
  },
  {
    id: 'laptop',
    label: 'Laptop',
    finishes: [
      { name: 'Midnight', hex: '#25282e' },
      { name: 'Silver', hex: '#cfd1d4' },
      { name: 'Starlight', hex: '#e2dccf' },
    ],
  },
];

/* ---------- ids ---------- */

let seq = 0;
export const uid = (p: string) => `${p}${Date.now().toString(36).slice(-4)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/* ---------- easing ---------- */

export function ease(e: Ease, u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  switch (e) {
    case 'linear':
      return u;
    case 'smooth':
      return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    case 'out':
      return 1 - Math.pow(1 - u, 4);
    case 'spring':
      // damped oscillation that lands exactly on 1 at u = 1 (cos(2.5π) = 0)
      return 1 - Math.exp(-6.5 * u) * Math.cos(2.5 * Math.PI * u);
    case 'back': {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
    }
    case 'hold':
      return 0;
  }
}

/* ---------- state interpolation ---------- */

type Num = number | number[];
type StateLike = Record<string, Num>;

export function lerpState<S>(a: S, b: S, t: number): S {
  const out: Record<string, Num> = {};
  const A = a as unknown as StateLike;
  const B = b as unknown as StateLike;
  for (const k of Object.keys(A)) {
    const x = A[k];
    const y = B[k] ?? x;
    if (Array.isArray(x)) out[k] = x.map((v, i) => v + (((y as number[])[i] ?? v) - v) * t);
    else out[k] = x + ((y as number) - x) * t;
  }
  return out as unknown as S;
}

export const cloneState = <S>(s: S): S => JSON.parse(JSON.stringify(s)) as S;

export function sortKeys<S>(keys: Key<S>[]) {
  keys.sort((a, b) => a.t - b.t);
}

/** state of a track at time t */
export function evaluate<S>(base: S, keys: Key<S>[], t: number): S {
  if (!keys.length) return base;
  if (t <= keys[0].t) return keys[0].s;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.s;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const span = b.t - a.t;
  const u = span > 0 ? (t - a.t) / span : 1;
  return lerpState(a.s, b.s, ease(b.ease, u));
}

/** frame tolerance for "a key is at the playhead" */
export const KEY_EPS = 1 / 120;

export function keyAt<S>(keys: Key<S>[], t: number) {
  return keys.find((k) => Math.abs(k.t - t) < KEY_EPS) ?? null;
}

/**
 * Writes a partial state at time t: into the base when the track has no keys, into a key at the
 * playhead otherwise (creating one from the evaluated state).
 */
export function writeState<S>(track: { base: S; keys: Key<S>[] }, t: number, patch: Partial<S>) {
  if (!track.keys.length) {
    track.base = { ...track.base, ...cloneState(patch) };
    return;
  }
  let k = keyAt(track.keys, t);
  if (!k) {
    k = { id: uid('k'), t: round3(t), ease: 'smooth', s: cloneState(evaluate(track.base, track.keys, t)) };
    track.keys.push(k);
    sortKeys(track.keys);
  }
  k.s = { ...k.s, ...cloneState(patch) };
}

/** adds a key at t holding the current state; returns it (or the existing one) */
export function addKey<S>(track: { base: S; keys: Key<S>[] }, t: number, ease: Ease = 'smooth') {
  const existing = keyAt(track.keys, t);
  if (existing) return existing;
  const k: Key<S> = { id: uid('k'), t: round3(t), ease, s: cloneState(evaluate(track.base, track.keys, t)) };
  track.keys.push(k);
  sortKeys(track.keys);
  return k;
}

export const round3 = (v: number) => Math.round(v * 1000) / 1000;

/* ---------- modifiers ---------- */

/** procedural offsets, periodic over the clip so loops are seamless */
export function modifiers(d: Device, t: number, duration: number) {
  const p = duration > 0 ? t / duration : 0;
  const w = 2 * Math.PI * Math.round(d.float.cycles) * p;
  const amp = d.float.amp;
  return {
    dy: amp * Math.sin(w),
    dRotX: amp * 9 * Math.sin(w + 1.1),
    dRotZ: amp * 6 * Math.sin(w * 0.5 + 0.4) * (Math.round(d.float.cycles) % 2 === 0 ? 1 : 0),
    dRotY: 360 * Math.round(d.spin) * p,
  };
}

/* ---------- defaults ---------- */

export const lensFov = (mm: number) => (2 * Math.atan(12 / mm) * 180) / Math.PI;

export function defaultCamera(): CameraState {
  return { yaw: 0, pitch: 0, roll: 0, dist: 5.2, lens: 50, target: [0, 0, 0] };
}

export function newDevice(model: ModelId, media: string | null, name?: string): Device {
  const m = MODELS.find((x) => x.id === model)!;
  return {
    id: uid('d'),
    name: name ?? m.label.split(' ·')[0],
    model,
    finish: m.finishes[0].hex,
    media,
    glow: 1,
    glare: 0.35,
    lid: 105,
    base: { pos: [0, 0, 0], rot: [0, 0, 0], scale: 1, scroll: 0 },
    keys: [],
    float: { amp: 0, cycles: 1 },
    spin: 0,
    visible: true,
  };
}

export function newText(text: string, patch: Partial<TextLayer> = {}): TextLayer {
  return {
    id: uid('t'),
    name: text.split('\n')[0].slice(0, 24) || 'Text',
    text,
    font: 'Geist',
    weight: 600,
    size: 0.05,
    color: '#ffffff',
    align: 'center',
    x: 0.5,
    y: 0.12,
    tracking: -0.02,
    leading: 1.08,
    layer: 'front',
    anim: 'rise',
    start: 0.2,
    dur: 0.8,
    visible: true,
    ...patch,
  };
}

export function blankProject(): Project {
  return {
    v: 1,
    name: 'Untitled',
    format: { w: 1080, h: 1920, fps: 60, duration: 6 },
    bg: { kind: 'radial', a: '#2b2f3a', b: '#0b0c10', c: '#5b7cff', angle: 160, noise: 0.25 },
    env: { preset: 'studio', intensity: 1, rotation: 0, shadow: 0.45, softness: 0.6 },
    fx: { bloom: 0.15, threshold: 0.9, grain: 0.06, vignette: 0.25 },
    camera: { base: defaultCamera(), keys: [] },
    devices: [],
    texts: [],
  };
}

/* ---------- pose presets ---------- */

export const POSES: { id: string; label: string; rot: Vec3 }[] = [
  { id: 'front', label: 'Front', rot: [0, 0, 0] },
  { id: 'hero', label: 'Hero ¾', rot: [8, -26, 3] },
  { id: 'float', label: 'Float', rot: [16, 22, -10] },
  { id: 'side', label: 'Side', rot: [0, -62, 0] },
  { id: 'lay', label: 'Lay back', rot: [-58, 0, 0] },
  { id: 'back', label: 'Back', rot: [6, 200, -4] },
];

export const CAMERA_SHOTS: { id: string; label: string; s: Partial<CameraState> }[] = [
  { id: 'eye', label: 'Eye level', s: { yaw: 0, pitch: 0, roll: 0 } },
  { id: 'high', label: 'High', s: { yaw: 0, pitch: 24, roll: 0 } },
  { id: 'low', label: 'Low hero', s: { yaw: 0, pitch: -16, roll: 0 } },
  { id: 'dutch', label: 'Dutch', s: { yaw: 12, pitch: 6, roll: -8 } },
];

/* ---------- motion presets: they write ordinary, editable keys ---------- */

export type MotionPreset = 'reveal' | 'turntable' | 'swing' | 'flip' | 'scroll' | 'drop' | 'push' | 'orbit' | 'pull';

export const DEVICE_MOTIONS: { id: MotionPreset; label: string; sub: string }[] = [
  { id: 'reveal', label: 'Reveal', sub: 'Rises in, settles on a spring' },
  { id: 'drop', label: 'Drop in', sub: 'Falls from above with a bounce' },
  { id: 'swing', label: 'Swing', sub: 'Turns left, right, back' },
  { id: 'turntable', label: 'Turntable', sub: 'One full turn' },
  { id: 'flip', label: 'Flip', sub: 'Shows the back and returns' },
  { id: 'scroll', label: 'Scroll screen', sub: 'Top to bottom of the content' },
];
export const CAMERA_MOTIONS: { id: MotionPreset; label: string; sub: string }[] = [
  { id: 'push', label: 'Push in', sub: 'Slow dolly towards the subject' },
  { id: 'pull', label: 'Pull out', sub: 'Starts close, reveals the frame' },
  { id: 'orbit', label: 'Orbit', sub: 'Arc around the subject' },
];

export function applyDeviceMotion(d: Device, id: MotionPreset, duration: number, at = 0) {
  const pose = cloneState(evaluate(d.base, d.keys, at));
  const k = (t: number, e: Ease, patch: Partial<DeviceState>): Key<DeviceState> => ({
    id: uid('k'),
    t: round3(Math.min(duration, Math.max(0, t))),
    ease: e,
    s: { ...cloneState(pose), ...cloneState(patch) },
  });
  const [x, y, z] = pose.rot;
  const [px, py, pz] = pose.pos;
  const end = duration;
  // keys of other presets stay unless they overlap the channels we touch; simplest predictable rule:
  // a device motion replaces the device's keys, scroll merges into existing ones
  if (id === 'scroll') {
    if (!d.keys.length) {
      d.keys = [k(0.5, 'smooth', { scroll: 0 }), k(end - 0.5, 'smooth', { scroll: 1 })];
      return;
    }
    // keep the existing motion intact: content holds at the top until the last key, then scrolls
    const last = d.keys[d.keys.length - 1];
    const b = addKey(d, Math.min(end, Math.max(last.t + 0.5, end - 0.5)));
    b.ease = 'smooth';
    d.keys.forEach((key) => (key.s.scroll = key === b ? 1 : 0));
    return;
  }
  const scroll = pose.scroll;
  switch (id) {
    case 'reveal':
      d.keys = [k(0, 'smooth', { pos: [px, py - 2.6, pz], rot: [x + 38, y - 30, z - 8], scroll }), k(1.4, 'spring', {})];
      break;
    case 'drop':
      d.keys = [k(0, 'smooth', { pos: [px, py + 3.2, pz], rot: [x - 20, y + 12, z + 14] }), k(1.1, 'back', {})];
      break;
    case 'swing':
      d.keys = [
        k(0, 'smooth', { rot: [x, y - 24, z] }),
        k(end / 2, 'smooth', { rot: [x, y + 24, z] }),
        k(end, 'smooth', { rot: [x, y - 24, z] }),
      ];
      break;
    case 'turntable':
      d.keys = [k(0, 'linear', { rot: [x, y, z] }), k(end, 'linear', { rot: [x, y + 360, z] })];
      break;
    case 'flip':
      d.keys = [
        k(0, 'smooth', {}),
        k(end * 0.2, 'smooth', {}),
        k(end * 0.5, 'smooth', { rot: [x, y + 180, z] }),
        k(end * 0.8, 'smooth', { rot: [x, y + 360, z] }),
      ];
      break;
    default:
      break;
  }
}

export function applyCameraMotion(cam: Project['camera'], id: MotionPreset, duration: number) {
  const pose = cloneState(evaluate(cam.base, cam.keys, 0));
  const k = (t: number, e: Ease, patch: Partial<CameraState>): Key<CameraState> => ({
    id: uid('k'),
    t: round3(t),
    ease: e,
    s: { ...cloneState(pose), ...patch },
  });
  switch (id) {
    case 'push':
      cam.keys = [k(0, 'smooth', { dist: pose.dist * 1.25 }), k(duration, 'smooth', { dist: pose.dist * 0.92 })];
      break;
    case 'pull':
      cam.keys = [k(0, 'smooth', { dist: pose.dist * 0.6, pitch: pose.pitch + 8 }), k(Math.min(duration, 2.2), 'out', {})];
      break;
    case 'orbit':
      cam.keys = [k(0, 'smooth', { yaw: pose.yaw - 28 }), k(duration, 'smooth', { yaw: pose.yaw + 28 })];
      break;
    default:
      break;
  }
}

/* ---------- layouts for several devices ---------- */

export const LAYOUTS: { id: string; label: string; min: number }[] = [
  { id: 'row', label: 'Row', min: 2 },
  { id: 'fan', label: 'Fan', min: 2 },
  { id: 'cascade', label: 'Cascade', min: 2 },
  { id: 'stack', label: 'Stack', min: 2 },
];

export function applyLayout(p: Project, id: string, t: number) {
  const ds = p.devices.filter((d) => d.visible);
  const n = ds.length;
  ds.forEach((d, i) => {
    const c = i - (n - 1) / 2;
    let pos: Vec3 = [0, 0, 0];
    let rot: Vec3 = [0, 0, 0];
    const wide = d.model === 'laptop' || d.model === 'tablet';
    const gap = wide ? 2.4 : 1.0;
    switch (id) {
      case 'row':
        pos = [c * gap, 0, 0];
        rot = [0, 0, 0];
        break;
      case 'fan':
        pos = [c * gap * 0.82, -Math.abs(c) * 0.12, -Math.abs(c) * 0.5];
        rot = [4, -c * 18, -c * 6];
        break;
      case 'cascade':
        pos = [c * gap * 0.62, c * 0.18, -i * 0.6];
        rot = [10, -28, 4];
        break;
      case 'stack':
        pos = [c * 0.35, c * -0.12, -i * 0.9];
        rot = [-52, 0, -24];
        break;
    }
    writeState(d, t, { pos, rot });
  });
}
