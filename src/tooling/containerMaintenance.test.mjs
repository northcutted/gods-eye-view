import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  install,
  pinnedStages,
  toolchain,
} from '../../scripts/container-toolchain.mjs';
import {
  localOrigin,
  median,
  summarize,
} from '../../scripts/benchmark-container.mjs';

const application = await readFile(
  new URL('../../Dockerfile', import.meta.url),
  'utf8',
);
const tools = await readFile(
  new URL('../../.github/container-tools/Dockerfile', import.meta.url),
  'utf8',
);

test('CI derives the runtime and Node version from dependency-managed manifests', () => {
  const metadata = toolchain(application, tools);
  assert.equal(metadata.runtime, pinnedStages(application).runtime);
  assert.match(metadata.node, /^26\.\d+\.\d+$/);
  for (const name of ['buildx', 'buildkit', 'sbom', 'cosign', 'grype'])
    assert.match(metadata[name], /@sha256:[a-f0-9]{64}$/);
  const updated = application.replace(/node:26\.\d+\.\d+-/, 'node:26.99.1-');
  assert.equal(toolchain(updated, tools).node, '26.99.1');
  const runtimeDigest = metadata.runtime.split('@')[1];
  assert.ok(
    toolchain(
      application.replace(runtimeDigest, `sha256:${'a'.repeat(64)}`),
      tools,
    ).runtime.endsWith('a'.repeat(64)),
  );
});

test('tool manifests reject floating, missing, duplicate, and unsupported dependencies', () => {
  assert.throws(() => pinnedStages('FROM node:26 AS build'));
  assert.throws(() => pinnedStages(`FROM $BASE AS build`));
  assert.throws(() => pinnedStages(`${tools}\n${tools}`));
  assert.throws(() =>
    toolchain(application, tools.replace(/^FROM .* AS grype$/m, '')),
  );
  assert.throws(() =>
    toolchain(application.replace('node:26.', 'node:27.'), tools),
  );
});

test(
  'CI installer copies only pinned tool binaries and removes extraction containers on success or failure',
  { skip: process.platform === 'win32' },
  async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'gev-toolchain-test-'),
    );
    const keys = ['GITHUB_ACTIONS', 'GITHUB_PATH', 'DOCKER_CONFIG', 'TMPDIR'];
    const saved = Object.fromEntries(
      keys.map((key) => [key, process.env[key]]),
    );
    try {
      process.env.GITHUB_ACTIONS = 'false';
      await assert.rejects(
        install({}, false, () => assert.fail('must not call Docker')),
        /disposable/,
      );
      Object.assign(process.env, {
        GITHUB_ACTIONS: 'true',
        GITHUB_PATH: path.join(directory, 'github-path'),
        DOCKER_CONFIG: path.join(directory, 'docker'),
        TMPDIR: directory,
      });
      const images = toolchain(application, tools);
      const calls = [];
      const docker = (...args) => {
        calls.push(args);
        if (args[0] === 'create') return 'fixture-container-id\n';
        if (args[0] === 'cp')
          writeFileSync(args[2], 'fixture binary, never executed');
        return '';
      };
      await install(images, true, docker);
      assert.deepEqual(
        calls.filter((call) => call[0] === 'pull').map((call) => call[1]),
        [images.buildx, images.cosign, images.grype],
      );
      assert.deepEqual(
        calls.filter((call) => call[0] === 'cp').map((call) => call[1]),
        [
          'fixture-container-id:/buildx',
          'fixture-container-id:/ko-app/cosign',
          'fixture-container-id:/grype',
        ],
      );
      assert.equal(calls.filter((call) => call[0] === 'rm').length, 3);
      const bin = (await readFile(process.env.GITHUB_PATH, 'utf8')).trim();
      for (const file of [
        path.join(process.env.DOCKER_CONFIG, 'cli-plugins/docker-buildx'),
        path.join(bin, 'cosign'),
        path.join(bin, 'grype'),
      ])
        assert.equal((await stat(file)).mode & 0o777, 0o755);
      calls.length = 0;
      await assert.rejects(
        install(images, false, (...args) => {
          if (args[0] === 'cp') throw new Error('fixture copy failure');
          return docker(...args);
        }),
        /fixture copy failure/,
      );
      assert.deepEqual(calls.at(-1), ['rm', 'fixture-container-id']);
    } finally {
      for (const key of keys) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test('benchmark accepts only loopback origins, not remote or credential-bearing targets', () => {
  assert.equal(localOrigin('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
  for (const value of [
    'https://example.com',
    'http://user:secret@localhost',
    'http://localhost/api',
    'http://localhost/?key=x',
  ])
    assert.throws(() => localOrigin(value));
});

test('benchmark summaries preserve both modes without cherry-picking', () => {
  assert.equal(median([10, 1, 3]), 3);
  assert.equal(median([1, 3, 10, 20]), 6.5);
  assert.throws(() => median([]));
  assert.throws(() => median([NaN]));
  const samples = ['dev', 'container'].flatMap((mode) =>
    [1, 3, 20].map((value) => ({
      mode,
      cache: 'cold',
      appReadyMs: value,
      ttfbMs: value,
      loadMs: value,
      assetRequests: value,
      assetWireBytes: value,
      jsHeapBytes: value,
    })),
  );
  const result = summarize(samples);
  assert.equal(result.dev.cold.appReadyMs, 3);
  assert.equal(result.container.cold.assetWireBytes, 3);
  assert.throws(() => summarize(samples.filter((row) => row.mode === 'dev')));
});
