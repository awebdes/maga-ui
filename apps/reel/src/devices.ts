/**
 * Procedural device models. Units: 1 = 100 mm. Every rig exposes its screen mesh (unlit, exact
 * colors), a glare layer over it and the materials the finish swatch drives.
 */
import * as THREE from 'three';
import type { ModelId } from './doc';
import { filmic } from './filmic';

export interface DeviceRig {
  model: ModelId;
  group: THREE.Group;
  /** inner group: what the device transform moves */
  body: THREE.Group;
  screen: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  glare: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  screenAspect: number;
  setFinish(hex: string): void;
  setLid(deg: number): void;
  dispose(): void;
}

function rrShape(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  // continuous-ish corners: cubic handles a bit longer than a circle's
  const k = 0.62;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.bezierCurveTo(x + w - r + r * k, y, x + w, y + r - r * k, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.bezierCurveTo(x + w, y + h - r + r * k, x + w - r + r * k, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.bezierCurveTo(x + r - r * k, y + h, x, y + h - r + r * k, x, y + h - r);
  s.lineTo(x, y + r);
  s.bezierCurveTo(x, y + r - r * k, x + r - r * k, y, x + r, y);
  return s;
}

/** flat rounded rect with 0..1 UVs over its bounds */
function plate(w: number, h: number, r: number, segs = 16) {
  const g = new THREE.ShapeGeometry(rrShape(w, h, r), segs);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + h / 2) / h);
  uv.needsUpdate = true;
  return g;
}

/** rounded slab centred on z = 0, total size w × h × d, edge radius b */
function slab(w: number, h: number, d: number, r: number, b: number, segs = 6) {
  const g = new THREE.ExtrudeGeometry(rrShape(w - 2 * b, h - 2 * b, Math.max(0.001, r - b)), {
    depth: Math.max(0.0001, d - 2 * b),
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: segs,
    curveSegments: 20,
  });
  g.translate(0, 0, -(d - 2 * b) / 2);
  g.computeVertexNormals();
  return g;
}

function capsule(w: number, h: number) {
  return plate(w, h, h / 2, 12);
}

function mats(finish: string) {
  const frame = filmic(new THREE.MeshPhysicalMaterial({ color: finish, metalness: 1, roughness: 0.3 }));
  const back = filmic(
    new THREE.MeshPhysicalMaterial({ color: finish, metalness: 0.1, roughness: 0.5, clearcoat: 1, clearcoatRoughness: 0.22 }),
  );
  const glass = filmic(new THREE.MeshPhysicalMaterial({ color: 0x040405, metalness: 0, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03 }));
  const black = filmic(new THREE.MeshPhysicalMaterial({ color: 0x010101, metalness: 0, roughness: 0.2 }));
  const lens = filmic(new THREE.MeshPhysicalMaterial({ color: 0x07080c, metalness: 0.2, roughness: 0.05, clearcoat: 1, iridescence: 0.8, iridescenceIOR: 1.6 }));
  const ring = filmic(new THREE.MeshPhysicalMaterial({ color: 0xc9ccd2, metalness: 1, roughness: 0.32 }));
  const pupil = filmic(new THREE.MeshPhysicalMaterial({ color: 0x1b2440, metalness: 0.4, roughness: 0.15, clearcoat: 1 }));
  const screen = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const glare = filmic(
    new THREE.MeshPhysicalMaterial({
      color: 0x000000,
      metalness: 0,
      roughness: 0.04,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      envMapIntensity: 1.6,
    }),
  );
  return { frame, back, glass, black, lens, ring, pupil, screen, glare };
}
type Mats = ReturnType<typeof mats>;

function setFinishOn(m: Mats, hex: string) {
  const c = new THREE.Color(hex);
  m.frame.color.copy(c);
  // light finishes read as brushed aluminium, dark ones as glossy titanium
  const lum = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
  m.frame.roughness = lum > 0.4 ? 0.36 : 0.26;
  m.back.color.copy(c).multiplyScalar(lum > 0.4 ? 0.92 : 1.1);
}

function cameraLens(m: Mats, r: number) {
  const g = new THREE.Group();
  const ringMesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.03, 40), m.ring);
  ringMesh.rotation.x = Math.PI / 2;
  const glassMesh = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.74, r * 0.74, 0.032, 40), m.lens);
  glassMesh.rotation.x = Math.PI / 2;
  // the lens sits on the back (−z), so details face −z
  const pupilMesh = new THREE.Mesh(new THREE.CircleGeometry(r * 0.32, 32), m.pupil);
  pupilMesh.rotation.y = Math.PI;
  pupilMesh.position.z = -0.0165;
  const glint = new THREE.Mesh(new THREE.RingGeometry(r * 0.45, r * 0.52, 40), m.ring);
  glint.rotation.y = Math.PI;
  glint.position.z = -0.0163;
  g.add(ringMesh, glassMesh, pupilMesh, glint);
  return g;
}

function sideButton(m: Mats, len: number, x: number, y: number, d: number) {
  const g = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, len, 4, 10), m.frame);
  g.position.set(x, y, 0);
  g.scale.z = d / 0.016;
  return g;
}

