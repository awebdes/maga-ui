import type { Background, BannerDoc } from './types';

/**
 * Brand themes, taken from the backgrounds of the official templates. A theme recolours every
 * role at once, shadows included: a card shadow that stays green on orange looks broken.
 */
export interface Theme {
  id: string;
  label: string;
  background: Background;
  text: string;
  sub: string;
  badge: { bg: string; fg: string };
  /** second badge in a row (Oddiy: 3/6/12 мес.) */
  accent: { bg: string; fg: string };
  stat: { bg: string; fg: string };
  glow: string;
  cardShadow: string;
  pillShadow: string;
  artShadow: string;
}

const solid = (color: string): Background => ({ type: 'solid', color });

export const THEMES: Theme[] = [
  {
    id: 'emerald',
    label: 'Изумруд',
    background: solid('#006648'),
    text: '#FFFFFF',
    sub: 'rgba(255,255,255,0.7)',
    badge: { bg: '#FFFFFF', fg: '#000000' },
    accent: { bg: '#52AE30', fg: '#FFFFFF' },
    stat: { bg: '#FFFFFF', fg: '#006648' },
    glow: '#52AE30',
    cardShadow: '#348018',
    pillShadow: '#3B8A1E',
    artShadow: '#004D36',
  },
  {
    id: 'green',
    label: 'Зелёная',
    background: solid('#058237'),
    text: '#FFFFFF',
    sub: 'rgba(255,255,255,0.7)',
    badge: { bg: '#FFFFFF', fg: '#000000' },
    accent: { bg: '#006648', fg: '#FFFFFF' },
    stat: { bg: '#FFFFFF', fg: '#058237' },
    glow: '#52AE30',
    cardShadow: '#036A2C',
    pillShadow: '#036A2C',
    artShadow: '#058237',
  },
  {
    id: 'lime',
    label: 'Лайм',
    background: solid('#4EA62E'),
    text: '#FFFFFF',
    sub: 'rgba(255,255,255,0.75)',
    badge: { bg: '#FFFFFF', fg: '#000000' },
    accent: { bg: '#006648', fg: '#FFFFFF' },
    stat: { bg: '#FFFFFF', fg: '#3D8A22' },
    glow: '#74E64A',
    cardShadow: '#348018',
    pillShadow: '#3B8A1E',
    artShadow: '#2E7A1A',
  },
  {
    id: 'night',
    label: 'Ночь',
    background: solid('#000000'),
    text: '#FFFFFF',
    sub: 'rgba(255,255,255,0.7)',
    badge: { bg: '#FFFFFF', fg: '#000000' },
    accent: { bg: '#52AE30', fg: '#FFFFFF' },
    stat: { bg: '#FFFFFF', fg: '#000000' },
    glow: '#52AE30',
    cardShadow: 'rgba(0,0,0,0.6)',
    pillShadow: 'rgba(0,0,0,0.6)',
    artShadow: 'rgba(0,0,0,0.6)',
  },
  {
    id: 'sky',
    label: 'Небо',
    background: solid('#1382D6'),
    text: '#FFFFFF',
    sub: 'rgba(255,255,255,0.75)',
    badge: { bg: '#FFFFFF', fg: '#000000' },
    accent: { bg: '#0B5FA0', fg: '#FFFFFF' },
    stat: { bg: '#FFFFFF', fg: '#1382D6' },
    glow: '#7CECFF',
    cardShadow: '#0E5E9C',
    pillShadow: '#0E5E9C',
    artShadow: '#0E5E9C',
  },
  {
    id: 'orange',
    label: 'Апельсин',
    background: solid('#F4821F'),
    text: '#FFFFFF',
    sub: 'rgba(255,255,255,0.8)',
    badge: { bg: '#FFFFFF', fg: '#DA6C0E' },
    accent: { bg: '#E06E0B', fg: '#FFFFFF' },
    stat: { bg: '#FFFFFF', fg: '#DA6C0E' },
    glow: '#FAC67A',
    cardShadow: '#C4620F',
    pillShadow: '#C4620F',
    artShadow: '#C4620F',
  },
  {
    id: 'silver',
    label: 'Серебро',
    background: { type: 'linear', angle: 90, stops: [{ color: '#9DA090', position: 0 }, { color: '#7D7E79', position: 1 }] },
    text: '#FFFFFF',
    sub: 'rgba(255,255,255,0.75)',
    badge: { bg: '#FFFFFF', fg: '#000000' },
    accent: { bg: '#5F615A', fg: '#FFFFFF' },
    stat: { bg: '#FFFFFF', fg: '#6D7065' },
    glow: '#9DA090',
    cardShadow: '#6D7065',
    pillShadow: '#76796C',
    artShadow: '#6D7065',
  },
  {
    id: 'graphite',
    label: 'Графит',
    background: solid('#7B7E82'),
    text: '#FFFFFF',
    sub: 'rgba(255,255,255,0.75)',
    badge: { bg: '#FFFFFF', fg: '#000000' },
    accent: { bg: '#55585C', fg: '#FFFFFF' },
    stat: { bg: '#FFFFFF', fg: '#55585C' },
    glow: '#A7A8A9',
    cardShadow: '#848587',
    pillShadow: '#848587',
    artShadow: '#5E6164',
  },
  {
    id: 'gold',
    label: 'Золото',
    background: { type: 'linear', angle: 90, stops: [{ color: '#927043', position: 0.495 }, { color: '#CFA663', position: 1 }] },
    text: '#FFFFFF',
    sub: 'rgba(255,255,255,0.75)',
    badge: { bg: '#FFFFFF', fg: '#000000' },
    accent: { bg: '#7A5A2E', fg: '#FFFFFF' },
    stat: { bg: '#FFFFFF', fg: '#927043' },
    glow: '#CFA663',
    cardShadow: '#927144',
    pillShadow: '#927043',
    artShadow: '#7A5A2E',
  },
  {
    id: 'bronze',
    label: 'Бронза',
    background: solid('#98722B'),
    text: '#FFFFFF',
    sub: 'rgba(255,255,255,0.75)',
    badge: { bg: '#FFFFFF', fg: '#000000' },
    accent: { bg: '#7A5A1F', fg: '#FFFFFF' },
    stat: { bg: '#FFFFFF', fg: '#7A5A1F' },
    glow: '#CDAD7F',
    cardShadow: '#927144',
    pillShadow: '#927043',
    artShadow: '#7A5A1F',
  },
  {
    id: 'light',
    label: 'Светлая',
    background: solid('#EBEEF2'),
    text: '#2A2B2E',
    sub: '#5D6168',
    badge: { bg: '#FFFFFF', fg: '#000000' },
    accent: { bg: '#52AE30', fg: '#FFFFFF' },
    stat: { bg: '#FFFFFF', fg: '#2F7D1A' },
    glow: '#A3D890',
    cardShadow: 'rgba(42,43,46,0.25)',
    pillShadow: 'rgba(42,43,46,0.2)',
    artShadow: 'rgba(42,43,46,0.25)',
  },
];

