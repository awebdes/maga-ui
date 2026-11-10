/**
 * Export: frame-exact offline render. Each frame is set up from the document at t = i / fps,
 * videos on screens are seeked to that time, then the canvas goes to the encoder (WebCodecs via
 * mediabunny) or to a PNG.
 */
import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_VERY_HIGH,
  WebMOutputFormat,
  getFirstEncodableVideoCodec,
  type VideoCodec,
} from 'mediabunny';
import type { Project } from './doc';
import { getMedia } from './media';
import type { Studio } from './studio';

export type ExportKind = 'mp4' | 'webm' | 'png';

export interface ExportJob {
  kind: ExportKind;
  scale: number;
  fps: number;
  transparent: boolean;
  time: number;
  onProgress: (p: number, label: string) => void;
  signal: { cancelled: boolean };
}

const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);

async function seekVideos(p: Project, studio: Studio, t: number) {
  const ids = new Set(p.devices.filter((d) => d.visible && d.media).map((d) => d.media!));
  await Promise.all(
    [...ids].map(async (id) => {
      const m = getMedia(id);
      if (!m || m.kind !== 'video') return;
      const v = m.el as HTMLVideoElement;
      v.pause();
      const target = v.duration ? t % v.duration : 0;
      if (Math.abs(v.currentTime - target) < 1e-3) return;
      await new Promise<void>((res) => {
        const done = () => {
          v.removeEventListener('seeked', done);
          res();
        };
        v.addEventListener('seeked', done);
        v.currentTime = target;
        setTimeout(done, 1500);
      });
      studio.refreshVideo(id);
    }),
  );
}

export async function runExport(p0: Project, studio: Studio, job: ExportJob): Promise<{ blob: Blob; name: string; w: number; h: number; frames: number }> {
  const p: Project = JSON.parse(JSON.stringify(p0));
  if (job.transparent) p.bg.kind = 'transparent';
  const w = even(p.format.w * job.scale);
  const h = even(p.format.h * job.scale);
  const keepW = studio.width;
  const keepH = studio.height;
  studio.setSize(w, h);
  await Promise.race([
    Promise.all(p.texts.map((t) => document.fonts.load(`${t.weight} 40px "${t.font}"`, t.text))),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
  studio.invalidateLayers();
  const base = (p.name || 'reel').replace(/[^\p{L}\p{N}\- ]+/gu, '').trim().replace(/\s+/g, '-').toLowerCase() || 'reel';
  try {
    if (job.kind === 'png') {
      await seekVideos(p, studio, job.time);
      studio.render(p, job.time, { frame: 0 });
      const blob = await new Promise<Blob>((res, rej) => studio.renderer.domElement.toBlob((b) => (b ? res(b) : rej(new Error('PNG encode failed'))), 'image/png'));
      return { blob, name: `${base}-${w}x${h}.png`, w, h, frames: 1 };
    }

    const isMp4 = job.kind === 'mp4';
    const codecs: VideoCodec[] = isMp4 ? ['avc', 'hevc', 'vp9', 'av1'] : ['vp9', 'av1', 'vp8'];
    const quality = job.scale >= 2 ? QUALITY_HIGH : QUALITY_VERY_HIGH;
    const codec = await getFirstEncodableVideoCodec(codecs, { width: w, height: h, quality });
    if (!codec) throw new Error(`This browser cannot encode ${isMp4 ? 'MP4' : 'WebM'} at ${w}×${h}. Try ½× or another format.`);
    const output = new Output({ format: isMp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target: new BufferTarget() });
    const source = new CanvasSource(studio.renderer.domElement, { codec, quality, keyFrameInterval: 1 });
    output.addVideoTrack(source, { frameRate: job.fps });
    await output.start();
    const n = Math.max(1, Math.round(p.format.duration * job.fps));
    for (let i = 0; i < n; i++) {
      if (job.signal.cancelled) {
        await output.cancel();
        throw new Error('cancelled');
      }
      const t = i / job.fps;
      await seekVideos(p, studio, t);
      studio.render(p, t, { frame: i });
      await source.add(t, 1 / job.fps);
      job.onProgress((i + 1) / n, `Frame ${i + 1} / ${n}`);
      // let the UI breathe every few frames
      if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
    }
    await output.finalize();
    const buf = (output.target as BufferTarget).buffer!;
    const blob = new Blob([buf], { type: isMp4 ? 'video/mp4' : 'video/webm' });
    return { blob, name: `${base}-${w}x${h}-${job.fps}fps.${isMp4 ? 'mp4' : 'webm'}`, w, h, frames: n };
  } finally {
    studio.setSize(keepW, keepH);
  }
}
