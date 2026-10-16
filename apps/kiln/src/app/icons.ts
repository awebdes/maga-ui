import type { Kind, SceneObject } from '../doc/scene';

const NS = 'http://www.w3.org/2000/svg';

/** Inline SVG from icon text: Phosphor icons ship with the app, uploads are sanitized before they get here. */
export function svgIcon(svg: string): SVGElement | null {
  const tpl = document.createElement('template');
  tpl.innerHTML = svg.trim();
  const el = tpl.content.firstElementChild as SVGElement | null;
  el?.setAttribute('aria-hidden', 'true');
  return el;
}

/** A sprite symbol from index.html. */
export function symbolIcon(id: string, cls = 'i') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.appendChild(use);
  return svg;
}

export const KIND_ICON: Record<Kind, string> = {
  glyph: 'i-shapes',
  badge: 'i-badge',
  coin: 'i-coin',
  tile: 'i-tile',
  plate: 'i-plate',
  pill: 'i-pill',
  percent: 'i-percent',
  model: 'i-cube',
};

/** The icon for an object: its own glyph when the SVG is at hand, else the kind's symbol. */
export function objectIcon(o: SceneObject, svgOf: (ref: string) => string | null): Element {
  if ((o.kind === 'glyph' || o.kind === 'badge') && o.glyph) {
    const svg = svgOf(o.glyph.ref);
    const el = svg ? svgIcon(svg) : null;
    if (el) {
      el.classList.add('glyph-svg');
      return el;
    }
  }
  return symbolIcon(KIND_ICON[o.kind]);
}
