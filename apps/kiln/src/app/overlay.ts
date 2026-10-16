import type { Editor } from './editor';
import type { SceneRuntime } from '../doc/runtime';
import type { Viewport } from './viewport';
import { screenRect, type Rect } from './bounds';

const NS = 'http://www.w3.org/2000/svg';
export type Corner = 'nw' | 'ne' | 'se' | 'sw';
/** gap between an object and its selection box, px */
const PAD = 8;
/** stem from the box to the tilt knob, px */
const STEM = 26;

function el<K extends keyof SVGElementTagNameMap>(tag: K, cls: string, parent: Element, attrs: Record<string, string | number> = {}) {
  const e = document.createElementNS(NS, tag);
  e.setAttribute('class', cls);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
}

function setRect(r: SVGRectElement, x: number, y: number, w: number, h: number, rx: number) {
  r.setAttribute('x', x.toFixed(1));
  r.setAttribute('y', y.toFixed(1));
  r.setAttribute('width', Math.max(0, w).toFixed(1));
  r.setAttribute('height', Math.max(0, h).toFixed(1));
  r.setAttribute('rx', rx.toFixed(1));
}

const pad = (r: Rect, p: number): Rect => ({ x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p });
const radius = (r: Rect) => Math.min(14, r.w / 4, r.h / 4);

/**
 * Selection chrome drawn over the canvas: a rounded box around the projected bounds, corner
 * handles to scale, a knob on a stem to tilt; a thin outline on hover; a dashed box around the
 * group being edited. Redrawn every frame from the runtime, so it follows drags and camera glides.
 */
export class Overlay {
  hover: string | null = null;
  /** the running gesture: handles hide while moving */
  mode: 'move' | 'scale' | 'tilt' | null = null;
  /** value shown next to the box while scaling or tilting */
  readout = '';
  /** the selection's box as last drawn, without padding (client px) */
  selRect: Rect | null = null;
  onHandle: (e: PointerEvent, kind: 'scale' | 'tilt', corner?: Corner) => void = () => {};

  private hoverRect: SVGRectElement;
  private contextRect: SVGRectElement;
  private items: SVGGElement;
  private sel: SVGGElement;
  private box: SVGRectElement;
  private stem: SVGLineElement;
  private knob: SVGCircleElement;
  private knobHit: SVGCircleElement;
  private handles: { corner: Corner; dot: SVGRectElement; hit: SVGRectElement }[] = [];
  private readoutG: SVGGElement;
  private readoutBg: SVGRectElement;
  private readoutText: SVGTextElement;
  private key = '';

  constructor(
    svg: SVGSVGElement,
    private editor: Editor,
    private runtime: SceneRuntime,
    private view: Viewport,
  ) {
    this.contextRect = el('rect', 'ov-context', svg);
    this.hoverRect = el('rect', 'ov-hover', svg);
    this.items = el('g', 'ov-items', svg);
    this.sel = el('g', 'ov-sel', svg);
    this.box = el('rect', 'ov-box', this.sel);
    this.stem = el('line', 'ov-stem', this.sel);
    this.knob = el('circle', 'ov-knob', this.sel, { r: 6 });
    this.knobHit = el('circle', 'ov-hit ov-hit-tilt', this.sel, { r: 15 });
    for (const corner of ['nw', 'ne', 'se', 'sw'] as Corner[]) {
      const dot = el('rect', 'ov-handle', this.sel, { width: 10, height: 10, rx: 3 });
      const hit = el('rect', `ov-hit ov-hit-${corner}`, this.sel, { width: 26, height: 26 });
      hit.addEventListener('pointerdown', (e) => this.onHandle(e, 'scale', corner));
      this.handles.push({ corner, dot, hit });
    }
    this.knobHit.addEventListener('pointerdown', (e) => this.onHandle(e, 'tilt'));
    this.readoutG = el('g', 'ov-readout', svg);
    this.readoutBg = el('rect', 'ov-readout-bg', this.readoutG, { rx: 8, height: 22 });
    this.readoutText = el('text', 'ov-readout-text', this.readoutG);
  }

  /** Union box of objects or groups on screen. */
  rectOf(ids: string[]) {
    return screenRect(this.runtime, this.view, ids);
  }

