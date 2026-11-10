/**
 * The renderer. One path for preview and export:
 *   scene (lit surfaces tone-mapped per material, screen exact) → half-float target, MSAA
 *   → bloom (dual-filter mip chain) → final composite with the 2D background, front text,
 *   vignette and grain, premultiplied, straight to the canvas.
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { buildDevice, type DeviceRig } from './devices';
import { Environments } from './env';
import { evaluate, lensFov, modifiers, type Device, type Project } from './doc';
import { getMedia } from './media';
import { drawBackground, drawTexts, type TextBox } from './layers2d';

interface RigEntry {
  rig: DeviceRig;
  finish: string;
  mediaId: string | null | undefined;
  tex: THREE.Texture | null;
}

const VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const PREFILTER = /* glsl */ `
uniform sampler2D tMap; uniform vec2 texel; uniform float threshold; varying vec2 vUv;
void main(){
  vec2 o = texel * 0.5;
  vec3 c = (texture2D(tMap, vUv + vec2(-o.x,-o.y)).rgb + texture2D(tMap, vUv + vec2(o.x,-o.y)).rgb
          + texture2D(tMap, vUv + vec2(-o.x,o.y)).rgb + texture2D(tMap, vUv + vec2(o.x,o.y)).rgb) * 0.25;
  float br = max(c.r, max(c.g, c.b));
  float w = smoothstep(threshold, threshold + 0.22, br);
  gl_FragColor = vec4(min(c * w, vec3(8.0)), 1.0);
}`;

const DOWN = /* glsl */ `
uniform sampler2D tMap; uniform vec2 texel; varying vec2 vUv;
void main(){
  vec2 h = texel * 0.5;
  vec3 s = texture2D(tMap, vUv).rgb * 4.0;
  s += texture2D(tMap, vUv - h).rgb; s += texture2D(tMap, vUv + h).rgb;
  s += texture2D(tMap, vUv + vec2(h.x, -h.y)).rgb; s += texture2D(tMap, vUv - vec2(h.x, -h.y)).rgb;
  gl_FragColor = vec4(s / 8.0, 1.0);
}`;

const UP = /* glsl */ `
uniform sampler2D tMap; uniform vec2 texel; varying vec2 vUv;
void main(){
  vec2 h = texel * 0.5;
  vec3 s = texture2D(tMap, vUv + vec2(-h.x * 2.0, 0.0)).rgb;
  s += texture2D(tMap, vUv + vec2(-h.x, h.y)).rgb * 2.0;
  s += texture2D(tMap, vUv + vec2(0.0, h.y * 2.0)).rgb;
  s += texture2D(tMap, vUv + vec2(h.x, h.y)).rgb * 2.0;
  s += texture2D(tMap, vUv + vec2(h.x * 2.0, 0.0)).rgb;
  s += texture2D(tMap, vUv + vec2(h.x, -h.y)).rgb * 2.0;
  s += texture2D(tMap, vUv + vec2(0.0, -h.y * 2.0)).rgb;
  s += texture2D(tMap, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
  gl_FragColor = vec4(s / 12.0, 1.0);
}`;

const FINAL = /* glsl */ `
uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tBg; uniform sampler2D tFront;
uniform float bloom; uniform float grain; uniform float vignette; uniform float seed; uniform vec2 res;
varying vec2 vUv;
vec3 toSRGB(vec3 c){ c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32 + seed); return fract(p.x * p.y); }
void main(){
  vec4 s = texture2D(tScene, vUv);
  float a = clamp(s.a, 0.0, 1.0);
  vec3 lin = s.a > 0.0001 ? s.rgb / s.a : vec3(0.0);
  vec3 sc = toSRGB(clamp(lin, 0.0, 1.0));
  vec4 bg = texture2D(tBg, vUv);
  vec3 col = sc * a + bg.rgb * bg.a * (1.0 - a);
  float al = a + bg.a * (1.0 - a);
  vec3 bl = toSRGB(texture2D(tBloom, vUv).rgb * bloom);
  col += bl;
  al = clamp(al + max(bl.r, max(bl.g, bl.b)), 0.0, 1.0);
  vec2 q = vUv - 0.5; q.x *= res.x / res.y;
  float v = smoothstep(0.95, 0.15, length(q) * (res.y > res.x ? 1.05 : 1.15));
  col *= mix(1.0, v, vignette);
  vec4 fr = texture2D(tFront, vUv);
  col = fr.rgb * fr.a + col * (1.0 - fr.a);
  al = fr.a + al * (1.0 - fr.a);
  float n = hash(floor(gl_FragCoord.xy)) - 0.5;
  col += n * grain * 0.22 * al;
  col = clamp(col, 0.0, al);
  gl_FragColor = vec4(col, al);
}`;

