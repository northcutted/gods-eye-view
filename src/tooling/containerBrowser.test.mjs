import assert from 'node:assert/strict';
import test from 'node:test';
import { browserResponse } from '../../scripts/test-container-browser.mjs';

const origin = 'http://127.0.0.1:43123';

test('browser smoke serves real app assets and runtime policy routes', () => {
  for (const route of [
    '/',
    '/assets/index-abc.js',
    '/runtime-config.js',
    '/healthz',
    '/api/setup/status',
    '/api/realtime/debug-log',
  ]) {
    assert.equal(browserResponse(`${origin}${route}`, origin), null, route);
  }
});

test('browser smoke isolates live providers and uses only fixture map tiles', () => {
  for (const url of [
    `${origin}/api/opensky`,
    'https://services.arcgisonline.com/metadata?f=json',
    'https://api.openai.com/v1/realtime',
    'https://127.0.0.1:43123/assets/app.js',
  ]) {
    assert.equal(browserResponse(url, origin).status, 503, url);
  }
  const tile = browserResponse(
    'https://tile.openstreetmap.org/0/0/0.png',
    origin,
  );
  assert.equal(tile.contentType, 'image/png');
  assert.ok(Buffer.isBuffer(tile.body));
  assert.equal(
    browserResponse(
      'https://tile.openstreetmap.org.evil.test/0/0/0.png',
      origin,
    ).status,
    503,
  );
});

test('negative control suppresses application JavaScript, not the HTML shell', () => {
  assert.equal(
    browserResponse(`${origin}/assets/index-abc.js`, origin, {
      negativeControl: true,
    }).body,
    '',
  );
  assert.equal(
    browserResponse(`${origin}/`, origin, { negativeControl: true }),
    null,
  );
});
