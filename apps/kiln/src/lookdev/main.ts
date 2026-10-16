import * as THREE from 'three/webgpu';
import { createRenderer, hasWebGPUBackend, StillRenderer } from '../render/tracer';
import { encodePng } from '../render/encode';
import { viewPixel, type FloatImage } from '../render/view-transform';
import { Studio } from '../studio/studio';
import { safeBodyGeometry, SAFE_SPOTS } from '../examples/safe';
import { defaultMaterials, type MaterialSet } from '../examples/parts';
import { safeDoc } from '../doc/examples';
import { GeometryCache } from '../doc/geometry';
import { SceneRuntime } from '../doc/runtime';
import type { SceneDoc } from '../doc/scene';
import type { MaterialSpec } from '../scene/materials';
import type { RigParams } from '../scene/lights';
import * as env from '../scene/environment';
import { buildSafeScene } from '../spike/scene';
import * as slabs from '../scene/slab';

/**
 * Look-dev harness: renders an example with the production Studio and reports linear radiance
 * at the example's sample spots, so lights and materials can be fitted to the reference.
 */

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const renderer = await createRenderer(canvas);
renderer.setSize(640, 640, false);
const studio = new Studio(renderer);
// the Safe composition, built from its scene document like the app does
const runtime = new SceneRuntime(new GeometryCache());
const example = { root: runtime.root, spots: SAFE_SPOTS };
const doc: SceneDoc = safeDoc();
let materials: MaterialSet = defaultMaterials();
/** Look-dev parts → objects of the Safe document. */
const PART_OF: Record<string, keyof MaterialSet> = { Safe: 'body', '%': 'accent', Briefcase: 'accent', Coin: 'coin' };
function applyMaterials(_root: unknown, set: Record<keyof MaterialSet, MaterialSpec>) {
  for (const o of doc.objects) {
    const part = PART_OF[o.name];
    if (part) o.materials = { main: { ...set[part] } };
  }
  runtime.reconcile(doc, 'final');
}
applyMaterials(null, materials);
studio.setContent(runtime.root);
studio.setCamera({ az: 23, el: 2, fov: 20, padding: 0.15, ortho: false });
studio.frame(1);
studio.render();

const still = hasWebGPUBackend(renderer) ? new StillRenderer(renderer) : null;
let last: FloatImage | null = null;

function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Linear RGB at a pixel: per-channel median over a (2k+1)² window, opaque pixels only. */
function sample(img: FloatImage, x: number, y: number, k: number) {
  const r: number[] = [], g: number[] = [], b: number[] = [];
  for (let dy = -k; dy <= k; dy++) {
    for (let dx = -k; dx <= k; dx++) {
      const px = Math.round(x) + dx;
      const py = Math.round(y) + dy;
      if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
      const i = (py * img.width + px) * 4;
      if (img.data[i + 3] < 0.99) continue;
      r.push(img.data[i]);
      g.push(img.data[i + 1]);
      b.push(img.data[i + 2]);
    }
  }
  return r.length ? [median(r), median(g), median(b)] : null;
}

async function render(size: number, spp: number, opts: { white?: boolean } = {}) {
  if (!still) throw new Error('WebGPU unavailable');
  if (opts.white) {
    const white = { id: 'white', name: 'White', color: '#ffffff', roughness: 1 };
    applyMaterials(example.root, { body: white, accent: white, coin: white });
  } else {
    applyMaterials(example.root, materials);
  }
  studio.frame(1);
  const res = await still.render(studio.scene, studio.camera, { width: size, height: size, samples: spp });
  last = res;
  const spots = (example.spots ?? []).map((s) => {
    const p = studio.project(new THREE.Vector3(...s.world), size, size);
    return { ...s, x: p.x, y: p.y, linear: sample(res, p.x, p.y, Math.max(1, Math.round(size / 160))) };
  });
  // image center, for quick checks on replaced content
  spots.push({ id: 'center', world: [0, 0, 0], ref: [1000, 1000], hex: '#000000', x: size / 2, y: size / 2, linear: sample(res, size / 2, size / 2, 1) });
  let nan = 0;
  let neg = 0;
  for (let i = 0; i < res.data.length; i++) {
    const v = res.data[i];
    if (Number.isNaN(v)) nan++;
    else if (v < 0) neg++;
  }
  applyMaterials(example.root, materials);
  studio.frame(1);
  studio.render();
  return { ms: Math.round(res.ms), samples: res.samples, spots, nan, neg };
}

Object.assign(window, {
  __lookdev: {
    ready: true,
    studio,
    still,
    env,
    spikeScene: buildSafeScene,
    slabs,
    THREE,
    safeBodyGeometry,
    webgpu: Boolean(still),
    render,
    png: (depth: 8 | 16 = 8) => (last ? Array.from(encodePng(last, depth, studio.view)) : null),
    setRig: (p: Partial<RigParams>) => studio.setRig(p),
    setMaterials: (m: Partial<MaterialSet>) => {
      materials = { ...materials, ...m };
      applyMaterials(example.root, materials);
    },
    setView: (v: Parameters<Studio['setView']>[0]) => studio.setView(v),
    setCamera: (c: Parameters<Studio['setCamera']>[0]) => studio.setCamera(c),
    materials: () => materials,
    /** display sRGB (0..255) for a linear color under the current view transform */
    display: (rgb: [number, number, number]) => {
      const out = [0, 0, 0];
      viewPixel(rgb[0], rgb[1], rgb[2], studio.view, out);
      return out.map((v) => Math.round(v * 255));
    },
    /** side-by-side: ours on white | reference, with the sample spots marked */
    compare: async (refDataUrl: string, spots: { x: number; y: number; ref: [number, number]; id: string }[]) => {
      if (!last) return null;
      const size = last.width;
      const ours = await createImageBitmap(new Blob([new Uint8Array(encodePng(last, 8, studio.view))], { type: 'image/png' }));
      const ref = await createImageBitmap(await (await fetch(refDataUrl)).blob());
      const c = new OffscreenCanvas(size * 2, size);
      const g = c.getContext('2d')!;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, size * 2, size);
      g.drawImage(ours, 0, 0, size, size);
      g.drawImage(ref, size, 0, size, size);
      g.lineWidth = 1.5;
      g.font = '11px sans-serif';
      for (const s of spots) {
        for (const [x, y] of [
          [s.x, s.y],
          [size + (s.ref[0] / ref.width) * size, (s.ref[1] / ref.height) * size],
        ]) {
          g.strokeStyle = '#000';
          g.beginPath();
          g.arc(x, y, 5, 0, Math.PI * 2);
          g.stroke();
          g.fillStyle = '#000';
          g.fillText(s.id, x + 7, y + 4);
        }
      }
      const blob = await c.convertToBlob({ type: 'image/png' });
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    /** reference colors: per-channel median of a 15 px window at each spot */
    sampleRef: async (refDataUrl: string, spots: { ref: [number, number] }[]) => {
      const bmp = await createImageBitmap(await (await fetch(refDataUrl)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d')!;
      g.drawImage(bmp, 0, 0);
      return spots.map((s) => {
        const d = g.getImageData(Math.round(s.ref[0]) - 7, Math.round(s.ref[1]) - 7, 15, 15).data;
        const ch = [0, 1, 2].map((k) => {
          const v: number[] = [];
          for (let i = k; i < d.length; i += 4) v.push(d[i]);
          return median(v);
        });
        return ch;
      });
    },
  },
});
