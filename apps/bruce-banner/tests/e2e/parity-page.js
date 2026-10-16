// Parity page: renders every template in every language with the legacy engine (the oracle,
// tests/legacy/engine.js) and with src/engine, on canvases of the same size, and diffs them.
// Driven by tests/e2e/parity.mjs through window.__parity.
import * as legacy from '/tests/legacy/engine.js';
import { TEMPLATES, LANGS, docFromTemplate, renderBanner, frameBounds } from '/src/engine/index.ts';
import { measure, resetMeasure } from '/src/render/measure.ts';
import { loadBrandFonts } from '/src/render/fonts.ts';
import { getImage, preloadDoc } from '/src/render/images.ts';

const W = 328;
const H = 106;
const DESIGN = { width: W, height: H };
const THRESHOLD = 16;

const valuesFor = (id, lang) => ({ ...legacy._Oe(id), 'banner.language': lang, 'banner.template': id, 'export.includeBackground': true });

function canvas(n) {
  const c = document.createElement('canvas');
  c.width = Math.round(W * n);
  c.height = Math.round(H * n);
  return c;
}

/** As the legacy app exported: the runtime fills the solid colour, v7 paints gradients and layers. */
export function renderLegacy(id, lang, n) {
  const c = canvas(n);
  const ctx = c.getContext('2d');
  const values = valuesFor(id, lang);
  ctx.fillStyle = values['appearance.background'];
  ctx.fillRect(0, 0, c.width, c.height);
  legacy.v7(ctx, { width: c.width, height: c.height }, { background: legacy.h7(values), design: DESIGN, layers: legacy.g7(values, DESIGN) }, legacy.d7);
  return c;
}

export function renderOurs(id, lang, n, compat) {
  const c = canvas(n);
  const doc = docFromTemplate(id, { now: 0 });
  const lay = renderBanner(c.getContext('2d'), doc, { lang, scale: n, measure, image: getImage, compat });
  return { c, lay, doc };
}

/** Share of differing pixels per layer box (design frames scaled) and the largest differing blob. */
function diff(a, b, lay, n) {
  const w = a.width;
  const h = a.height;
  const pa = a.getContext('2d').getImageData(0, 0, w, h).data;
  const pb = b.getContext('2d').getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  let total = 0;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const d = Math.max(Math.abs(pa[o] - pb[o]), Math.abs(pa[o + 1] - pb[o + 1]), Math.abs(pa[o + 2] - pb[o + 2]), Math.abs(pa[o + 3] - pb[o + 3]));
    if (d > THRESHOLD) {
      mask[i] = 1;
      total++;
    }
  }
  const boxes = {};
  let maxBox = 0;
  for (const [id, f] of Object.entries(lay.frames)) {
    const r = frameBounds(f);
    const x0 = Math.max(0, Math.floor(r.x * n));
    const y0 = Math.max(0, Math.floor(r.y * n));
    const x1 = Math.min(w, Math.ceil(r.right * n));
    const y1 = Math.min(h, Math.ceil(r.bottom * n));
    if (x1 <= x0 || y1 <= y0) continue;
    let bad = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) bad += mask[y * w + x];
    const share = bad / ((x1 - x0) * (y1 - y0));
    boxes[id] = +share.toFixed(5);
    maxBox = Math.max(maxBox, share);
  }
  // largest 4-connected blob of differing pixels
  let blob = 0;
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || seen[i]) continue;
    let size = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop();
      size++;
      const x = p % w;
      const y = (p - x) / w;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) if (q >= 0 && mask[q] && !seen[q]) {
        seen[q] = 1;
        stack.push(q);
      }
    }
    blob = Math.max(blob, size);
  }
  return { total: total / (w * h), maxBox, blob, blobShare: blob / (w * h), boxes, mask };
}