function finishRig(model: ModelId, m: Mats, body: THREE.Group, screen: THREE.Mesh, glare: THREE.Mesh, aspect: number, setLid = (_: number) => {}): DeviceRig {
  const group = new THREE.Group();
  group.add(body);
  body.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o !== screen && o !== glare) {
      o.castShadow = true;
    }
  });
  return {
    model,
    group,
    body,
    screen: screen as DeviceRig['screen'],
    glare: glare as DeviceRig['glare'],
    screenAspect: aspect,
    setFinish: (hex) => setFinishOn(m, hex),
    setLid,
    dispose() {
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      Object.values(m).forEach((x) => x.dispose());
    },
  };
}

/* ---------- phones and tablet ---------- */

interface SlabSpec {
  w: number;
  h: number;
  d: number;
  r: number;
  bevel: number;
  bezel: number;
  screenR: number;
  cutout: 'island' | 'hole' | 'dot';
  camera: 'square' | 'pill' | 'single';
  buttons: boolean;
}

const SPECS: Record<Exclude<ModelId, 'laptop'>, SlabSpec> = {
  phone: { w: 0.716, h: 1.493, d: 0.083, r: 0.13, bevel: 0.026, bezel: 0.02, screenR: 0.105, cutout: 'island', camera: 'square', buttons: true },
  android: { w: 0.72, h: 1.56, d: 0.082, r: 0.085, bevel: 0.014, bezel: 0.018, screenR: 0.07, cutout: 'hole', camera: 'pill', buttons: true },
  tablet: { w: 1.79, h: 2.47, d: 0.061, r: 0.18, bevel: 0.022, bezel: 0.085, screenR: 0.1, cutout: 'dot', camera: 'single', buttons: false },
};

function buildSlab(model: Exclude<ModelId, 'laptop'>, finish: string): DeviceRig {
  const s = SPECS[model];
  const m = mats(finish);
  setFinishOn(m, finish);
  const body = new THREE.Group();
  const shell = new THREE.Mesh(slab(s.w, s.h, s.d, s.r, s.bevel), [m.back, m.frame]);
  body.add(shell);
  const zf = s.d / 2;
  // cover glass reaches to where the frame starts curving
  const gw = s.w - s.bevel * 1.1;
  const gh = s.h - s.bevel * 1.1;
  const glassMesh = new THREE.Mesh(plate(gw, gh, s.r - s.bevel * 0.55, 24), m.glass);
  glassMesh.position.z = zf + 0.0006;
  body.add(glassMesh);
  const sw = s.w - 2 * s.bezel - s.bevel * 0.6;
  const sh = s.h - 2 * s.bezel - s.bevel * 0.6;
  const screen = new THREE.Mesh(plate(sw, sh, s.screenR, 24), m.screen);
  screen.position.z = zf + 0.0012;
  body.add(screen);
  const glare = new THREE.Mesh(plate(gw, gh, s.r - s.bevel * 0.55, 24), m.glare);
  glare.position.z = zf + 0.0022;
  glare.renderOrder = 2;
  body.add(glare);

  // front cutout
  const top = sh / 2;
  if (s.cutout === 'island') {
    const isl = new THREE.Mesh(capsule(0.128, 0.037), m.black);
    isl.position.set(0, top - 0.048, zf + 0.0017);
    body.add(isl);
  } else if (s.cutout === 'hole') {
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.017, 32), m.black);
    hole.position.set(0, top - 0.042, zf + 0.0017);
    body.add(hole);
  } else {
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.012, 24), m.black);
    dot.position.set(0, s.h / 2 - s.bezel / 2 - 0.01, zf + 0.0017);
    body.add(dot);
  }

  // back camera
  const zb = -s.d / 2;
  if (s.camera === 'square') {
    const size = 0.29;
    const bump = new THREE.Mesh(slab(size, size, 0.03, 0.075, 0.01, 4), [m.back, m.back]);
    bump.position.set(-s.w / 2 + 0.035 + size / 2, s.h / 2 - 0.035 - size / 2, zb - 0.008);
    body.add(bump);
    const lr = 0.058;
    const places: [number, number][] = [
      [-0.068, 0.068],
      [-0.068, -0.068],
      [0.072, 0],
    ];
    places.forEach(([x, y]) => {
      const l = cameraLens(m, lr);
      l.position.set(bump.position.x + x, bump.position.y + y, zb - 0.03);
      body.add(l);
    });
    const flash = new THREE.Mesh(new THREE.CircleGeometry(0.018, 20), m.ring);
    flash.position.set(bump.position.x + 0.072, bump.position.y + 0.09, zb - 0.0235);
    flash.rotation.y = Math.PI;
    body.add(flash);
  } else if (s.camera === 'pill') {
    const pill = new THREE.Mesh(slab(0.12, 0.34, 0.03, 0.06, 0.012, 4), [m.black, m.frame]);
    pill.position.set(-s.w / 2 + 0.12, s.h / 2 - 0.25, zb - 0.008);
    body.add(pill);
    [0.1, 0, -0.1].forEach((y) => {
      const l = cameraLens(m, 0.042);
      l.position.set(pill.position.x, pill.position.y + y, zb - 0.03);
      body.add(l);
    });
  } else {
    const l = cameraLens(m, 0.05);
    l.position.set(-s.w / 2 + 0.14, s.h / 2 - 0.14, zb - 0.012);
    l.scale.z = 0.6;
    body.add(l);
  }

  if (s.buttons) {
    body.add(sideButton(m, 0.2, s.w / 2 + 0.002, 0.28, s.d * 0.5));
    body.add(sideButton(m, 0.11, -s.w / 2 - 0.002, 0.36, s.d * 0.5));
    body.add(sideButton(m, 0.11, -s.w / 2 - 0.002, 0.2, s.d * 0.5));
    if (model === 'phone') body.add(sideButton(m, 0.05, -s.w / 2 - 0.002, 0.52, s.d * 0.5));
  }
  return finishRig(model, m, body, screen, glare, sw / sh);
}

