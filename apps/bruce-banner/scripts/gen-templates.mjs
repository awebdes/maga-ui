#!/usr/bin/env node
// Converts the legacy templates (J5) and copy (qDe) from tests/legacy/engine.js into
// src/engine/templates.data.ts in the new layer model. Values are copied verbatim; only the
// shape changes (font stacks → 'body' | 'head', asset URLs → asset ids, template colours → layers).
// Run after `npm run vendor`: node scripts/gen-templates.mjs
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const legacy = await import(new URL('../tests/legacy/engine.js', import.meta.url));
const { J5, qDe, z5 } = legacy;

const assetIdByUrl = Object.fromEntries(Object.entries(z5).map(([id, url]) => [url, id]));
const asset = (url) => {
  const id = assetIdByUrl[url];
  if (!id) throw new Error(`unknown asset ${url.slice(0, 60)}`);
  return id;
};
const fam = (stack) => (stack.trim().startsWith("'Squad'") ? 'head' : 'body');

const THEME_BY_TEMPLATE = {
  loan: 'emerald',
  daromax: 'night',
  humo: 'emerald',
  uzcard: 'lime',
  zero: 'green',
  mcstandard: 'silver',
  mcgold: 'gold',
  cumulative: 'sky',
  emptyloan: 'light',
  emptydeposit: 'light',
  visaclassic: 'graphite',
  visagold: 'bronze',
  mortgage: 'green',
  oddly: 'orange',
  rublerate: 'green',
};

function layer(l, t) {
  const shadow = l.shadow ? { shadow: { ...l.shadow } } : {};
  switch (l.kind) {
    case 'glow':
      return { id: l.id, kind: 'glow', cx: l.cx, cy: l.cy, r: l.r, blur: l.blur, color: l.color, opacity: l.opacity };
    case 'image':
      return { id: l.id, kind: 'image', src: asset(l.src), cx: l.cx, cy: l.cy, w: l.w, h: l.h, rot: l.rot, ...shadow };
    case 'imageClip':
      return { id: l.id, kind: 'imageClip', src: asset(l.src), box: { ...l.box }, img: { ...l.img } };
    case 'card':
      return { id: l.id, kind: 'card', src: asset(l.src), cx: l.cx, cy: l.cy, w: l.w, h: l.h, rot: l.rot, radius: l.radius, border: l.border, ...shadow };
    case 'pill':
      return {
        id: l.id,
        kind: 'pill',
        icon: asset(l.icon),
        cx: l.cx,
        cy: l.cy,
        w: l.w,
        h: l.h,
        radius: l.radius,
        iconBox: { ...l.iconBox },
        iconDraw: { ...l.iconDraw },
        iconRot: l.iconRot ?? 0,
        ...shadow,
      };
    case 'badge':
      return {
        id: l.id,
        kind: 'badge',
        contentKey: l.contentKey,
        cx: l.cx,
        cy: l.cy,
        rot: l.rot,
        font: fam(l.font),
        size: l.size,
        weight: l.weight,
        lineHeight: l.lineHeight,
        paddingX: l.paddingX,
        paddingY: l.paddingY,
        radius: l.radius,
        background: t.badgeBackground,
        foreground: t.badgeForeground,
        ...(l.halo ? { halo: { ...l.halo } } : {}),
      };
    case 'badgeRow':
      return {
        id: l.id,
        kind: 'badgeRow',
        x: l.x,
        gap: l.gap,
        offset: 8,
        font: fam(l.font),
        size: l.size,
        weight: l.weight,
        lineHeight: l.lineHeight,
        paddingX: l.paddingX,
        paddingY: l.paddingY,
        radius: l.radius,
        items: l.items.map((it) => ({ contentKey: it.contentKey, background: it.background, foreground: it.foreground })),
      };
    case 'text':
      return {
        id: l.id,
        kind: 'text',
        contentKey: l.contentKey,
        x: l.x,
        y: l.y,
        w: l.w,
        font: fam(l.font),
        size: l.size,
        weight: l.weight,
        lineHeight: l.lineHeight,
        tracking: l.tracking,
        vAlign: l.vAlign,
        color: t.textColor,
        maxLines: 3,
        minSize: 13,
        ...(l.subContentKey
          ? {
              sub: {
                contentKey: l.subContentKey,
                font: fam(l.subFont ?? l.font),
                size: l.subSize,
                weight: l.subWeight ?? 500,
                lineHeight: l.subLineHeight,
                gap: l.subGap ?? 0,
                color: 'rgba(255,255,255,0.7)',
              },
            }
          : {}),
      };
    case 'stat':
      return {
        id: l.id,
        kind: 'stat',
        contentKey: l.contentKey,
        unitContentKey: l.unitContentKey,
        font: fam(l.font),
        cx: l.cx,
        cy: l.cy,
        rot: l.rot,
        size: l.size,
        unitSize: l.unitSize,
        gap: l.gap,
        paddingX: l.paddingX,
        paddingY: l.paddingY,
        background: t.badgeBackground,
        foreground: t.badgeForeground,
        ...(l.halo ? { halo: { ...l.halo } } : {}),
      };
    default:
      throw new Error(`unknown layer kind ${l.kind}`);
  }
}

const templates = J5.map((t) => {
  const copy = {};
  for (const lang of ['ru', 'uz', 'en']) {
    for (const [slot, text] of Object.entries(qDe[t.id]?.[lang] ?? {})) {
      copy[slot] ??= { ru: '', uz: '', en: '' };
      copy[slot][lang] = text;
    }
  }
  return {
    id: t.id,
    label: t.title,
    group: t.group,
    figmaNodeId: t.figmaNodeId,
    theme: THEME_BY_TEMPLATE[t.id],
    background: t.background.type === 'solid' ? { type: 'solid', color: t.background.color } : { type: 'linear', angle: t.background.angle, stops: t.background.stops.map((s) => ({ color: s.color, position: s.position })) },
    layers: t.layers.map((l) => layer(l, t)),
    copy,
  };
});

const out = `// Generated by scripts/gen-templates.mjs from the legacy Bruce Banner build (J5 templates, qDe copy).
// Coordinates, colours, fonts and copy are verbatim; edit the generator, not this file.
import type { TemplateDef } from './templates';

export const TEMPLATE_DATA: TemplateDef[] = ${JSON.stringify(templates, null, 2)};
`;
await writeFile(`${root}src/engine/templates.data.ts`, out);
console.log(`src/engine/templates.data.ts: ${templates.length} templates`);