  update() {
    const { editor } = this;
    const sel = editor.selection;
    const selRect = sel.length ? this.rectOf(sel) : null;
    const itemRects = sel.length > 1 ? sel.map((id) => this.rectOf([id])).filter((r): r is Rect => !!r) : [];
    const hover = this.hover && !sel.includes(this.hover) && !this.mode ? this.rectOf([this.hover]) : null;
    const context = editor.entered ? this.rectOf([editor.entered]) : null;
    this.selRect = selRect;
    const r1 = (r: Rect | null) => (r ? [r.x, r.y, r.w, r.h].map((v) => Math.round(v * 2)) : null);
    const key = JSON.stringify([r1(selRect), itemRects.map(r1), r1(hover), r1(context), this.mode, this.readout]);
    if (key === this.key) return;
    this.key = key;

    if (hover) {
      const p = pad(hover, PAD - 2);
      setRect(this.hoverRect, p.x, p.y, p.w, p.h, radius(p));
      this.hoverRect.style.display = '';
    } else this.hoverRect.style.display = 'none';

    if (context) {
      const p = pad(context, PAD + 6);
      setRect(this.contextRect, p.x, p.y, p.w, p.h, radius(p));
      this.contextRect.style.display = '';
    } else this.contextRect.style.display = 'none';

    while (this.items.childElementCount < itemRects.length) el('rect', 'ov-item', this.items);
    Array.from(this.items.children).forEach((c, i) => {
      const r = itemRects[i];
      const rect = c as SVGRectElement;
      if (!r) {
        rect.style.display = 'none';
        return;
      }
      const p = pad(r, PAD - 3);
      setRect(rect, p.x, p.y, p.w, p.h, radius(p));
      rect.style.display = '';
    });

    if (!selRect) {
      this.sel.style.display = 'none';
      this.readoutG.style.display = 'none';
      return;
    }
    this.sel.style.display = '';
    const b = pad(selRect, PAD);
    setRect(this.box, b.x, b.y, b.w, b.h, radius(b));
    const handlesOn = this.mode !== 'move';
    const at: Record<Corner, [number, number]> = { nw: [b.x, b.y], ne: [b.x + b.w, b.y], se: [b.x + b.w, b.y + b.h], sw: [b.x, b.y + b.h] };
    for (const h of this.handles) {
      const [x, y] = at[h.corner];
      h.dot.setAttribute('x', (x - 5).toFixed(1));
      h.dot.setAttribute('y', (y - 5).toFixed(1));
      h.hit.setAttribute('x', (x - 13).toFixed(1));
      h.hit.setAttribute('y', (y - 13).toFixed(1));
      h.dot.style.display = h.hit.style.display = handlesOn ? '' : 'none';
    }
    const kx = b.x + b.w / 2;
    const ky = b.y - STEM;
    this.stem.setAttribute('x1', kx.toFixed(1));
    this.stem.setAttribute('x2', kx.toFixed(1));
    this.stem.setAttribute('y1', b.y.toFixed(1));
    this.stem.setAttribute('y2', (ky + 6).toFixed(1));
    this.knob.setAttribute('cx', kx.toFixed(1));
    this.knob.setAttribute('cy', ky.toFixed(1));
    this.knobHit.setAttribute('cx', kx.toFixed(1));
    this.knobHit.setAttribute('cy', ky.toFixed(1));
    for (const e of [this.stem, this.knob, this.knobHit]) e.style.display = handlesOn ? '' : 'none';

    if (this.readout) {
      this.readoutText.textContent = this.readout;
      const w = this.readoutText.getComputedTextLength() + 16;
      const x = kx + 16;
      this.readoutBg.setAttribute('x', x.toFixed(1));
      this.readoutBg.setAttribute('y', (ky - 11).toFixed(1));
      this.readoutBg.setAttribute('width', w.toFixed(1));
      this.readoutText.setAttribute('x', (x + 8).toFixed(1));
      this.readoutText.setAttribute('y', (ky + 4).toFixed(1));
      this.readoutG.style.display = '';
    } else this.readoutG.style.display = 'none';
  }
}
