/**
 * Banner document model. Everything is in design pixels of the 328×106 slot; the renderer scales.
 * Copy lives in `doc.copy` by slot so a layout switch keeps the texts and AI output maps 1:1.
 * Images are referenced by id: a library asset (`money-loan`) or a stored blob (`blob:<sha256>`).
 */

export type Lang = 'ru' | 'uz' | 'en';
export const LANGS: readonly Lang[] = ['ru', 'uz', 'en'];
export const LANG_LABEL: Record<Lang, string> = { ru: 'RU', uz: 'UZ', en: 'EN' };

/** Where a piece of copy came from: drives the "переведено AI — проверьте" chip and the number check. */
export type CopySource = 'template' | 'user' | 'ai';

export interface Slot {
  ru: string;
  uz: string;
  en: string;
  src: Partial<Record<Lang, CopySource>>;
}

/** title, sub, badge, badge1, badge2, stat, statUnit, or `t-<layerId>` for texts added by hand */
export type SlotKey = string;

export type FontFamily = 'body' | 'head';

export interface Shadow {
  blur: number;
  color: string;
  offsetY: number;
}

export interface GradientStop {
  color: string;
  position: number;
}

export type Background = { type: 'solid'; color: string } | { type: 'linear'; angle: number; stops: GradientStop[] };

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayerBase {
  id: string;
  /** name in the layers list; falls back to the kind's label */
  name?: string;
  hidden?: boolean;
}

export interface GlowLayer extends LayerBase {
  kind: 'glow';
  cx: number;
  cy: number;
  r: number;
  blur: number;
  color: string;
  opacity: number;
}

export interface ImageLayer extends LayerBase {
  kind: 'image';
  src: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
  flip?: boolean;
  shadow?: Shadow;
}

/** An image drawn inside a fixed clip box (the big "0%"). */
export interface ImageClipLayer extends LayerBase {
  kind: 'imageClip';
  src: string;
  box: Box;
  img: Box;
}

export interface CardLayer extends LayerBase {
  kind: 'card';
  src: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
  radius: number;
  border: number;
  shadow?: Shadow;
}

/** White round pill with a payment-system logo clipped inside. */
export interface PillLayer extends LayerBase {
  kind: 'pill';
  icon: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  radius: number;
  iconBox: { width: number; height: number };
  iconDraw: Box;
  iconRot: number;
  shadow?: Shadow;
}

interface TextStyle {
  font: FontFamily;
  size: number;
  weight: number;
  lineHeight: number;
}

export interface BadgeLayer extends LayerBase, TextStyle {
  kind: 'badge';
  contentKey: SlotKey;
  cx: number;
  cy: number;
  rot: number;
  paddingX: number;
  paddingY: number;
  radius: number;
  background: string;
  foreground: string;
  halo?: Shadow;
}

/** Badges in a row under a text layer (Oddiy). Its y follows that text, per language. */
export interface BadgeRowLayer extends LayerBase, TextStyle {
  kind: 'badgeRow';
  x: number;
  gap: number;
  /** the text layer it sits under; undefined = the first text layer */
  after?: string;
  /** distance below that text's last line */
  offset: number;
  paddingX: number;
  paddingY: number;
  radius: number;
  items: { contentKey: SlotKey; background: string; foreground: string }[];
}

export interface TextLayer extends LayerBase, TextStyle {
  kind: 'text';
  contentKey: SlotKey;
  x: number;
  y: number;
  w: number;
  tracking: number;
  vAlign: 'top' | 'middle';
  color: string;
  /** auto-fit: more lines than this shrink the font, down to minSize */
  maxLines: number;
  minSize: number;
  sub?: TextStyle & { contentKey: SlotKey; gap: number; color: string };
}

/** The big rate in a white circle (Курс рубля). */
export interface StatLayer extends LayerBase {
  kind: 'stat';
  contentKey: SlotKey;
  unitContentKey: SlotKey;
  font: FontFamily;
  cx: number;
  cy: number;
  rot: number;
  size: number;
  unitSize: number;
  gap: number;
  paddingX: number;
  paddingY: number;
  background: string;
  foreground: string;
  halo?: Shadow;
}

export type Layer = GlowLayer | ImageLayer | ImageClipLayer | CardLayer | PillLayer | BadgeLayer | BadgeRowLayer | TextLayer | StatLayer;
export type LayerKind = Layer['kind'];

export interface BannerDoc {
  v: 1;
  id: string;
  name: string;
  format: { w: number; h: number };
  /** the template the layout came from ('blank' for none) */
  template: string;
  theme: string;
  background: Background;
  languages: { enabled: Lang[]; primary: Lang };
  copy: Record<SlotKey, Slot>;
  /** bottom first */
  layers: Layer[];
  /** the brief the AI worked from, for the number check */
  brief?: string;
  createdAt: number;
  updatedAt: number;
}

export const FORMAT = { w: 328, h: 106 } as const;
