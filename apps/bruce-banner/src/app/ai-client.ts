/**
 * Browser side of /api/ai/*: the catalog the model chooses from (with slot limits measured on the
 * real fonts), typed calls with abort, and errors in words a person can act on.
 */
import { ASSETS, THEMES, TEMPLATES, type Layer, type TemplateDef } from '../engine';
import { measure } from '../render/measure';
import { store } from '../ui/kit/core';
import type {
  ApiError,
  BriefRequest,
  BriefResponse,
  Catalog,
  CatalogLayout,
  IllustrationRequest,
  IllustrationResponse,
  SlotLimit,
  StatusResponse,
  TextRequest,
  TextResponse,
} from '../../server/contracts';
import { ACCESS_HEADER } from '../../server/contracts';

const ABOUT: Record<string, string> = {
  loan: 'green, two-line title, white tilted badge with a short highlight, stack of cash on the right',
  daromax: 'black with green glow, title, white tilted badge with a rate, safe with a percent sign',
  humo: 'emerald, title, Ipoteka Humo card with the Humo logo pill',
  uzcard: 'lime green, title, Ipoteka Uzcard card with the Uzcard logo pill',
  zero: 'green, three-line title, big 3D "0%" on the right',
  mcstandard: 'silver gradient, title, Mastercard Standard card with the Mastercard logo',
  mcgold: 'gold gradient, title, Mastercard Gold card with the Mastercard logo',
  cumulative: 'sky blue, title, green safe with a lock',
  emptyloan: 'light grey, dark title, white tilted badge, stack of cash',
  emptydeposit: 'light grey, dark title, safe with a percent sign',
  visaclassic: 'graphite grey, title, Visa Classic card with the Visa logo',
  visagold: 'bronze, title, Visa Gold card with the Visa logo',
  mortgage: 'green, bold vertically centred title, three green houses with percent coins',
  oddly: 'orange, title, two badges under it (a rate and a term), safe with a percent sign',
  rublerate: 'green, bold title with a smaller line under it, a big rate number in a white circle, ruble coins',
};

let catalogCache: Catalog | null = null;

/** Characters per line that fit a slot: its width over the average Russian letter at its size. */
function limitFor(width: number, family: 'body' | 'head', weight: number, size: number, maxLines: number): SlotLimit {
  const sample = 'Кредит наличными до ста миллионов на любые цели';
  const avg = measure(sample, { family, weight, size, tracking: 0 }) / sample.length;
  return { maxChars: Math.max(6, Math.floor(width / avg)), maxLines };
}

function slotsOf(t: TemplateDef): Record<string, SlotLimit> {
  const slots: Record<string, SlotLimit> = {};
  const row = t.layers.some((l) => l.kind === 'badgeRow');
  for (const l of t.layers as Layer[]) {
    if (l.kind === 'text') {
      slots[l.contentKey] = limitFor(l.w, l.font, l.weight, l.size, row ? 2 : 3);
      if (l.sub) slots[l.sub.contentKey] = limitFor(l.w, l.sub.font, l.sub.weight, l.sub.size, 1);
    } else if (l.kind === 'badge') slots[l.contentKey] = { maxChars: 16, maxLines: 1 };
    else if (l.kind === 'badgeRow') l.items.forEach((it) => (slots[it.contentKey] = { maxChars: 12, maxLines: 1 }));
    else if (l.kind === 'stat') {
      slots[l.contentKey] = { maxChars: 4, maxLines: 1 };
      slots[l.unitContentKey] = { maxChars: 5, maxLines: 1 };
    }
  }
  return slots;
}

export function buildCatalog(): Catalog {
  if (catalogCache) return catalogCache;
  const layouts: CatalogLayout[] = TEMPLATES.map((t) => {
    const art = t.layers.find((l) => l.kind === 'image' || l.kind === 'card' || l.kind === 'imageClip') as { src: string } | undefined;
    return { id: t.id, label: t.label, group: t.group, about: ABOUT[t.id] ?? t.label, theme: t.theme, art: art?.src, slots: slotsOf(t), sample: t.copy };
  });
  catalogCache = {
    layouts,
    themes: THEMES.map((t) => ({ id: t.id, label: t.label })),
    assets: ASSETS.filter((a) => a.kind !== 'logo').map((a) => ({ id: a.id, kind: a.kind, about: a.about })),
  };
  return catalogCache;
}

/** Fonts changed the measurements: rebuild limits on the next call. */
export const resetCatalog = () => (catalogCache = null);

export class AiError extends Error {
  constructor(
    readonly code: ApiError['error'] | 'offline' | 'aborted',
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export const accessCode = {
  get: () => store.get<string>('code', ''),
  set: (c: string) => store.set('code', c.trim()),
};

async function call<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(accessCode.get() ? { [ACCESS_HEADER]: accessCode.get() } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new AiError('aborted', 'Отменено');
    throw new AiError('offline', navigator.onLine ? 'Сервер не отвечает' : 'Нет интернета');
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* an HTML error page */
  }
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiError>;
    if (res.status === 404) throw new AiError('not_found', 'AI недоступен в этой сборке');
    throw new AiError(err.error ?? 'internal', err.message ?? `Ошибка ${res.status}`, err.retryAfter);
  }
  return data as T;
}

export const ai = {
  status: () => call<StatusResponse>('/api/ai/status', undefined),
  brief: (req: BriefRequest, signal?: AbortSignal) => call<BriefResponse>('/api/ai/brief', req, signal),
  text: (req: TextRequest, signal?: AbortSignal) => call<TextResponse>('/api/ai/text', req, signal),
  illustration: (req: IllustrationRequest, signal?: AbortSignal) => call<IllustrationResponse>('/api/ai/illustration', req, signal),
};
