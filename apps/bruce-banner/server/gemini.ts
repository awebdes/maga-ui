/**
 * Gemini over the Interactions API (POST /v1beta/interactions), verified with a live key on
 * 2026-10-17: body { model, input, system_instruction, store, response_format, generation_config };
 * the answer is `steps[]`: a `thought` step, then `model_output` with `{ type: 'text', text }` or
 * `{ type: 'image', mime_type: 'image/jpeg', data }` blocks. Image output is JPEG only (the API's
 * ImageResponseFormat allows nothing else); the browser keys the magenta out of it.
 * Text models think by default (~3k thought tokens for a three-word answer, 24 s): thinking_level
 * keeps that in check. Every call sends store:false: briefs carry unreleased rates. The parsers also
 * accept the older shapes, so a format change shows up as a clear error instead of an empty banner.
 */
import type { ServerEnv } from './env.js';
import { HttpError } from './http.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

type Block = { type: 'text'; text: string } | { type: 'image'; mime_type: string; data: string };

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

interface CallOpts {
  env: ServerEnv;
  model: string;
  system: string;
  input: string | Block[];
  responseFormat: Record<string, unknown>;
  generationConfig?: Record<string, unknown>;
  timeoutMs: number;
  signal?: AbortSignal;
}

async function call(opts: CallOpts): Promise<unknown> {
  if (!opts.env.apiKey) throw new HttpError(503, 'upstream', 'Ключ Gemini не подключён');
  const timeout = AbortSignal.timeout(opts.timeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.env.apiKey },
      body: JSON.stringify({
        model: opts.model,
        input: opts.input,
        system_instruction: opts.system,
        store: false,
        response_format: opts.responseFormat,
        ...(opts.generationConfig ? { generation_config: opts.generationConfig } : {}),
      }),
      signal,
    });
  } catch (e) {
    if (timeout.aborted) throw new HttpError(504, 'timeout', 'Модель не ответила вовремя');
    if (opts.signal?.aborted) throw new HttpError(499 as number, 'internal', 'Отменено');
    throw new HttpError(502, 'upstream', `Нет связи с Gemini: ${(e as Error).message}`);
  }
  const body = await res.text();
  if (!res.ok) {
    const retry = Number(res.headers.get('retry-after')) || undefined;
    const msg = safeMessage(body);
    if (res.status === 429) throw new HttpError(429, 'rate_limited', 'Лимит запросов к Gemini, попробуйте чуть позже', retry);
    if (res.status === 401 || res.status === 403) throw new HttpError(502, 'upstream_auth', 'Gemini не принял ключ');
    if (res.status === 400 && /safety|blocked/i.test(msg)) throw new HttpError(422, 'blocked', 'Модель отказалась: попробуйте переформулировать');
    throw new HttpError(502, 'upstream', `Gemini: ${res.status} ${msg}`.slice(0, 300));
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(502, 'upstream', 'Gemini вернул не JSON');
  }
}

function safeMessage(body: string) {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } };
    return j.error?.message ?? body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

/** Text out of an interaction: `output_text`, or text blocks of the model's steps. */
export function extractText(r: unknown): string | null {
  const o = r as Record<string, unknown>;
  if (typeof o.output_text === 'string') return o.output_text;
  const steps = (o.steps ?? o.outputs) as unknown[] | undefined;
  if (Array.isArray(steps)) {
    const texts: string[] = [];
    for (const s of steps) {
      const st = s as Record<string, unknown>;
      if (st.type && st.type !== 'model_output' && st.type !== 'text') continue;
      if (st.type === 'text' && typeof st.text === 'string') texts.push(st.text);
      for (const c of (st.content as unknown[]) ?? []) {
        const b = c as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
      }
    }
    if (texts.length) return texts.join('');
  }
  const cand = (o.candidates as { content?: { parts?: { text?: string }[] } }[] | undefined)?.[0];
  const t = cand?.content?.parts?.map((p) => p.text ?? '').join('');
  return t || null;
}

