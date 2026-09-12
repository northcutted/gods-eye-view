import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

const image = process.argv[2];
if (!image) throw new Error('Usage: node scripts/test-container.mjs IMAGE');
const engine = process.env.CONTAINER_ENGINE || 'docker';
const run = (...args) =>
  execFileSync(engine, args, {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  });
const inspected = JSON.parse(run('image', 'inspect', image))[0];
assert.equal(inspected.Config.User, '65532:65532');
assert.deepEqual(inspected.Config.Entrypoint, ['/nodejs/bin/node']);
assert.equal(
  inspected.Config.Labels['org.opencontainers.image.licenses'],
  'MIT',
);
assert.equal(
  inspected.Config.Labels['org.opencontainers.image.base.name'],
  'gcr.io/distroless/nodejs26-debian13:nonroot',
);
const volume = `gev-container-test-${randomUUID()}`;
run('volume', 'create', volume);
let id;
try {
  id = run(
    'create',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--network=none',
    '--pids-limit=128',
    '--memory=1g',
    `--volume=${volume}:/app/.gev-cache`,
    '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=16m',
    '--env=GOOGLE_MAPS_API_KEY=container-public-fixture',
    '--env=OPENAI_API_KEY=container-private-fixture',
    '--env=GEV_CACHE_DIR=/app/.gev-cache/provider-fixture',
    '--env=AISSTREAM_API_KEY=container-ais-fixture',
    '--env=AISSTREAM_URL=ws://127.0.0.1:9091',
    image,
  ).trim();
  run('start', id);
  let healthy = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      run(
        'exec',
        id,
        '/nodejs/bin/node',
        '/app/server/standalone/healthcheck.mjs',
      );
      healthy = true;
      break;
    } catch {
      await setTimeout(250);
    }
  }
  assert.ok(healthy, run('logs', id));
  const probe = String.raw`
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    (async () => {
      assert.equal(process.getuid(), 65532);
      assert.equal(process.versions.node.split('.')[0], '26');
      for (const path of ['/bin/sh', '/bin/bash', '/bin/busybox', '/busybox/sh', '/usr/bin/npm', '/usr/local/bin/npm', '/usr/local/lib/node_modules/npm', '/usr/bin/apt', '/usr/bin/dpkg', '/app/node_modules', '/app/.env']) {
        assert.equal(fs.existsSync(path), false, path);
      }
      assert.throws(() => fs.writeFileSync('/app/should-not-write', 'x'));
      fs.writeFileSync('/app/.gev-cache/write-probe', 'ok');
      const get = (path) => fetch('http://127.0.0.1:8080' + path);
      // A seeded provider cache must be read from the configured directory.
      fs.mkdirSync(process.env.GEV_CACHE_DIR, { recursive: true });
      fs.writeFileSync(process.env.GEV_CACHE_DIR + '/celestrak-fixture.json', JSON.stringify({ at: Date.now(), body: 'fixture TLE cache' }));
      const cached = await get('/api/celestrak/fixture');
      assert.equal(cached.status, 200);
      assert.equal(cached.headers.get('x-tle-cache'), 'HIT');
      assert.equal(await cached.text(), 'fixture TLE cache');

      // Exercise the bundled ws client against an offline local handshake target.
      // A lost dependency injection would fall back to require('ws'), which
      // cannot succeed in this image without node_modules.
      const target = require('node:http').createServer();
      let upgraded = false;
      target.on('upgrade', (_request, socket) => {
        upgraded = true;
        socket.destroy();
      });
      await new Promise(resolve => target.listen(9091, '127.0.0.1', resolve));
      try {
        const deadline = Date.now() + 10_000;
        while (!upgraded && Date.now() < deadline) {
          const response = await get('/api/ais-live');
          assert.equal(response.status, 200);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.equal(upgraded, true, 'AIS must use the bundled WebSocket transport');
      } finally {
        await new Promise(resolve => target.close(resolve));
      }
      const document = await (await get('/')).text();
      assert.match(document, /runtime-config\.js/);
      for (const asset of ['/cesium/Cesium.js', '/cesium/Widgets/widgets.css']) {
        const response = await get(asset);
        assert.equal(response.status, 200, asset);
        assert.ok((await response.text()).length > 100, asset);
      }
      const config = await (await get('/runtime-config.js')).text();
      assert.match(config, /container-public-fixture/);
      assert.doesNotMatch(config, /container-private-fixture/);
      assert.equal((await (await get('/runtime-config.js')).text()).includes('"realtimeDebugLogging":false'), true);
      for (const path of ['/api/realtime/debug-log', '/api/realtime/debug-log/nested', '/api/realtime/debug-log.json', '/API/REALTIME/DEBUG-LOG']) {
        assert.equal((await fetch('http://127.0.0.1:8080' + path, {method: 'POST', body: '{"fixture":true}'})).status, 404, path);
      }
      assert.equal(fs.existsSync('/app/.gev-logs'), false);
      assert.equal((await get('/api/setup/status')).status, 404);
      assert.equal((await get('/api/setup/keys')).status, 404);
      assert.equal((await get('/server/standalone/index.mjs')).status, 404);
      assert.equal((await get('/.env')).status, 404);
      console.log('Runtime passed: Node 26, non-root, no shell/npm, read-only app, writable cache, public-only config.');
    })().catch(error => { console.error(error); process.exit(1); });
  `;
  process.stdout.write(run('exec', id, '/nodejs/bin/node', '-e', probe));
  const started = Date.now();
  run('stop', '--time=15', id);
  const stopped = JSON.parse(run('inspect', id))[0];
  assert.equal(
    stopped.State.ExitCode,
    0,
    'SIGTERM must exit cleanly, without SIGKILL',
  );
  assert.ok(
    Date.now() - started < 15_000,
    'shutdown must complete before the grace period',
  );
  console.log('Graceful shutdown passed.');
  run(
    'run',
    '--rm',
    '--read-only',
    '--network=none',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    `--volume=${volume}:/app/.gev-cache`,
    '--entrypoint=/nodejs/bin/node',
    image,
    '-e',
    "require('node:assert/strict').equal(require('node:fs').readFileSync('/app/.gev-cache/write-probe', 'utf8'), 'ok')",
  );
  console.log(
    'Cache ownership and persistence across container recreation passed.',
  );
} finally {
  // Only the exact disposable container and volume created by this test are removed.
  if (id) run('rm', '--force', id);
  run('volume', 'rm', volume);
}
