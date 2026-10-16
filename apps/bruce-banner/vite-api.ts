/**
 * Dev-only: serves the Vercel functions in api/ under /api/* from the Vite dev server, so
 * `npm run dev` and the e2e run the same handlers production runs. A handler is a module whose
 * default export has `fetch(request: Request): Promise<Response>` (Vercel's Web signature).
 * Env comes from .env / .env.local via loadEnv; without GEMINI_API_KEY the handlers answer from mocks.
 */
import { loadEnv, type Plugin } from 'vite';
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
