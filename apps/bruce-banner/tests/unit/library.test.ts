import { beforeEach, describe, expect, it } from 'vitest';
import { docRefs, handle, sha256Hex } from '../../supabase/functions/library/handler';
import { MemoryStore } from '../../supabase/functions/library/memory';

const CODE = 'green-banner-42';
let store: MemoryStore;

function call(body: unknown, opts: { code?: string; name?: string; method?: string } = {}) {
  return handle(
    new Request('https://lib.test/functions/v1/library', {
      method: opts.method ?? 'POST',
      headers: { 'content-type': 'application/json', 'x-team-code': opts.code ?? CODE, 'x-team-name': encodeURIComponent(opts.name ?? 'Дилноза') },
      body: opts.method === 'OPTIONS' ? undefined : JSON.stringify(body),
    }),
    store,
  );
}

const doc = (id: string, name = 'Кредит до 100 млн', extra: object = {}) => ({ id, name, template: 'loan', theme: 'emerald', layers: [], ...extra });
const REF = `blob:${'a'.repeat(64)}`;

beforeEach(async () => {
  store = new MemoryStore('http://files.test');
  store.codes.add(await sha256Hex(CODE));
});

describe('library: access', () => {
  it('answers the browser preflight without a code', async () => {
    const r = await call(null, { method: 'OPTIONS', code: '' });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-headers')).toMatch(/x-team-code/);
  });

  it('needs the team code, and only its hash is stored', async () => {
    expect((await call({ op: 'list' }, { code: '' })).status).toBe(401);
    expect((await call({ op: 'list' }, { code: 'wrong' })).status).toBe(401);
    expect([...store.codes][0]).not.toContain(CODE);
    expect(await (await call({ op: 'hello' })).json()).toEqual({ ok: true, name: 'Дилноза' });
  });
});

describe('library: banners', () => {
  it('saves, lists newest first with who changed it, and opens', async () => {
    expect((await call({ op: 'save', doc: doc('b1'), baseVersion: null })).status).toBe(200);
    await call({ op: 'save', doc: doc('b2', 'Вклад'), baseVersion: null }, { name: 'Азиз' });
    const { banners } = await (await call({ op: 'list' })).json();
    expect(banners.map((b: { id: string }) => b.id)).toEqual(['b2', 'b1']);
    expect(banners[0]).toMatchObject({ name: 'Вклад', status: 'draft', version: 1, created_by: 'Азиз', updated_by: 'Азиз' });
    const got = await (await call({ op: 'get', id: 'b1' })).json();
    expect(got.banner.doc.name).toBe('Кредит до 100 млн');
  });

  it('a save from an old version gets 409 with who saved in between', async () => {
    await call({ op: 'save', doc: doc('b1'), baseVersion: null });
    await call({ op: 'save', doc: doc('b1', 'Правка Азиза'), baseVersion: 1 }, { name: 'Азиз' });
    const stale = await call({ op: 'save', doc: doc('b1', 'Моя правка'), baseVersion: 1 });
    expect(stale.status).toBe(409);
    const body = await stale.json();
    expect(body.message).toMatch(/Азиз уже изменил/);
    expect(body.current.version).toBe(2);
    expect((await call({ op: 'save', doc: doc('b1', 'Моя правка'), baseVersion: 2 })).status).toBe(200);
  });

  it('a status change does not invalidate an open editor', async () => {
    await call({ op: 'save', doc: doc('b1'), baseVersion: null });
    const st = await (await call({ op: 'status', id: 'b1', status: 'review' }, { name: 'Азиз' })).json();
    expect(st.banner).toMatchObject({ status: 'review', updated_by: 'Азиз', version: 1 });
    expect((await call({ op: 'save', doc: doc('b1'), baseVersion: 1 })).status).toBe(200);
    expect((await call({ op: 'status', id: 'b1', status: 'published' })).status).toBe(400);
  });

  it('deletes for everyone; saving the same id again brings it back as a draft', async () => {
    await call({ op: 'save', doc: doc('b1'), baseVersion: null });
    await call({ op: 'status', id: 'b1', status: 'approved' });
    expect(await (await call({ op: 'delete', id: 'b1' })).json()).toEqual({ ok: true });
    expect((await (await call({ op: 'list' })).json()).banners).toHaveLength(0);
    expect((await call({ op: 'get', id: 'b1' })).status).toBe(404);
    const back = await (await call({ op: 'save', doc: doc('b1'), baseVersion: null })).json();
    expect(back.banner.status).toBe('draft');
  });

  it('rejects bad input in words', async () => {
    expect((await call({ op: 'save', doc: { id: '../x', name: 'a' } })).status).toBe(400);
    expect((await call({ op: 'save', doc: doc('b1', 'x', { big: 'x'.repeat(1_000_001) }) })).status).toBe(413);
    expect((await call({ op: 'nope' })).status).toBe(400);
  });
});

describe('library: pictures', () => {
  it('asks only for pictures the library does not have, and signs the ones a banner draws', async () => {
    const prep = await (await call({ op: 'images.prepare', items: [{ ref: REF }, { ref: 'blob:nothex' }] })).json();
    expect(Object.keys(prep.upload)).toEqual([REF]);
    store.files.set(`banner-images/${'a'.repeat(64)}`, { bytes: new Uint8Array([1]), type: 'image/png' });
    await call({ op: 'images.commit', items: [{ ref: REF, w: 10, h: 10, source: 'ai', subject: 'планшет' }] });
    expect((await (await call({ op: 'images.prepare', items: [{ ref: REF }] })).json()).upload).toEqual({});
    await call({ op: 'save', doc: doc('b1', 'x', { layers: [{ kind: 'image', src: REF }] }), baseVersion: null });
    const got = await (await call({ op: 'get', id: 'b1' })).json();
    expect(got.images[REF]).toBe(`http://files.test/banner-images/${'a'.repeat(64)}`);
  });

  it('stores the card picture and lists it signed', async () => {
    await call({ op: 'save', doc: doc('b1'), baseVersion: null, thumb: btoa('webp'), thumbType: 'image/webp' });
    const { banners } = await (await call({ op: 'list' })).json();
    expect(banners[0].thumbUrl).toBe('http://files.test/banner-thumbs/b1.webp');
  });

  it('finds every picture ref in a document once', () => {
    expect(docRefs({ a: REF, b: [REF, 'blob:short', 'money-loan'] })).toEqual([REF]);
  });
});
