/**
 * Glyph library: a banking shortlist that ships with the app, plus every Phosphor fill icon
 * (1,512) loaded on the first search as one lazy chunk.
 */

const SHORT = import.meta.glob(
  '/node_modules/@phosphor-icons/core/assets/fill/{house,bank,vault,wallet,credit-card,coins,piggy-bank,percent,seal-percent,briefcase,shield-check,lock-simple,key,map-pin,gift,chart-line-up,chart-pie-slice,hand-coins,receipt,money,currency-circle-dollar,storefront,car,airplane-tilt,graduation-cap,heart,star,user,gauge,calculator,trophy,rocket-launch,lightning,bell,device-mobile,handshake,house-simple,shield}-fill.svg',
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

export interface Glyph {
  name: string;
  svg: string;
  tags?: string[];
}

const nameOf = (path: string) => path.split('/').pop()!.replace(/-fill\.svg$/, '');

/** Shortlist in the order designers reach for them. */
const ORDER = [
  'house', 'bank', 'vault', 'wallet', 'credit-card', 'coins',
  'piggy-bank', 'percent', 'seal-percent', 'briefcase', 'shield-check', 'lock-simple',
  'key', 'map-pin', 'gift', 'chart-line-up', 'chart-pie-slice', 'hand-coins',
  'receipt', 'money', 'currency-circle-dollar', 'storefront', 'car', 'airplane-tilt',
  'graduation-cap', 'heart', 'star', 'user', 'gauge', 'calculator',
  'trophy', 'rocket-launch', 'lightning', 'bell', 'device-mobile', 'handshake',
];

const byName = new Map(Object.entries(SHORT).map(([p, svg]) => [nameOf(p), svg]));
export const SHORTLIST: Glyph[] = ORDER.filter((n) => byName.has(n)).map((name) => ({ name, svg: byName.get(name)! }));

export function shortGlyph(name: string): Glyph {
  const svg = byName.get(name);
  if (!svg) throw new Error(`Unknown glyph ${name}`);
  return { name, svg };
}

let all: Promise<Glyph[]> | null = null;
/** Every fill icon with its Phosphor tags. One chunk, loaded once. */
export function loadAllGlyphs(): Promise<Glyph[]> {
  all ??= import('./glyphs-all').then((m) => m.ALL_GLYPHS);
  return all;
}

/** Ranks by name match first, then tag match. */
export function searchGlyphs(list: Glyph[], query: string, limit = 120): Glyph[] {
  const q = query.trim().toLowerCase();
  if (!q) return list.slice(0, limit);
  const words = q.split(/\s+/);
  const scored: { g: Glyph; s: number }[] = [];
  for (const g of list) {
    let s = 0;
    for (const w of words) {
      if (g.name === w) s += 10;
      else if (g.name.startsWith(w)) s += 6;
      else if (g.name.includes(w)) s += 4;
      else if (g.tags?.some((t) => t.startsWith(w))) s += 2;
      else {
        s = 0;
        break;
      }
    }
    if (s > 0) scored.push({ g, s });
  }
  scored.sort((a, b) => b.s - a.s || a.g.name.length - b.g.name.length);
  return scored.slice(0, limit).map((x) => x.g);
}
