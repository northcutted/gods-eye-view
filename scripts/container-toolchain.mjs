#!/usr/bin/env node
/** Keep CI tool bytes and Node/base metadata in Dependabot-readable manifests. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFile, chmod, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export function pinnedStages(dockerfile) {
  const stages = {};
  for (const line of dockerfile.split('\n')) {
    if (!/^FROM\s/i.test(line)) continue;
    const match =
      /^FROM\s+(?:--platform=\S+\s+)?(\S+@sha256:[a-f0-9]{64})\s+AS\s+(\w+)\s*$/i.exec(
        line,
      );
    assert.ok(
      match,
      `Expected a literal, digest-pinned FROM with a stage name: ${line}`,
    );
    assert.ok(!stages[match[2]], `Duplicate stage: ${match[2]}`);
    stages[match[2]] = match[1];
  }
  return stages;
}

export function toolchain(application, tools) {
  const { build, runtime } = pinnedStages(application);
  const node = /^node:(26\.\d+\.\d+)-/.exec(build || '')?.[1];
  assert.ok(node, 'The container contract currently targets Node 26');
  assert.match(
    runtime || '',
    /^gcr\.io\/distroless\/nodejs26-debian13:nonroot@sha256:/,
  );
  const images = pinnedStages(tools);
  assert.deepEqual(Object.keys(images).sort(), [
    'buildkit',
    'buildx',
    'cosign',
    'grype',
    'sbom',
  ]);
  return { node, runtime, ...images };
}

export async function install(
  images,
  includeScanTools,
  docker = (...args) =>
    execFileSync('docker', args, { encoding: 'utf8', timeout: 180_000 }),
) {
  assert.equal(
    process.env.GITHUB_ACTIONS,
    'true',
    'Tool installation is only for disposable GitHub Actions runners',
  );
  assert.ok(process.env.GITHUB_PATH);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gev-ci-tools-'));
  const plugins = path.join(
    process.env.DOCKER_CONFIG || path.join(os.homedir(), '.docker'),
    'cli-plugins',
  );
  await mkdir(plugins, { recursive: true });
  const entries = [['buildx', '/buildx', path.join(plugins, 'docker-buildx')]];
  if (includeScanTools)
    entries.push(
      ['cosign', '/ko-app/cosign', path.join(directory, 'cosign')],
      ['grype', '/grype', path.join(directory, 'grype')],
    );
  for (const [name, source, destination] of entries) {
    docker('pull', images[name]);
    const id = docker('create', images[name], '/__gev_extract_only__').trim();
    try {
      docker('cp', `${id}:${source}`, destination);
      await chmod(destination, 0o755);
    } finally {
      docker('rm', id);
    }
  }
  await appendFile(process.env.GITHUB_PATH, `${directory}\n`);
  docker('buildx', 'version');
}

async function main() {
  const args = process.argv.slice(2);
  assert.ok(args.every((arg) => ['--install', '--scan-tools'].includes(arg)));
  assert.ok(!args.includes('--scan-tools') || args.includes('--install'));
  const images = toolchain(
    await readFile(path.join(root, 'Dockerfile'), 'utf8'),
    await readFile(
      path.join(root, '.github/container-tools/Dockerfile'),
      'utf8',
    ),
  );
  if (args.includes('--install'))
    await install(images, args.includes('--scan-tools'));
  for (const [name, value] of Object.entries(images))
    console.log(`${name}=${value}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await main();
