import { createServer } from 'node:http';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import connect from 'connect';
import sirv from 'sirv';
import WebSocket from 'ws';
import { localProviderPlugins } from '../providers/local.js';

const applicationRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Only the two intentionally public browser credentials cross this boundary. */
export function browserConfiguration(env = process.env) {
  return {
    googleApiKey: env.GOOGLE_MAPS_API_KEY || '',
    cesiumToken: env.CESIUM_ION_TOKEN || '',
    realtimeDebugLogging: false,
  };
}

export function configurationScript(env = process.env) {
  const json = JSON.stringify(browserConfiguration(env)).replace(
    /[<>&\u2028\u2029]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return `globalThis.__GEV_CONFIG__ = Object.freeze(${json});\n`;
}

/** The same provider handlers as development, without Vite or credential writes. */
export async function createProductionServer({
  staticRoot = path.join(applicationRoot, 'dist'),
  env = process.env,
  plugins = localProviderPlugins({
    includeKeySetup: false,
    includeRealtimeDebugLog: false,
    WebSocketImpl: WebSocket,
  }),
} = {}) {
  await access(path.join(staticRoot, 'index.html'));
  const app = connect();
  const server = createServer(app);
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 1000;
  const config = configurationScript(env);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    const pathname = req.url.split('?', 1)[0];
    if (pathname === '/healthz' || pathname === '/runtime-config.js') {
      res.setHeader('Cache-Control', 'no-store');
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        return res.end();
      }
      const health = pathname === '/healthz';
      res.setHeader(
        'Content-Type',
        health ? 'application/json' : 'text/javascript; charset=utf-8',
      );
      return res.end(
        req.method === 'HEAD'
          ? undefined
          : health
            ? '{"status":"ok"}\n'
            : config,
      );
    }
    // Never expose development or credential-management routes in deployment.
    if (/^\/api\/setup(?:\/|$)/.test(pathname)) {
      res.writeHead(404, { 'Cache-Control': 'no-store' });
      return res.end();
    }
    next();
  });

  const middlewareHost = {
    httpServer: server,
    middlewares: {
      use(route, handler) {
        if (typeof route === 'function') [route, handler] = ['/', route];
        // Connect catches synchronous throws; explicitly handle async rejections.
        app.use(route, (req, res, next) =>
          Promise.resolve(handler(req, res, next)).catch(next),
        );
      },
    },
  };
  for (const plugin of plugins) {
    if (plugin.configureServer) await plugin.configureServer(middlewareHost);
  }
  app.use('/api', (_req, res) => {
    res.writeHead(404, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end('{"error":"Not found"}\n');
  });
  // No SPA fallback: unknown paths must not accidentally expose a document or API.
  const serve = sirv(staticRoot, {
    dev: false,
    dotfiles: false,
    etag: true,
    gzip: true,
    brotli: true,
    setHeaders(res, pathname) {
      res.setHeader(
        'Cache-Control',
        /\/assets\/[^/]+-[\w-]{8,}\.[\w.]+$/.test(pathname)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      );
    },
  });
  app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end();
    }
    serve(req, res, next);
  });
  app.use((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  app.use((error, _req, res, _next) => {
    // Provider exceptions can contain credentials or upstream URLs.
    console.error('[HTTP] Request failed:', error?.code || 'internal error');
    if (res.headersSent) return res.destroy();
    res.writeHead(500, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end('{"error":"Internal server error"}\n');
  });
  return server;
}

/** Bound draining even when an upstream request or keep-alive socket stalls. */
export function installShutdown(server, { timeoutMs = 10_000 } = {}) {
  let shuttingDown = false;
  const stop = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const deadline = setTimeout(() => {
      server.closeAllConnections();
      process.exit(0);
    }, timeoutMs);
    deadline.unref();
    server.close(() => process.exit(0));
    server.closeIdleConnections();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
