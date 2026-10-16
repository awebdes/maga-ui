import { $, juice, kit, pop, toast, fmtBytes } from '../ui/kit/core';
import { initSeg } from '../ui/kit/components';
import { encodePng, encodeOnBackground, pngBlob } from '../render/encode';
import { downscale, type FloatImage } from '../render/view-transform';
import type { Tracer } from '../render/tracer';
import type { Studio } from '../studio/studio';

export interface ExportDeps {
  studio: Studio;
  tracer: Tracer | null;
  /** waits for the fine mesh; exports never use the preview mesh */
  ensureFinal(): Promise<void>;
  /** file name stem */
  name(): string;
  /** stop the viewport and frame the camera for a square still */
  begin(): void;
  /** restore the viewport framing */
  end(): void;
}

export interface ExportRecord {
  bytes: Uint8Array;
  width: number;
  height: number;
  depth: 8 | 16;
  samples: number;
  ms: number;
  background: string;
}

/** The claude.ai artifact viewer blocks `<a download>`; its `downloads` capability saves instead. */
interface ViewerDownloads {
  save(req: { filename: string; data: Blob }): Promise<{ status: 'saved' | 'delivered' }>;
}
type ViewerRuntime = { use(name: string): Promise<unknown> };
const viewer = (window as unknown as { claude?: ViewerRuntime }).claude;
let viewerDownloads: ViewerDownloads | null = null;
viewer
  ?.use('downloads')
  .then((d) => (viewerDownloads = (d as ViewerDownloads | null) ?? null))
  .catch(() => (viewerDownloads = null));

const BACKGROUNDS: Record<string, [number, number, number] | null> = {
  transparent: null,
  light: [244, 244, 242],
  dark: [18, 18, 20],
};

