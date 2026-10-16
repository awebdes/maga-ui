/**
 * Server configuration from the environment (Vercel project env, or .env.local in dev via
 * vite-api.ts). Read per request so a redeploy or a dev edit takes effect without code changes.
 */
export interface ServerEnv {
  apiKey: string | null;
  textModel: string;
  imageModel: string;
  styleRefs: boolean;
  accessCodes: string[];
  allowedOrigins: string[];
  mock: boolean;
}

export function readEnv(env: Record<string, string | undefined> = process.env): ServerEnv {
  const apiKey = env.GEMINI_API_KEY?.trim() || null;
  const list = (v: string | undefined) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return {
    apiKey,
    textModel: env.GEMINI_TEXT_MODEL?.trim() || 'gemini-3.8-flash',
    imageModel: env.GEMINI_IMAGE_MODEL?.trim() || 'gemini-nano-banana-2.1',
    styleRefs: env.GEMINI_STYLE_REFS === '1',
    accessCodes: list(env.BANNER_ACCESS_CODES),
    allowedOrigins: list(env.BANNER_ALLOWED_ORIGINS),
    // no key means mocks: the whole app works before the key arrives
    mock: env.AI_MOCK === '1' || !apiKey,
  };
}
