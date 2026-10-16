/**
 * Who may spend the Gemini key: a same-origin page (or an allowed origin), with a team access
 * code when BANNER_ACCESS_CODES is set, within a per-IP rate. The limiter lives in the function's
 * memory, so it is best-effort across instances; the hard ceiling is the quota and budget alert
 * on the Google Cloud project.
 */
import { timingSafeEqual } from 'node:crypto';
import { ACCESS_HEADER } from './contracts.js';
import type { ServerEnv } from './env.js';
import { HttpError } from './http.js';

const buckets = new Map<string, { n: number; reset: number }>();

export const LIMITS = { text: { n: 40, per: 60_000 }, image: { n: 8, per: 60_000 } } as const;

function sameBytes(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkOrigin(req: Request, env: ServerEnv) {
  const origin = req.headers.get('origin');
  if (!origin) return; // same-origin GETs and server-side calls
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  let ok = false;
  try {
    const o = new URL(origin);
    ok = o.host === host || env.allowedOrigins.includes(origin);
  } catch {
    ok = false;
  }
  if (!ok) throw new HttpError(403, 'forbidden_origin', 'Запрос с чужого сайта');
}

export function checkCode(req: Request, env: ServerEnv) {
  if (!env.accessCodes.length) return;
  const code = req.headers.get(ACCESS_HEADER)?.trim() ?? '';
  if (!code || !env.accessCodes.some((c) => sameBytes(c, code))) throw new HttpError(401, 'unauthorized', 'Нужен код доступа команды');
}

export function checkRate(req: Request, kind: keyof typeof LIMITS, now = Date.now()) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
  const key = `${kind}:${ip}`;
  const lim = LIMITS[kind];
  const b = buckets.get(key);
  if (!b || b.reset <= now) {
    buckets.set(key, { n: 1, reset: now + lim.per });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
    return;
  }
  if (b.n >= lim.n) throw new HttpError(429, 'rate_limited', 'Слишком много запросов, попробуйте через минуту', (b.reset - now) / 1000);
  b.n++;
}

export function guard(req: Request, env: ServerEnv, kind: keyof typeof LIMITS) {
  checkOrigin(req, env);
  checkCode(req, env);
  checkRate(req, kind);
}
