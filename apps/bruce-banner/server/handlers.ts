/**
 * The four AI endpoints as plain `(Request, env) => Response` functions: the Vercel adapters in
 * api/, the Vite dev middleware and the unit tests all call these.
 */
import { readFile } from 'node:fs/promises';
import type { BriefResponse, IllustrationResponse, StatusResponse, TextResponse } from './contracts.js';
import type { ServerEnv } from './env.js';
import { generateImage, generateJson } from './gemini.js';
import { guard } from './guard.js';
import { HttpError, json, readJson, toResponse } from './http.js';
import { mockBrief, mockIllustration, mockText } from './mock.js';
import { briefPrompt, briefSystem, imagePrompt, textPrompt, textSystem } from './prompts.js';
import { briefSchema, cleanTexts, cleanVariants, parseBrief, parseIllustration, parseText, textSchema } from './schema.js';

export function handleStatus(_req: Request, env: ServerEnv) {
  const body: StatusResponse = { live: !env.mock, mock: env.mock, textModel: env.textModel, imageModel: env.imageModel, needsCode: env.accessCodes.length > 0 };
  return json(body);
}

export async function handleBrief(req: Request, env: ServerEnv) {
  try {
    guard(req, env, 'text');
    const body = parseBrief(await readJson(req));
    if (env.mock) return json(mockBrief(body) satisfies BriefResponse);
    const raw = await generateJson<unknown>({ env, system: briefSystem(body.catalog), prompt: briefPrompt(body.brief, body.avoid), schema: briefSchema(body.catalog), signal: req.signal });
    const variants = cleanVariants(raw, body.catalog);
    if (!variants.length) throw new HttpError(502, 'upstream', 'Модель не предложила ни одного варианта');
    return json({ variants, mock: false, model: env.textModel } satisfies BriefResponse);
  } catch (e) {
    return toResponse(e);
  }
}

export async function handleText(req: Request, env: ServerEnv) {
  try {
    guard(req, env, 'text');
    const body = parseText(await readJson(req));
    if (env.mock) return json(mockText(body) satisfies TextResponse);
    const raw = await generateJson<unknown>({
      env,
      system: textSystem(),
      prompt: textPrompt(body.op, body.slot, body.texts, body.from, body.to, body.limits, body.context),
      schema: textSchema(body.to),
      signal: req.signal,
    });
    return json({ ...cleanTexts(raw, body.to), mock: false, model: env.textModel } satisfies TextResponse);
  } catch (e) {
    return toResponse(e);
  }
}

const REF_FILES = ['money-loan.png', 'deposit-time.png', 'mortgage.png'];
let refsCache: { mime: string; data: string }[] | null = null;

/** Brand illustrations as style references (512px copies in server/refs, see scripts/gen-style-refs.mjs). */
async function styleRefs() {
  if (refsCache) return refsCache;
  const out: { mime: string; data: string }[] = [];
  for (const f of REF_FILES) {
    try {
      out.push({ mime: 'image/png', data: (await readFile(new URL(`./refs/${f}`, import.meta.url))).toString('base64') });
    } catch {
      /* refs are vendored files; without them the style lives in the prompt alone */
    }
  }
  refsCache = out;
  return out;
}

export async function handleIllustration(req: Request, env: ServerEnv) {
  try {
    guard(req, env, 'image');
    const body = parseIllustration(await readJson(req, 8 * 1024));
    if (env.mock) return json(mockIllustration(body) satisfies IllustrationResponse);
    const refs = env.styleRefs ? await styleRefs() : [];
    const prompt = imagePrompt(body.subject, body.theme, refs.length > 0);
    const img = await generateImage({ env, prompt, refs, signal: req.signal });
    if (!/png|webp/.test(img.mime)) throw new HttpError(502, 'upstream', 'Модель вернула JPEG: края не вырезать чисто, попробуйте ещё раз');
    return json({ image: img.data, mime: img.mime, prompt, mock: false, model: env.imageModel } satisfies IllustrationResponse);
  } catch (e) {
    return toResponse(e);
  }
}
