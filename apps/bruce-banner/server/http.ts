import type { ApiError } from './contracts.js';

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function fail(status: number, error: ApiError['error'], message: string, extra: Partial<ApiError> = {}) {
  const headers: Record<string, string> = {};
  if (extra.retryAfter) headers['retry-after'] = String(Math.ceil(extra.retryAfter));
  return json({ error, message, ...extra } satisfies ApiError, status, headers);
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiError['error'],
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/** Reads a JSON body with a size cap. */
export async function readJson<T>(req: Request, maxBytes = 64 * 1024): Promise<T> {
  if (req.method !== 'POST') throw new HttpError(405, 'bad_request', 'POST only');
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'bad_request', 'Слишком большой запрос');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'bad_request', 'Ожидался JSON');
  }
}

export function toResponse(e: unknown) {
  if (e instanceof HttpError) return fail(e.status, e.code, e.message, e.retryAfter ? { retryAfter: e.retryAfter } : {});
  console.error('[ai] internal error', e);
  return fail(500, 'internal', 'Что-то пошло не так на сервере');
}
