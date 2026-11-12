/**
 * Dev-only: serves the Vercel functions in api/ under /api/* from the Vite dev server, so
 * `npm run dev` and the e2e run the same handlers production runs. A handler is a module whose
 * default export has `fetch(request: Request): Promise<Response>` (Vercel's Web signature).
 * Env comes from .env / .env.local via loadEnv; without GEMINI_API_KEY the handlers answer from mocks.
 */
import { loadEnv, type Plugin, type ViteDevServer } from 'vite';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebStream } from 'node:stream/web';

interface FetchModule {
  default?: { fetch?: (req: Request) => Promise<Response> | Response };
}

export function devApi(): Plugin {
  return {
    name: 'bruce-banner:dev-api',
    apply: 'serve',
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.root, '');
      for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

      // the team library in memory, for the e2e: VITE_LIBRARY_URL=/api/library, code LIBRARY_MOCK_CODE
      if (process.env.VITE_LIBRARY_URL === '/api/library') server.middlewares.use(libraryMock(server));

      server.middlewares.use(async (req, res, next) => {
        // connect strips mount paths from req.url; route on the original
        const url = req.originalUrl ?? req.url ?? '';
        const m = /^\/api\/([a-z0-9_/-]+?)\/?(?:\?.*)?$/i.exec(url);
        if (!m) return next();
        let mod: FetchModule;
        try {
          mod = (await server.ssrLoadModule(`/api/${m[1]}.ts`)) as FetchModule;
        } catch {
          res.statusCode = 404;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'not_found' }));
          return;
        }
        const handler = mod.default?.fetch;
        if (typeof handler !== 'function') {
          res.statusCode = 404;
          res.end();
          return;
        }
        // a client that hangs up cancels the upstream call too
        const ac = new AbortController();
        res.on('close', () => {
          if (!res.writableEnded) ac.abort();
        });
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
          else if (typeof v === 'string') headers.set(k, v);
        }
        const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && chunks.length > 0;
        const request = new Request(`http://${req.headers.host ?? 'localhost'}${url}`, {
          method: req.method,
          headers,
          body: hasBody ? Buffer.concat(chunks) : undefined,
          signal: ac.signal,
        });
        try {
          const response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          if (!response.body) {
            res.end();
            return;
          }
          Readable.fromWeb(response.body as unknown as NodeWebStream).pipe(res);
        } catch (e) {
          if (ac.signal.aborted) return;
          server.config.logger.error(`[dev-api] ${url}: ${(e as Error).message}`);
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'internal' }));
        }
      });
    },
  };
}

interface MockModule {
  MemoryStore: new (base: string) => {
    codes: Set<string>;
    files: Map<string, { bytes: Uint8Array; type: string }>;
  };
}
interface HandlerModule {
  handle(req: Request, store: unknown): Promise<Response>;
  sha256Hex(text: string): Promise<string>;
}

/** Serves supabase/functions/library with a memory store at /api/library, files at /api/library-file. */
function libraryMock(server: ViteDevServer) {
  let ready: Promise<{ store: InstanceType<MockModule['MemoryStore']>; handler: HandlerModule }> | null = null;
  const load = () =>
    (ready ??= (async () => {
      const { MemoryStore } = (await server.ssrLoadModule('/supabase/functions/library/memory.ts')) as MockModule;
      const handler = (await server.ssrLoadModule('/supabase/functions/library/handler.ts')) as HandlerModule;
      const store = new MemoryStore('/api/library-file');
      store.codes.add(await handler.sha256Hex(process.env.LIBRARY_MOCK_CODE ?? 'team-code'));
      return { store, handler };
    })());
  return async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => {
    const url = (req as { originalUrl?: string }).originalUrl ?? req.url ?? '';
    const file = /^\/api\/library-file\/(banner-images|banner-thumbs)\/([\w.-]+)/.exec(url);
    if (!file && !/^\/api\/library\/?(\?.*)?$/.test(url)) return next();
    const { store, handler } = await load();
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    if (file) {
      const key = `${file[1]}/${file[2]}`;
      if (req.method === 'PUT') {
        store.files.set(key, { bytes: new Uint8Array(Buffer.concat(chunks)), type: String(req.headers['content-type'] ?? 'image/png') });
        res.statusCode = 200;
        res.end('{}');
        return;
      }
      const f = store.files.get(key);
      res.statusCode = f ? 200 : 404;
      if (f) res.setHeader('content-type', f.type);
      res.end(f ? Buffer.from(f.bytes) : undefined);
      return;
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const response = await handler.handle(new Request(`http://${req.headers.host}${url}`, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined }), store);
    res.statusCode = response.status;
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await response.arrayBuffer()));
  };
}
