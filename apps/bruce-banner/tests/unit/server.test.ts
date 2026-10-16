import { describe, expect, it } from 'vitest';
import { ASSETS, TEMPLATES, THEMES } from '../../src/engine';
import type { Catalog } from '../../server/contracts';
import { readEnv } from '../../server/env';
import { extractImage, extractText } from '../../server/gemini';
import { handleBrief, handleIllustration, handleStatus, handleText } from '../../server/handlers';
import { cleanTexts, cleanVariants } from '../../server/schema';

const catalog: Catalog = {
  layouts: TEMPLATES.map((t) => {
    const art = t.layers.find((l) => l.kind === 'image' || l.kind === 'card') as { src: string } | undefined;
    return {
      id: t.id,
      label: t.label,
      group: t.group,
      about: t.label,
      theme: t.theme,
      art: art?.src,
      slots: Object.fromEntries(Object.keys(t.copy).map((k) => [k, { maxChars: 24, maxLines: 2 }])),
      sample: t.copy as Catalog['layouts'][number]['sample'],
    };
  }),
  themes: THEMES.map((t) => ({ id: t.id, label: t.label })),
  assets: ASSETS.filter((a) => a.kind !== 'logo').map((a) => ({ id: a.id, kind: a.kind, about: a.about })),
};