export interface RenderOpts {
  /** frame index, seeds the grain */
  frame?: number;
}

export class Studio {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 9 / 16, 0.05, 200);
  private envs: Environments;
  private rigs = new Map<string, RigEntry>();
  private baseTex = new Map<string, THREE.Texture>();
  private placeholder: THREE.Texture;
  private key = new THREE.DirectionalLight(0xffffff, 1.4);
  private floor: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;
  private floorSig = '';

  private rtScene!: THREE.WebGLRenderTarget;
  private mips: THREE.WebGLRenderTarget[] = [];
  private quad = new FullScreenQuad();
  private mPre = this.mat(PREFILTER, { tMap: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 0.8 } });
  private mDown = this.mat(DOWN, { tMap: { value: null }, texel: { value: new THREE.Vector2() } });
  private mUp = this.mat(UP, { tMap: { value: null }, texel: { value: new THREE.Vector2() } }, true);
  private mFinal = this.mat(FINAL, {
    tScene: { value: null },
    tBloom: { value: null },
    tBg: { value: null },
    tFront: { value: null },
    bloom: { value: 0 },
    grain: { value: 0 },
    vignette: { value: 0 },
    seed: { value: 0 },
    res: { value: new THREE.Vector2(1, 1) },
  });

  readonly bgCanvas = document.createElement('canvas');
  readonly frontCanvas = document.createElement('canvas');
  private bgCtx = this.bgCanvas.getContext('2d')!;
  private frontCtx = this.frontCanvas.getContext('2d')!;
  private bgTex = new THREE.CanvasTexture(this.bgCanvas);
  private frontTex = new THREE.CanvasTexture(this.frontCanvas);
  private bgSig = '';
  private frontSig = '';
  textBoxes: TextBox[] = [];
  width = 1;
  height = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, preserveDrawingBuffer: true, premultipliedAlpha: true });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.envs = new Environments(this.renderer);
    this.scene.environment = this.envs.get('studio');

    this.key.position.set(-1.5, 8, 3);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const sc = this.key.shadow.camera;
    sc.left = sc.bottom = -6;
    sc.right = sc.top = 6;
    sc.near = 1;
    sc.far = 20;
    this.key.shadow.bias = -0.0005;
    this.scene.add(this.key, this.key.target);

    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.4 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    for (const t of [this.bgTex, this.frontTex]) {
      t.colorSpace = THREE.NoColorSpace;
      t.premultiplyAlpha = false;
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
    }
    this.placeholder = this.makePlaceholder();
    this.setSize(1080, 1920);
  }

  private mat(frag: string, uniforms: Record<string, THREE.IUniform>, additive = false) {
    return new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: frag,
      uniforms,
      depthTest: false,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NoBlending,
      transparent: additive,
    });
  }

  private makePlaceholder() {
    const cv = document.createElement('canvas');
    cv.width = 600;
    cv.height = 1300;
    const c = cv.getContext('2d')!;
    const g = c.createLinearGradient(0, 0, 0, 1300);
    g.addColorStop(0, '#16171c');
    g.addColorStop(1, '#0b0b0e');
    c.fillStyle = g;
    c.fillRect(0, 0, 600, 1300);
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.font = '500 34px Geist, system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText('Drop a screenshot', 300, 640);
    c.fillStyle = 'rgba(255,255,255,0.3)';
    c.font = '400 26px Geist, system-ui, sans-serif';
    c.fillText('or a screen recording', 300, 690);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  setSize(w: number, h: number) {
    w = Math.max(2, Math.round(w));
    h = Math.max(2, Math.round(h));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.rtScene?.dispose();
    this.rtScene = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4, colorSpace: THREE.LinearSRGBColorSpace });
    this.mips.forEach((m) => m.dispose());
    this.mips = [];
    let mw = w >> 1;
    let mh = h >> 1;
    for (let i = 0; i < 6 && mw > 4 && mh > 4; i++) {
      this.mips.push(new THREE.WebGLRenderTarget(mw, mh, { type: THREE.HalfFloatType, depthBuffer: false }));
      mw >>= 1;
      mh >>= 1;
    }
    this.bgCanvas.width = this.frontCanvas.width = w;
    this.bgCanvas.height = this.frontCanvas.height = h;
    // canvas size changed: the textures need a fresh allocation
    this.bgTex.dispose();
    this.frontTex.dispose();
    this.bgSig = this.frontSig = '';
  }

  /* ---------- scene sync ---------- */

  private textureFor(id: string | null): THREE.Texture | null {
    const m = getMedia(id);
    if (!m) return null;
    let t = this.baseTex.get(m.id);
    if (!t) {
      t = m.kind === 'video' ? new THREE.VideoTexture(m.el as HTMLVideoElement) : m.el instanceof HTMLCanvasElement ? new THREE.CanvasTexture(m.el) : new THREE.Texture(m.el);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      if (m.kind === 'video') t.generateMipmaps = false;
      t.needsUpdate = true;
      this.baseTex.set(m.id, t);
    }
    return t;
  }

  /** videos seeked offline (export, scrubbing) need a manual upload */
  refreshVideo(id: string) {
    this.baseTex.get(id) && (this.baseTex.get(id)!.needsUpdate = true);
    for (const r of this.rigs.values()) if (r.mediaId === id && r.tex) r.tex.needsUpdate = true;
  }

  private syncDevice(d: Device, p: Project, t: number) {
    let e = this.rigs.get(d.id);
    if (e && e.rig.model !== d.model) {
      this.scene.remove(e.rig.group);
      e.rig.dispose();
      e.tex?.dispose();
      e = undefined;
    }
    if (!e) {
      const rig = buildDevice(d.model, d.finish);
      rig.group.userData.deviceId = d.id;
      this.scene.add(rig.group);
      e = { rig, finish: d.finish, mediaId: undefined, tex: null };
      this.rigs.set(d.id, e);
    }
    const { rig } = e;
    if (e.finish !== d.finish) {
      rig.setFinish(d.finish);
      e.finish = d.finish;
    }
    rig.setLid(d.lid);
    const s = evaluate(d.base, d.keys, t);
    const mod = modifiers(d, t, p.format.duration);
    rig.group.visible = d.visible;
    rig.group.position.set(s.pos[0], s.pos[1] + mod.dy, s.pos[2]);
    rig.group.rotation.set(
      THREE.MathUtils.degToRad(s.rot[0] + mod.dRotX),
      THREE.MathUtils.degToRad(s.rot[1] + mod.dRotY),
      THREE.MathUtils.degToRad(s.rot[2] + mod.dRotZ),
      'YXZ',
    );
    rig.group.scale.setScalar(s.scale);

    if (e.mediaId !== d.media) {
      e.tex?.dispose();
      const base = this.textureFor(d.media);
      e.tex = base ? base.clone() : null;
      if (e.tex) e.tex.needsUpdate = true;
      e.mediaId = d.media;
    }
    const tex = e.tex ?? this.placeholder;
    const m = getMedia(d.media);
    const ma = m ? m.w / m.h : 600 / 1300;
    const sa = rig.screenAspect;
    tex.matrixAutoUpdate = true;
    if (ma < sa) {
      // taller than the screen: fit width, scroll vertically
      tex.repeat.set(1, ma / sa);
      tex.offset.set(0, (1 - ma / sa) * (1 - Math.min(1, Math.max(0, s.scroll))));
    } else {
      tex.repeat.set(sa / ma, 1);
      tex.offset.set((1 - sa / ma) / 2, 0);
    }
    if (rig.screen.material.map !== tex) {
      rig.screen.material.map = tex;
      rig.screen.material.needsUpdate = true;
    }
    rig.screen.material.color.setScalar(d.glow);
    rig.glare.material.opacity = d.glare;
  }

  sync(p: Project, t: number) {
    const seen = new Set<string>();
    for (const d of p.devices) {
      this.syncDevice(d, p, t);
      seen.add(d.id);
    }
    for (const [id, e] of this.rigs) {
      if (seen.has(id)) continue;
      this.scene.remove(e.rig.group);
      e.rig.dispose();
      e.tex?.dispose();
      this.rigs.delete(id);
    }
    // camera
    const c = evaluate(p.camera.base, p.camera.keys, t);
    const yaw = THREE.MathUtils.degToRad(c.yaw);
    const pitch = THREE.MathUtils.degToRad(c.pitch);
    const T = new THREE.Vector3(...c.target);
    this.camera.position.set(T.x + c.dist * Math.sin(yaw) * Math.cos(pitch), T.y + c.dist * Math.sin(pitch), T.z + c.dist * Math.cos(yaw) * Math.cos(pitch));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(T);
    this.camera.rotateZ(THREE.MathUtils.degToRad(c.roll));
    this.camera.fov = lensFov(c.lens);
    this.camera.aspect = p.format.w / p.format.h;
    this.camera.near = Math.max(0.05, c.dist * 0.02);
    this.camera.far = c.dist * 20 + 50;
    this.camera.updateProjectionMatrix();
    // environment
    this.scene.environment = this.envs.get(p.env.preset);
    this.scene.environmentIntensity = p.env.intensity;
    this.scene.environmentRotation.set(0, THREE.MathUtils.degToRad(p.env.rotation), 0);
    this.key.intensity = 1.2 * p.env.intensity;
    this.key.position.set(-1.5 + Math.sin(THREE.MathUtils.degToRad(p.env.rotation)) * 3, 8, 3);
    this.floor.material.opacity = p.env.shadow;
    this.floor.visible = p.env.shadow > 0.001;
    this.key.castShadow = this.floor.visible;
    this.key.shadow.radius = 2 + p.env.softness * 22;
    this.key.shadow.blurSamples = 8 + Math.round(p.env.softness * 16);
    this.placeFloor(p);
  }

  /** the floor sits under the devices' resting pose, so a shadow does not slide during motion */
  private placeFloor(p: Project) {
    const end = p.format.duration;
    const sig = JSON.stringify(p.devices.map((d) => [d.model, d.visible, d.lid, evaluate(d.base, d.keys, end), d.float.amp]));
    if (sig === this.floorSig) return;
    this.floorSig = sig;
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    for (const d of p.devices) {
      const e = this.rigs.get(d.id);
      if (!e || !d.visible) continue;
      const g = e.rig.group;
      const keep = { p: g.position.clone(), r: g.rotation.clone(), s: g.scale.clone() };
      const s = evaluate(d.base, d.keys, end);
      g.position.set(...s.pos);
      g.rotation.set(...(s.rot.map((v) => THREE.MathUtils.degToRad(v)) as [number, number, number]), 'YXZ');
      g.scale.setScalar(s.scale);
      g.updateMatrixWorld(true);
      tmp.setFromObject(g);
      box.union(tmp);
      g.position.copy(keep.p);
      g.rotation.copy(keep.r);
      g.scale.copy(keep.s);
      g.updateMatrixWorld(true);
      if (d.float.amp > 0) box.min.y -= d.float.amp;
    }
    this.floor.position.y = box.isEmpty() ? -1 : box.min.y - 0.06;
  }

  /* ---------- 2D layers ---------- */

  /** fonts finished loading: redraw text on the next frame */
  invalidateLayers() {
    this.bgSig = this.frontSig = '';
  }

  private drawLayers(p: Project, t: number) {
    const w = this.width;
    const h = this.height;
    const behind = p.texts.filter((x) => x.layer === 'behind');
    const front = p.texts.filter((x) => x.layer === 'front');
    const sigOf = (list: typeof p.texts) =>
      JSON.stringify(list) + '|' + list.map((x) => (x.anim === 'none' ? 1 : Math.min(1, Math.max(0, (t - x.start) / x.dur))).toFixed(4)).join(',');
    const bs = JSON.stringify(p.bg) + sigOf(behind) + w + 'x' + h;
    let boxesB: TextBox[] | null = null;
    if (bs !== this.bgSig) {
      this.bgSig = bs;
      drawBackground(this.bgCtx, p.bg, w, h);
      boxesB = drawTexts(this.bgCtx, p.texts, 'behind', t, w, h);
      this.bgTex.needsUpdate = true;
    }
    const fs = sigOf(front) + w + 'x' + h;
    let boxesF: TextBox[] | null = null;
    if (fs !== this.frontSig) {
      this.frontSig = fs;
      this.frontCtx.clearRect(0, 0, w, h);
      boxesF = drawTexts(this.frontCtx, p.texts, 'front', t, w, h);
      this.frontTex.needsUpdate = true;
    }
    if (boxesB || boxesF) {
      const keep = this.textBoxes;
      const ids = new Set(p.texts.map((x) => x.id));
      const next = new Map(keep.filter((b) => ids.has(b.id)).map((b) => [b.id, b]));
      boxesB?.forEach((b) => next.set(b.id, b));
      boxesF?.forEach((b) => next.set(b.id, b));
      this.textBoxes = p.texts.map((x) => next.get(x.id)).filter((b): b is TextBox => !!b && p.texts.find((x) => x.id === b.id)!.visible);
    }
  }

  /* ---------- render ---------- */

  render(p: Project, t: number, opts: RenderOpts = {}) {
    this.sync(p, t);
    this.drawLayers(p, t);
    const r = this.renderer;
    r.setRenderTarget(this.rtScene);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.scene, this.camera);

    // bloom
    const useBloom = p.fx.bloom > 0.001 && this.mips.length > 1;
    if (useBloom) {
      this.mPre.uniforms.tMap.value = this.rtScene.texture;
      this.mPre.uniforms.texel.value.set(1 / this.width, 1 / this.height);
      this.mPre.uniforms.threshold.value = p.fx.threshold;
      this.pass(this.mPre, this.mips[0]);
      for (let i = 1; i < this.mips.length; i++) {
        const src = this.mips[i - 1];
        this.mDown.uniforms.tMap.value = src.texture;
        this.mDown.uniforms.texel.value.set(1 / src.width, 1 / src.height);
        this.pass(this.mDown, this.mips[i]);
      }
      for (let i = this.mips.length - 2; i >= 0; i--) {
        const src = this.mips[i + 1];
        this.mUp.uniforms.tMap.value = src.texture;
        this.mUp.uniforms.texel.value.set(1 / src.width, 1 / src.height);
        this.pass(this.mUp, this.mips[i], false);
      }
    }
    const u = this.mFinal.uniforms;
    u.tScene.value = this.rtScene.texture;
    u.tBloom.value = this.mips[0].texture;
    u.tBg.value = this.bgTex;
    u.tFront.value = this.frontTex;
    u.bloom.value = useBloom ? p.fx.bloom * 0.9 : 0;
    u.grain.value = p.fx.grain;
    u.vignette.value = p.bg.kind === 'transparent' ? 0 : p.fx.vignette;
    u.seed.value = ((opts.frame ?? 0) % 97) * 0.731;
    u.res.value.set(this.width, this.height);
    this.pass(this.mFinal, null);
  }

  private pass(m: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null, clear = true) {
    const r = this.renderer;
    r.setRenderTarget(target);
    if (clear) {
      r.setClearColor(0x000000, 0);
      r.clear();
    }
    this.quad.material = m;
    this.quad.render(r);
  }

  /* ---------- picking and bounds ---------- */

  private ray = new THREE.Raycaster();

  /** ndc in -1..1 */
  pick(nx: number, ny: number): string | null {
    this.ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const groups = [...this.rigs.values()].filter((e) => e.rig.group.visible).map((e) => e.rig.group);
    const hit = this.ray.intersectObjects(groups, true)[0];
    if (!hit) return null;
    let o: THREE.Object3D | null = hit.object;
    while (o && !o.userData.deviceId) o = o.parent;
    return o ? (o.userData.deviceId as string) : null;
  }

  /** projected bounds of a device, in 0..1 frame units (y down) */
  bounds(id: string): { x: number; y: number; w: number; h: number } | null {
    const e = this.rigs.get(id);
    if (!e || !e.rig.group.visible) return null;
    e.rig.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(e.rig.group);
    if (box.isEmpty()) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(this.camera);
      x0 = Math.min(x0, v.x);
      x1 = Math.max(x1, v.x);
      y0 = Math.min(y0, v.y);
      y1 = Math.max(y1, v.y);
    }
    return { x: (x0 + 1) / 2, y: (1 - y1) / 2, w: (x1 - x0) / 2, h: (y1 - y0) / 2 };
  }

  /** world position of a device's origin projected to 0..1 frame units */
  project(v: THREE.Vector3) {
    const p = v.clone().project(this.camera);
    return { x: (p.x + 1) / 2, y: (1 - p.y) / 2, z: p.z };
  }

  /** a ray through a frame point (0..1) hits the plane through `origin` facing the camera */
  planePoint(fx: number, fy: number, origin: THREE.Vector3) {
    this.ray.setFromCamera(new THREE.Vector2(fx * 2 - 1, 1 - fy * 2), this.camera);
    const n = new THREE.Vector3();
    this.camera.getWorldDirection(n);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, origin);
    const out = new THREE.Vector3();
    return this.ray.ray.intersectPlane(plane, out) ? out : null;
  }
}
