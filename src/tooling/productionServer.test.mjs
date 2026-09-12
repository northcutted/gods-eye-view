import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { once } from 'node:events';
import {
  browserConfiguration,
  configurationScript,
  createProductionServer,
} from '../../server/standalone/http.js';
import { localProviderPlugins } from '../../server/providers/local.js';

test('runtime configuration exposes only public keys and safely serializes script text', () => {
  const env = {
    GOOGLE_MAPS_API_KEY: '</script><script>alert(1)</script>\u2028',
    CESIUM_ION_TOKEN: 'public-ion',
    GOOGLE_MAPS_SERVER_API_KEY: 'private-google',
    OPENAI_API_KEY: 'private-openai',
    AISSTREAM_API_KEY: 'private-ais',
  };
  const script = configurationScript(env);
  assert.doesNotMatch(script, /private-|<script|<\/script|\u2028/);
  const context = {};
  vm.runInNewContext(script, context);
  assert.equal(context.__GEV_CONFIG__.googleApiKey, env.GOOGLE_MAPS_API_KEY);
  assert.deepEqual(Object.keys(browserConfiguration(env)), [
    'googleApiKey',
    'cesiumToken',
  ]);
});

test('production retains every provider except the credential-writing development surface', () => {
  assert.deepEqual(
    localProviderPlugins({ includeKeySetup: false }).map(({ name }) => name),
    localProviderPlugins()
      .map(({ name }) => name)
      .filter((name) => name !== 'gev-key-setup'),
  );
});

test('standalone HTTP serves only build assets, mounts APIs correctly, and sanitizes errors', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'gev-http-'));
  await mkdir(path.join(root, 'assets'));
  await writeFile(path.join(root, 'index.html'), '<html>fixture</html>');
  await writeFile(
    path.join(root, 'assets', 'test-abc.js'),
    'console.log("fixture")',
  );
  await writeFile(path.join(root, '.env'), 'must-not-serve');
  const server = await createProductionServer({
    staticRoot: root,
    env: {
      GOOGLE_MAPS_API_KEY: 'runtime-public-key',
      OPENAI_API_KEY: 'server-secret',
    },
    plugins: [
      {
        configureServer({ middlewares }) {
          middlewares.use('/api/fixture', (req, res) => res.end(req.url));
          middlewares.use('/api/failure', async () => {
            throw new Error('secret upstream details');
          });
        },
      },
    ],
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const request = (url, options = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: server.address().port,
          path: url,
          ...options,
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () =>
            resolve({ status: res.statusCode, headers: res.headers, body }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
  const health = await request('/healthz');
  assert.equal(health.status, 200);
  assert.equal(health.headers['cache-control'], 'no-store');
  assert.equal(health.headers['x-content-type-options'], 'nosniff');
  assert.equal((await request('/healthz', { method: 'POST' })).status, 405);
  const config = await request('/runtime-config.js');
  assert.match(config.body, /runtime-public-key/);
  assert.doesNotMatch(config.body, /server-secret/);
  assert.equal(config.headers['cache-control'], 'no-store');
  const document = await request('/');
  assert.equal(document.status, 200);
  assert.equal(document.headers['cache-control'], 'no-cache');
  const asset = await request('/assets/test-abc.js');
  assert.match(asset.headers['cache-control'], /immutable/);
  assert.equal(
    (await request('/assets/test-abc.js', { method: 'HEAD' })).body,
    '',
  );
  assert.equal(
    (
      await request('/assets/test-abc.js', {
        headers: { 'If-None-Match': asset.headers.etag },
      })
    ).status,
    304,
  );
  assert.equal((await request('/api/fixture/nested?q=1')).body, '/nested?q=1');
  for (const url of [
    '/.env',
    '/%2eenv',
    '/../package.json',
    '/%2e%2e/package.json',
    '/server/standalone/index.mjs',
    '/api/missing',
    '/api/setup/status',
    '/api/setup/keys',
    '/@vite/client',
  ]) {
    assert.equal((await request(url)).status, 404, url);
  }
  assert.equal(
    (await request('/api/setup/keys', { method: 'POST' })).status,
    404,
  );
  const failure = await request('/api/failure');
  assert.equal(failure.status, 500);
  assert.doesNotMatch(failure.body, /secret upstream/);
});

test('missing production assets fail startup', async () => {
  await assert.rejects(
    createProductionServer({
      staticRoot: '/nonexistent-gev-dist',
      plugins: [],
    }),
    { code: 'ENOENT' },
  );
});