/* ---------- laptop ---------- */

function buildLaptop(finish: string): DeviceRig {
  const m = mats(finish);
  setFinishOn(m, finish);
  const W = 3.04;
  const D = 2.15;
  const T = 0.05;
  const body = new THREE.Group();
  // base lies in XZ; centre of the whole open laptop near the origin
  const base = new THREE.Group();
  const baseMesh = new THREE.Mesh(slab(W, D, T, 0.12, 0.02, 4), [m.frame, m.frame]);
  baseMesh.rotation.x = -Math.PI / 2;
  base.add(baseMesh);
  const deckMat = filmic(new THREE.MeshPhysicalMaterial({ color: new THREE.Color(finish).multiplyScalar(0.8), metalness: 0.7, roughness: 0.55 }));
  const deck = new THREE.Mesh(plate(W * 0.86, D * 0.4, 0.03), deckMat);
  deck.rotation.x = -Math.PI / 2;
  deck.position.set(0, T / 2 + 0.0008, -D * 0.17);
  base.add(deck);
  // keys: a grid of slightly raised caps
  const keyGeo = new THREE.BoxGeometry(0.155, 0.012, 0.15);
  const keyMat = filmic(new THREE.MeshPhysicalMaterial({ color: 0x0b0b0d, roughness: 0.6 }));
  const rows = 6;
  const cols = 14;
  const keys = new THREE.InstancedMesh(keyGeo, keyMat, rows * cols);
  const kw = (W * 0.84) / cols;
  const kd = (D * 0.38) / rows;
  const mtx = new THREE.Matrix4();
  let n = 0;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      mtx.makeTranslation(-W * 0.42 + kw * (c + 0.5), T / 2 + 0.006, -D * 0.17 - D * 0.19 + kd * (r + 0.5));
      keys.setMatrixAt(n++, mtx);
    }
  base.add(keys);
  const pad = new THREE.Mesh(plate(1.2, 0.72, 0.05), filmic(new THREE.MeshPhysicalMaterial({ color: finish, metalness: 0.6, roughness: 0.42 })));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, T / 2 + 0.0008, D * 0.26);
  base.add(pad);
  body.add(base);

  // lid hinges at the back edge of the base
  const hinge = new THREE.Group();
  hinge.position.set(0, T / 2, -D / 2 + 0.02);
  const LH = 1.98;
  const LT = 0.032;
  const lid = new THREE.Group();
  const lidMesh = new THREE.Mesh(slab(W, LH, LT, 0.12, 0.012, 4), [m.frame, m.frame]);
  lid.add(lidMesh);
  const glassMesh = new THREE.Mesh(plate(W - 0.03, LH - 0.03, 0.11, 20), m.glass);
  glassMesh.position.z = LT / 2 + 0.0006;
  lid.add(glassMesh);
  const sw = W - 0.14;
  const sh = sw / 1.6;
  const screen = new THREE.Mesh(plate(sw, sh, 0.035, 12), m.screen);
  screen.position.set(0, (LH - sh) / 2 - 0.05, LT / 2 + 0.0012);
  lid.add(screen);
  const notch = new THREE.Mesh(plate(0.3, 0.06, 0.02), m.black);
  notch.position.set(0, LH / 2 - 0.045, LT / 2 + 0.0016);
  lid.add(notch);
  const glare = new THREE.Mesh(plate(W - 0.03, LH - 0.03, 0.11, 20), m.glare);
  glare.position.z = LT / 2 + 0.0022;
  glare.renderOrder = 2;
  lid.add(glare);
  lid.position.y = LH / 2;
  // the lid's screen faces +z when the hinge angle is 90°
  hinge.add(lid);
  body.add(hinge);
  body.position.y = -0.55;
  body.position.z = 0.35;
  const setLid = (deg: number) => {
    // 0° closed (screen down on the deck), 90° upright
    hinge.rotation.x = THREE.MathUtils.degToRad(90 - deg);
  };
  setLid(105);
  return finishRig('laptop', m, body, screen, glare, sw / sh, setLid);
}

export function buildDevice(model: ModelId, finish: string): DeviceRig {
  return model === 'laptop' ? buildLaptop(finish) : buildSlab(model, finish);
}