export const themeById = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0];

/** CSS for a swatch of the theme's background. */
export function backgroundCss(bg: Background) {
  if (bg.type === 'solid') return bg.color;
  const stops = bg.stops.map((s) => `${s.color} ${(s.position * 100).toFixed(1)}%`).join(', ');
  return `linear-gradient(${bg.angle}deg, ${stops})`;
}

/** Recolours every role of the document with the theme. Geometry and copy stay. */
export function applyTheme(doc: BannerDoc, theme: Theme) {
  doc.theme = theme.id;
  doc.background = structuredClone(theme.background);
  for (const l of doc.layers) {
    switch (l.kind) {
      case 'text':
        l.color = theme.text;
        if (l.sub) l.sub.color = theme.sub;
        break;
      case 'badge':
        l.background = theme.badge.bg;
        l.foreground = theme.badge.fg;
        break;
      case 'badgeRow':
        l.items.forEach((it, i) => {
          const c = i === 0 ? theme.badge : theme.accent;
          it.background = c.bg;
          it.foreground = c.fg;
        });
        break;
      case 'stat':
        l.background = theme.stat.bg;
        l.foreground = theme.stat.fg;
        break;
      case 'glow':
        l.color = theme.glow;
        break;
      case 'card':
        if (l.shadow) l.shadow.color = theme.cardShadow;
        break;
      case 'pill':
        if (l.shadow) l.shadow.color = theme.pillShadow;
        break;
      case 'image':
        if (l.shadow) l.shadow.color = theme.artShadow;
        break;
      case 'imageClip':
        break;
    }
  }
}