/** The last image of an interaction, base64. */
export function extractImage(r: unknown): { data: string; mime: string } | null {
  const o = r as Record<string, unknown>;
  const out = o.output_image as { data?: string; mime_type?: string } | undefined;
  if (out?.data) return { data: out.data, mime: out.mime_type ?? 'image/png' };
  let found: { data: string; mime: string } | null = null;
  const steps = (o.steps ?? o.outputs) as unknown[] | undefined;
  if (Array.isArray(steps)) {
    for (const s of steps) {
      const st = s as Record<string, unknown>;
      if (st.type === 'image' && typeof st.data === 'string') found = { data: st.data, mime: (st.mime_type as string) ?? 'image/png' };
      for (const c of (st.content as unknown[]) ?? []) {
        const b = c as Record<string, unknown>;
        if (b.type === 'image' && typeof b.data === 'string') found = { data: b.data, mime: (b.mime_type as string) ?? 'image/png' };
      }
    }
  }
  if (found) return found;
  const parts = (o.candidates as { content?: { parts?: { inlineData?: { data: string; mimeType: string } }[] } }[] | undefined)?.[0]?.content?.parts ?? [];
  for (const p of parts) if (p.inlineData?.data) found = { data: p.inlineData.data, mime: p.inlineData.mimeType };
  return found;
}

/** Structured JSON from the text model. One retry on 429/5xx (never after a timeout). */
export async function generateJson<T>(opts: { env: ServerEnv; system: string; prompt: string; schema: Record<string, unknown>; thinking?: ThinkingLevel; timeoutMs?: number; signal?: AbortSignal }): Promise<T> {
  let thinking: ThinkingLevel | null = opts.thinking ?? 'low';
  const run = () =>
    call({
      env: opts.env,
      model: opts.env.textModel,
      system: opts.system,
      input: opts.prompt,
      responseFormat: { type: 'text', mime_type: 'application/json', schema: opts.schema },
      generationConfig: thinking ? { thinking_level: thinking } : undefined,
      timeoutMs: opts.timeoutMs ?? 30_000,
      signal: opts.signal,
    });
  let r: unknown;
  try {
    r = await run();
  } catch (e) {
    const err = e as HttpError;
    // a model set through env may not know thinking_level (or this level): ask again without it
    const thinkingRefused = err instanceof HttpError && err.code === 'upstream' && /thinking/i.test(err.message);
    const retryable = err instanceof HttpError && (err.code === 'rate_limited' || (err.code === 'upstream' && err.status >= 500));
    if (thinkingRefused) thinking = null;
    else if (!retryable || (err.retryAfter ?? 0) > 8) throw e;
    else await new Promise((res) => setTimeout(res, (err.retryAfter ?? 1.5) * 1000));
    r = await run();
  }
  const text = extractText(r);
  if (!text) throw new HttpError(502, 'upstream', 'Пустой ответ модели');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(502, 'upstream', 'Модель вернула не тот формат');
  }
}

/** One image from the image model. No retry: a slow image may still be billed. */
export async function generateImage(opts: { env: ServerEnv; prompt: string; refs?: { mime: string; data: string }[]; signal?: AbortSignal }) {
  const input: Block[] = [...(opts.refs ?? []).map((r) => ({ type: 'image' as const, mime_type: r.mime, data: r.data })), { type: 'text', text: opts.prompt }];
  const r = await call({
    env: opts.env,
    model: opts.env.imageModel,
    system: 'You render single isolated 3D illustrations for banking app banners.',
    input,
    // JPEG is the only image format the API returns
    responseFormat: { type: 'image', aspect_ratio: '1:1', image_size: '1K' },
    timeoutMs: 90_000,
    signal: opts.signal,
  });
  const img = extractImage(r);
  if (!img) throw new HttpError(502, 'upstream', 'Модель не вернула картинку');
  return img;
}
