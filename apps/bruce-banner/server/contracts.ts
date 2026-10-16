/** Request and response shapes of /api/ai/*, shared by the server and the browser client (types only). */

export type Lang = 'ru' | 'uz' | 'en';
export type LangText = Record<Lang, string>;

export interface SlotLimit {
  /** characters per line that fit at the slot's width, measured with the real font */
  maxChars: number;
  maxLines: number;
}

export interface CatalogLayout {
  id: string;
  label: string;
  group: string;
  /** what the layout shows, for the model */
  about: string;
  slots: Record<string, SlotLimit>;
  /** the layout's own theme and main illustration */
  theme: string;
  art?: string;
  /** the official copy of this layout: a voice example for the model, the demo answer for mocks */
  sample?: Record<string, LangText>;
}

export interface Catalog {
  layouts: CatalogLayout[];
  themes: { id: string; label: string }[];
  assets: { id: string; kind: string; about: string }[];
}

export interface BriefRequest {
  brief: string;
  catalog: Catalog;
  /** layout ids of variants already shown, to get different ones on "Ещё варианты" */
  avoid?: string[];
}

export interface Variant {
  layout: string;
  theme: string;
  copy: Record<string, LangText>;
  /** a library asset id for the main illustration */
  art: string;
  /** the illustration to draw when the library has nothing close (Russian, one phrase the person can edit) */
  generate?: string;
  /** why this variant, one Russian sentence for the person choosing */
  why: string;
}

export interface BriefResponse {
  variants: Variant[];
  mock: boolean;
  model: string;
}

export type TextOp = 'shorter' | 'rephrase' | 'translate' | 'fix';

export interface TextRequest {
  op: TextOp;
  slot: string;
  texts: LangText;
  /** the language to work from */
  from: Lang;
  /** languages to write (translate) or rewrite */
  to: Lang[];
  context?: { title?: string; brief?: string };
  limits?: SlotLimit;
}

export interface TextResponse {
  texts: Partial<LangText>;
  note?: string;
  mock: boolean;
  model: string;
}

export interface IllustrationRequest {
  /** what to draw, any language */
  subject: string;
  /** the banner's theme id, to tune the palette */
  theme?: string;
}

export interface IllustrationResponse {
  /** base64 PNG on a flat magenta background, keyed out in the browser */
  image: string;
  mime: string;
  prompt: string;
  mock: boolean;
  model: string;
}

export interface StatusResponse {
  live: boolean;
  mock: boolean;
  textModel: string;
  imageModel: string;
  needsCode: boolean;
}

export interface ApiError {
  error: 'bad_request' | 'unauthorized' | 'forbidden_origin' | 'rate_limited' | 'timeout' | 'blocked' | 'upstream' | 'upstream_auth' | 'internal' | 'not_found';
  message: string;
  retryAfter?: number;
}

/** Header carrying the team access code when BANNER_ACCESS_CODES is set. */
export const ACCESS_HEADER = 'x-banner-code';
