import * as THREE from 'three/webgpu';
import { createRenderer, hasWebGPUBackend, StillRenderer } from '../render/tracer';
import { encodePng, pngBlob } from '../render/encode';
import { alphaBounds, downscale, type FloatImage } from '../render/view-transform';
import { greenClayStudio, studioTexture } from '../scene/environment';
import { placeCamera, fitOrtho } from '../scene/camera';
import { buildSafeScene } from './scene';
import { runMesherSuite } from './mesher-suite';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const log = (msg: string) => {
  const el = $('#log');
  el.textContent += msg + '\n';
  el.scrollTop = el.scrollHeight;
  console.log(msg);
};

const canvas = $<HTMLCanvasElement>('#preview');
const renderer = await createRenderer(canvas);
const webgpu = hasWebGPUBackend(renderer);
log(`backend: ${webgpu ? 'WebGPU' : 'WebGL2 fallback'}`);

const scene = new THREE.Scene();
scene.background = null;
scene.environment = studioTexture(greenClayStudio());
scene.environmentIntensity = 1;

const content = new THREE.Group();
scene.add(content);
const subject = buildSafeScene();
content.add(subject);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
const view = { az: 25, el: 12 };
function canvasAspect() {
  const r = canvas.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r.width / r.height : 1;
}
function frame(aspect = canvasAspect()) {
  placeCamera(camera, view.az, view.el, new THREE.Vector3(), 10);
  fitOrtho(camera, content, 0.15, aspect);
  // light rig follows the camera so every angle is lit the same way
  scene.environmentRotation.set(0, (view.az * Math.PI) / 180, 0);
}
frame();

function resize() {
  const r = canvas.getBoundingClientRect();
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.setSize(r.width, r.height, false);
  frame();
}
resize();
window.addEventListener('resize', resize);

let livePaused = false;
renderer.setAnimationLoop(() => {
  if (!livePaused) renderer.render(scene, camera);
});

const still = webgpu ? new StillRenderer(renderer) : null;
let last: FloatImage | null = null;

async function renderStill(width: number, height: number, samples: number, flipY = false, debug = false) {
  if (!still) throw new Error('Path tracing needs WebGPU');
  livePaused = true;
  frame(width / height);
  try {
    const res = await still.render(scene, camera, {
      width,
      height,
      samples,
      flipY,
      debug,
      onProgress: (p, s) => ($('#progress').textContent = `${Math.round(p * 100)}% · ${s} spp`),
    });
    last = res;
    const bounds = alphaBounds(res);
    const corner = res.data[3];
    let nan = 0;
    for (let i = 0; i < res.data.length; i++) if (Number.isNaN(res.data[i])) nan++;
    const stats = {
      width,
      height,
      samples: res.samples,
      ms: Math.round(res.ms),
      cornerAlpha: corner,
      bounds,
      nan,
    };
    log(`render ${width}×${height} @${res.samples}spp: ${stats.ms} ms, corner α=${corner.toFixed(3)}, NaN=${nan}, bounds=${JSON.stringify(bounds)}`);
    show(res);
    return stats;
  } finally {
    frame();
    livePaused = false;
  }
}

async function showSuite() {
  subject.visible = false;
  const rows = await runMesherSuite(log, { scene: content });
  const suite = content.getObjectByName('mesher-suite');
  if (suite) content.add(suite);
  frame();
  return rows;
}

function show(img: FloatImage) {
  const png = encodePng(img, 8);
  const url = URL.createObjectURL(pngBlob(png));
  $<HTMLImageElement>('#result').src = url;
  // QA strip: 128 and 96 px on light and dark
  const strip = $('#qa');
  strip.innerHTML = '';
  for (const size of [128, 96, 48]) {
    const small = downscale(img, size, Math.round((size * img.height) / img.width));
    const u = URL.createObjectURL(pngBlob(encodePng(small, 8)));
    for (const bg of ['#f4f4f2', '#16161a']) {
      const cell = document.createElement('div');
      cell.className = 'qa-cell';
      cell.style.background = bg;
      cell.innerHTML = `<img src="${u}" width="${size}" height="${size}" alt=""><span>${size}px</span>`;
      strip.appendChild(cell);
    }
  }
}

function download(depth: 8 | 16) {
  if (!last) return;
  const blob = pngBlob(encodePng(last, depth));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kiln-spike-${last.width}-${depth}bit.png`;
  a.click();
}

$('#render').addEventListener('click', async () => {
  const size = Number(($('#size') as HTMLSelectElement).value);
  const spp = Number(($('#spp') as HTMLSelectElement).value);
  try {
    await renderStill(size, size, spp);
  } catch (e) {
    log(`error: ${(e as Error).message}`);
  }
});
$('#png8').addEventListener('click', () => download(8));
$('#png16').addEventListener('click', () => download(16));
$('#mesher').addEventListener('click', () => showSuite());
$<HTMLInputElement>('#az').addEventListener('input', (e) => {
  view.az = Number((e.target as HTMLInputElement).value);
  frame();
});
$<HTMLInputElement>('#el').addEventListener('input', (e) => {
  view.el = Number((e.target as HTMLInputElement).value);
  frame();
});

/** Automation hooks for Playwright. */
Object.assign(window, {
  __spike: {
    webgpu,
    renderStill,
    runMesherSuite: showSuite,
    png: (depth: 8 | 16) => (last ? Array.from(encodePng(last, depth)) : null),
    ready: true,
  },
});