const mock = readEnv({ AI_MOCK: '1' });
let ip = 0;
/** A POST from a fresh client address (the rate limiter is per IP). */
function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:5173${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'localhost:5173', origin: 'http://localhost:5173', 'x-forwarded-for': `10.0.0.${++ip}`, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('env', () => {
  it('runs on mocks without a key', () => {
    expect(readEnv({}).mock).toBe(true);
    expect(readEnv({ GEMINI_API_KEY: 'k' }).mock).toBe(false);
    expect(readEnv({ GEMINI_API_KEY: 'k', AI_MOCK: '1' }).mock).toBe(true);
    expect(readEnv({ BANNER_ACCESS_CODES: ' a, b ,' }).accessCodes).toEqual(['a', 'b']);
  });
});

describe('/api/ai/status', () => {
  it('says mock and whether a code is needed', async () => {
    const r = await handleStatus(new Request('http://localhost/api/ai/status'), { ...mock, accessCodes: ['x'] }).json();
    expect(r).toMatchObject({ mock: true, live: false, needsCode: true });
  });
});

describe('/api/ai/brief (mock)', () => {
  it('returns three variants on the brief topic, inside the catalog', async () => {
    const res = await handleBrief(post('/api/ai/brief', { brief: 'Кредит до 100 млн сум за 2 минуты', catalog }), mock);
    expect(res.status).toBe(200);
    const r = await res.json();
    expect(r.mock).toBe(true);
    expect(r.variants).toHaveLength(3);
    for (const v of r.variants) {
      expect(['loan', 'emptyloan']).toContain(v.layout);
      expect(catalog.themes.map((t) => t.id)).toContain(v.theme);
      expect(v.copy.title.ru.length).toBeGreaterThan(0);
    }
    // no two variants are the same layout in the same theme
    expect(new Set(r.variants.map((v: { layout: string; theme: string }) => `${v.layout}:${v.theme}`)).size).toBe(3);
  });

  it('«Ещё варианты» on the same topic changes themes, not the subject', async () => {
    const r = await (await handleBrief(post('/api/ai/brief', { brief: 'Кредит наличными', catalog, avoid: ['loan', 'emptyloan'] }), mock)).json();
    for (const v of r.variants) expect(['loan', 'emptyloan']).toContain(v.layout);
  });

  it('rejects bad requests in words', async () => {
    const short = await handleBrief(post('/api/ai/brief', { brief: 'ой', catalog }), mock);
    expect(short.status).toBe(400);
    expect((await short.json()).message).toMatch(/подробнее/);
    expect((await handleBrief(post('/api/ai/brief', '{nope'), mock)).status).toBe(400);
    expect((await handleBrief(post('/api/ai/brief', { brief: 'x'.repeat(70_000), catalog }), mock)).status).toBe(413);
    expect((await handleBrief(new Request('http://localhost:5173/api/ai/brief'), mock)).status).toBe(405);
  });
});

describe('guard', () => {
  it('refuses other sites, accepts the same host and allowed origins', async () => {
    const body = { brief: 'Кредит до 100 млн', catalog };
    expect((await handleBrief(post('/api/ai/brief', body, { origin: 'https://evil.example' }), mock)).status).toBe(403);
    expect((await handleBrief(post('/api/ai/brief', body), mock)).status).toBe(200);
    const allowed = { ...mock, allowedOrigins: ['https://banners.example'] };
    expect((await handleBrief(post('/api/ai/brief', body, { origin: 'https://banners.example' }), allowed)).status).toBe(200);
  });

  it('asks for the team code when codes are set', async () => {
    const env = { ...mock, accessCodes: ['ipoteka-2026'] };
    const body = { brief: 'Кредит до 100 млн', catalog };
    const none = await handleBrief(post('/api/ai/brief', body), env);
    expect(none.status).toBe(401);
    expect((await none.json()).error).toBe('unauthorized');
    expect((await handleBrief(post('/api/ai/brief', body, { 'x-banner-code': 'wrong' }), env)).status).toBe(401);
    expect((await handleBrief(post('/api/ai/brief', body, { 'x-banner-code': 'ipoteka-2026' }), env)).status).toBe(200);
  });

  it('limits drawings per minute per address, with Retry-After', async () => {
    const at = '172.16.0.9';
    let last: Response | null = null;
    for (let i = 0; i < 9; i++) last = await handleIllustration(post('/api/ai/illustration', { subject: 'зелёная копилка' }, { 'x-forwarded-for': at }), mock);
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('/api/ai/text (mock)', () => {
  const texts = { ru: 'Кредит до 100 млн', uz: "100 mln so'mgacha kredit", en: 'Loan up to 100M' };

  it('does not pretend to translate without a model', async () => {
    const r = await (await handleText(post('/api/ai/text', { op: 'translate', slot: 'title', texts, from: 'ru', to: ['uz', 'en'] }), mock)).json();
    expect(r.texts).toEqual({ uz: texts.uz, en: texts.en });
    expect(r.note).toMatch(/Демо/);
  });

  it('fixes the Uzbek apostrophe mechanically', async () => {
    const r = await (await handleText(post('/api/ai/text', { op: 'fix', slot: 'title', texts, from: 'ru', to: ['uz'] }), mock)).json();
    expect(r.texts.uz).toBe('100 mln so‘mgacha kredit');
  });

  it('validates the operation and languages', async () => {
    expect((await handleText(post('/api/ai/text', { op: 'poem', texts, from: 'ru', to: ['uz'] }), mock)).status).toBe(400);
    expect((await handleText(post('/api/ai/text', { op: 'shorter', texts, from: 'de', to: ['uz'] }), mock)).status).toBe(400);
    expect((await handleText(post('/api/ai/text', { op: 'shorter', texts: { ru: '', uz: '', en: '' }, from: 'ru', to: ['ru'] }), mock)).status).toBe(400);
  });
});

describe('/api/ai/illustration (mock)', () => {
  it('returns a PNG on the magenta key', async () => {
    const r = await (await handleIllustration(post('/api/ai/illustration', { subject: 'зелёная копилка' }), mock)).json();
    expect(r.mime).toBe('image/png');
    expect(Buffer.from(r.image, 'base64').subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(r.prompt).toMatch(/#FF00FF/i);
  });
});

describe('model answers are kept inside the catalog', () => {
  it('cleans variants', () => {
    const out = cleanVariants(
      {
        variants: [
          { layout: 'loan', theme: 'neon', art: 'unicorn', copy: { title: { ru: 'Кредит', uz: "Kredit so'm", en: 'Loan' }, bogus: { ru: 'x', uz: 'x', en: 'x' } }, why: 'w' },
          { layout: 'nope', theme: 'night', art: 'money-loan', copy: { title: { ru: 'А', uz: 'B', en: 'C' } } },
          { layout: 'zero', copy: { badge: { ru: 'нет заголовка', uz: '', en: '' } } },
          { layout: 'zero', copy: { title: { ru: '4', uz: '4', en: '4' } } },
          { layout: 'zero', copy: { title: { ru: '5', uz: '5', en: '5' } } },
        ],
      },
      catalog,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ layout: 'loan', theme: 'emerald', art: 'money-loan' });
    expect(out[0].copy.title.uz).toBe('Kredit so‘m');
    expect(out[0].copy).not.toHaveProperty('bogus');
    expect(out[1].layout).toBe(catalog.layouts[0].id);
    expect(out[1].theme).toBe('night');
  });

  it('cleans texts', () => {
    expect(cleanTexts({ texts: { uz: "  so'm  ", en: 'x', de: 'nein' }, note: '' }, ['uz'])).toEqual({ texts: { uz: 'so‘m' } });
  });
});

describe('Gemini response shapes', () => {
  it('reads text from output_text, steps or candidates', () => {
    expect(extractText({ output_text: '{"a":1}' })).toBe('{"a":1}');
    expect(extractText({ steps: [{ type: 'model_output', content: [{ type: 'text', text: '{"b"' }, { type: 'text', text: ':2}' }] }] })).toBe('{"b":2}');
    expect(extractText({ candidates: [{ content: { parts: [{ text: 'c' }] } }] })).toBe('c');
    expect(extractText({})).toBeNull();
  });

  it('reads the last image', () => {
    const r = extractImage({ steps: [{ type: 'model_output', content: [{ type: 'image', data: 'AAA', mime_type: 'image/png' }, { type: 'image', data: 'BBB', mime_type: 'image/png' }] }] });
    expect(r).toEqual({ data: 'BBB', mime: 'image/png' });
    expect(extractImage({ candidates: [{ content: { parts: [{ inlineData: { data: 'CCC', mimeType: 'image/webp' } }] } }] })).toEqual({ data: 'CCC', mime: 'image/webp' });
    expect(extractImage({})).toBeNull();
  });
});
