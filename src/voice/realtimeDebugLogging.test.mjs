import assert from 'node:assert/strict';
import test from 'node:test';
import { GevRealtimeController } from './gevRealtime.js';

test('production suppresses conversation uploads while development keeps its logging behavior', (t) => {
  const originals = new Map(
    ['__GEV_CONFIG__', 'navigator', 'fetch'].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  t.after(() => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const requests = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { sendBeacon: (url) => (requests.push(url), true) },
  });
  globalThis.fetch = (url) => {
    requests.push(url);
    return Promise.resolve({ ok: true });
  };
  const emit = () =>
    GevRealtimeController.prototype.debugLog.call(
      { status: 'idle', sessionId: 'fixture' },
      'fixture.event',
      { text: 'private conversation fixture' },
    );
  globalThis.__GEV_CONFIG__ = { realtimeDebugLogging: false };
  emit();
  assert.deepEqual(requests, []);
  delete globalThis.__GEV_CONFIG__;
  emit();
  assert.deepEqual(requests, ['/api/realtime/debug-log']);
  globalThis.__GEV_CONFIG__ = { realtimeDebugLogging: true };
  emit();
  assert.equal(requests.length, 2);
});