function sheet(scale = 2) {
  const cw = Math.round(W * scale);
  const ch = Math.round(H * scale);
  const gap = 14;
  const label = 22;
  const out = document.createElement('canvas');
  out.width = 3 * cw + 4 * gap;
  out.height = TEMPLATES.length * (ch + label + gap) + gap + label;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#121214';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.fillStyle = '#9a9aa2';
  ctx.font = '600 14px system-ui';
  ['было (старый движок)', 'стало (исправленный режим)', 'разница в режиме совместимости'].forEach((t, i) => ctx.fillText(t, gap + i * (cw + gap), gap + 14));
  TEMPLATES.forEach((t, row) => {
    const y = gap + label + row * (ch + label + gap);
    const old = renderLegacy(t.id, 'ru', scale);
    const fixed = renderOurs(t.id, 'ru', scale, false).c;
    const compat = renderOurs(t.id, 'ru', scale, true);
    const d = diff(old, compat.c, compat.lay, scale);
    const heat = document.createElement('canvas');
    heat.width = cw;
    heat.height = ch;
    const hc = heat.getContext('2d');
    hc.globalAlpha = 0.35;
    hc.drawImage(old, 0, 0);
    hc.globalAlpha = 1;
    const img = hc.getImageData(0, 0, cw, ch);
    for (let i = 0; i < d.mask.length; i++) if (d.mask[i]) {
      img.data[i * 4] = 255;
      img.data[i * 4 + 1] = 40;
      img.data[i * 4 + 2] = 80;
      img.data[i * 4 + 3] = 255;
    }
    hc.putImageData(img, 0, 0);
    ctx.fillStyle = '#e8e8ea';
    ctx.font = '500 13px system-ui';
    ctx.fillText(`${t.id} · ${t.label}`, gap, y + 14);
    ctx.fillStyle = '#9a9aa2';
    ctx.fillText(`diff ${(d.total * 100).toFixed(3)}% · blob ${d.blob}px`, gap + 2 * (cw + gap), y + 14);
    [old, fixed, heat].forEach((c, i) => ctx.drawImage(c, gap + i * (cw + gap), y + label));
  });
  return out.toDataURL('image/png');
}

async function run({ scales = [1, 2, 3], langs = LANGS } = {}) {
  const rows = [];
  for (const t of TEMPLATES) {
    for (const lang of langs) {
      for (const n of scales) {
        const old = renderLegacy(t.id, lang, n);
        const ours = renderOurs(t.id, lang, n, true);
        const d = diff(old, ours.c, ours.lay, n);
        rows.push({ id: t.id, lang, n, total: d.total, maxBox: d.maxBox, blob: d.blob, blobShare: d.blobShare, boxes: d.boxes });
      }
    }
  }
  return rows;
}

/** One template rendered by both engines, as PNG data URLs (for debugging a failing row). */
function pair(id, lang, n) {
  return { legacy: renderLegacy(id, lang, n).toDataURL(), ours: renderOurs(id, lang, n, true).c.toDataURL(), fixed: renderOurs(id, lang, n, false).c.toDataURL() };
}

/**
 * Legacy render at an arbitrary output size. `prescaled` reproduces the Toolcraft export: the
 * runtime scales the context and hands v7 a frame in design units, so blur and shadows (which
 * ignore the transform) come out at 1× strength in a 2K/4K file.
 */
function legacyExport(id, lang, width, height, prescaled = false) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  const values = valuesFor(id, lang);
  ctx.fillStyle = values['appearance.background'];
  ctx.fillRect(0, 0, width, height);
  const scene = { background: legacy.h7(values), design: DESIGN, layers: legacy.g7(values, DESIGN) };
  if (prescaled) {
    const k = Math.min(width / W, height / H);
    ctx.translate((width - W * k) / 2, (height - H * k) / 2);
    ctx.scale(k, k);
    legacy.v7(ctx, DESIGN, scene, legacy.d7);
  } else legacy.v7(ctx, { width, height }, scene, legacy.d7);
  return c.toDataURL('image/png');
}

async function init() {
  const fonts = await loadBrandFonts();
  resetMeasure();
  for (const t of TEMPLATES) await preloadDoc(docFromTemplate(t.id));
  const urls = new Set();
  for (const t of TEMPLATES) for (const lang of LANGS) for (const u of legacy.a7(legacy.g7(valuesFor(t.id, lang), DESIGN))) urls.add(u);
  await legacy.f7([...urls]);
  window.__parity = { ready: true, fonts, run, sheet, pair, legacyExport };
  document.getElementById('state').textContent = `ready · fonts missing: ${fonts.missing.length}`;
}

init().catch((e) => {
  document.getElementById('state').textContent = `error: ${e.message}`;
  window.__parity = { ready: false, error: e.message };
});