export function initExport(deps: ExportDeps) {
  const sheet = $('#export-sheet')!;
  const openBtn = $<HTMLButtonElement>('#export-btn')!;
  const go = $<HTMLButtonElement>('#exp-render')!;
  const goLabel = $('#exp-render-label')!;
  const dl = $<HTMLAnchorElement>('#exp-download')!;
  const result = $('#exp-result')!;
  const preview = $<HTMLImageElement>('#exp-img')!;
  const qa = $('#exp-qa')!;
  const meta = $('#exp-meta')!;
  const size = initSeg($('#exp-size')!);
  const quality = initSeg($('#exp-quality')!);
  const depth = initSeg($('#exp-depth')!);
  const bg = initSeg($('#exp-bg')!);
  let sizeOverride: number | null = null;
  let lastBlob: Blob | null = null;
  let controller: AbortController | null = null;
  let lastUrl = '';
  let last: ExportRecord | null = null;
  const qaUrls: string[] = [];

  const setProgress = (p: number) => {
    for (const el of [go, openBtn]) el.querySelector<HTMLElement>('.progress')?.style.setProperty('--p', p.toFixed(3));
  };

  function toggle() {
    pop.toggle(sheet, openBtn);
  }
  openBtn.addEventListener('click', toggle);
  $('#export-close')!.addEventListener('click', () => pop.close(sheet, { restore: true }));
  // any setting change makes the last result stale
  for (const seg of ['#exp-size', '#exp-quality', '#exp-depth', '#exp-bg']) $(seg)!.addEventListener('change', () => (dl.hidden = true));

  function showQa(img: FloatImage) {
    qaUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    qa.textContent = '';
    // shown at true pixel size, so a 48 px icon reads exactly as it will in a product
    const sizes = [96, 64, 48];
    const urls = sizes.map((s) => {
      const small = downscale(img, s, Math.round((s * img.height) / img.width));
      const url = URL.createObjectURL(pngBlob(encodePng(small, 8, deps.studio.view)));
      qaUrls.push(url);
      return url;
    });
    for (const tone of ['light', 'dark']) {
      const row = document.createElement('div');
      row.className = `qa-row ${tone}`;
      sizes.forEach((s, i) => {
        const cell = document.createElement('div');
        cell.className = 'qa-cell';
        const im = new Image(s, s);
        im.src = urls[i];
        im.alt = '';
        const cap = document.createElement('span');
        cap.textContent = `${s}`;
        cell.append(im, cap);
        row.appendChild(cell);
      });
      qa.appendChild(row);
    }
  }

  async function render() {
    if (controller) {
      controller.abort();
      return;
    }
    const tracer = deps.tracer;
    if (!tracer) {
      toast('Export needs WebGPU', 'Chrome 121+ or Safari 26+', 'error');
      return;
    }
    const px = sizeOverride ?? Number(size.value);
    const samples = Number(quality.value);
    const bits = Number(depth.value) as 8 | 16;
    const bgName = bg.value;
    controller = new AbortController();
    const signal = controller.signal;
    go.classList.add('is-busy');
    openBtn.classList.add('is-busy', 'is-held');
    juice.hold(openBtn, true);
    kit.busy = true;
    goLabel.textContent = 'Meshing…';
    dl.hidden = true;
    setProgress(0);
    const t0 = performance.now();
    try {
      await deps.ensureFinal();
      if (signal.aborted) throw new DOMException('Render cancelled', 'AbortError');
      deps.begin();
      goLabel.textContent = 'Rendering · 0%';
      const img = await tracer.still(deps.studio.scene, deps.studio.camera, {
        width: px,
        height: px,
        samples,
        signal,
        onProgress: (p, spp) => {
          setProgress(p);
          goLabel.textContent = `Rendering · ${Math.round(p * 100)}% · ${spp} spp`;
        },
      });
      const background = BACKGROUNDS[bgName];
      const bytes = background ? encodeOnBackground(img, bits, deps.studio.view, background) : encodePng(img, bits, deps.studio.view);
      const blob = pngBlob(bytes);
      lastBlob = blob;
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = URL.createObjectURL(blob);
      preview.src = lastUrl;
      dl.href = lastUrl;
      dl.download = `kiln-${deps.name()}-${px}${bits === 16 ? '-16bit' : ''}.png`;
      dl.hidden = false;
      result.hidden = false;
      showQa(img);
      const secs = (performance.now() - t0) / 1000;
      meta.textContent = `${px}×${px} · ${img.samples} spp · ${secs.toFixed(1)} s · ${fmtBytes(blob.size)}`;
      last = { bytes, width: px, height: px, depth: bits, samples: img.samples, ms: Math.round(performance.now() - t0), background: bgName };
      toast('Render ready', `${px}px · ${secs.toFixed(0)} s`);
    } catch (e) {
      if ((e as Error).name === 'AbortError') toast('Render cancelled');
      else {
        console.error(e);
        toast('Render failed', (e as Error).message, 'error');
      }
    } finally {
      deps.end();
      controller = null;
      go.classList.remove('is-busy');
      openBtn.classList.remove('is-busy', 'is-held');
      juice.hold(openBtn, false);
      kit.busy = false;
      goLabel.textContent = 'Render';
      setProgress(0);
    }
  }
  go.addEventListener('click', render);
  // inside the artifact viewer the link is inert: hand the file to the viewer's save prompt
  dl.addEventListener('click', (e) => {
    if (!viewer) return;
    e.preventDefault();
    if (!lastBlob) return;
    if (!viewerDownloads) {
      toast('Saving is off in this view', 'Open Kiln locally to download', 'error');
      return;
    }
    viewerDownloads.save({ filename: dl.download, data: lastBlob }).then(
      (r) => r.status === 'saved' && toast('Saved', dl.download),
      (err: { code?: string }) => {
        if (err?.code === 'declined') return;
        toast('Could not save the file', err?.code === 'rate_limited' ? 'Another save is open' : 'Try again', 'error');
      },
    );
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && controller) controller.abort();
  });

  return {
    toggle,
    render,
    get busy() {
      return controller !== null;
    },
    get last() {
      return last;
    },
    /** e2e: render at a size the sheet doesn't offer */
    setSizeOverride(n: number | null) {
      sizeOverride = n;
    },
  };
}
