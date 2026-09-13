// CI-only publication metadata and draft notes. No runtime dependencies.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const versionPattern =
  /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const shaPattern = /^[a-f0-9]{40}$/;

function validateVersion(version) {
  assert.match(
    version,
    versionPattern,
    'Use a version such as v1.2.3 or v1.2.3-rc.1',
  );
  assert.ok(
    version === version.trim() && version.length <= 128,
    'The version must fit a container tag',
  );
  const prerelease = version.match(/^[^-]+-(.*)$/)?.[1];
  assert.ok(
    !prerelease?.split('.').some((part) => /^0\d+$/.test(part)),
    'Numeric prerelease identifiers cannot have leading zeros',
  );
}

export function releaseVersion(ref) {
  assert.ok(
    ref.startsWith('refs/tags/'),
    'GitHub Releases require an existing version tag',
  );
  const version = ref.slice('refs/tags/'.length);
  validateVersion(version);
  return version;
}

export function publicationPlan(env) {
  const { EVENT, GITHUB_REF: ref, GITHUB_SHA: sha } = env;
  assert.match(sha, shaPattern);
  const publish = EVENT === 'push' && ref.startsWith('refs/tags/');
  const version = publish ? releaseVersion(ref) : `sha-${sha}`;
  const tags = [];
  let branch = '';
  if (publish) {
    branch = branchAlias(env.DEFAULT_BRANCH);
    tags.push(version);
    if (!version.includes('-')) tags.push('latest');
    tags.push(branch);
  }
  return { publish, version, tags, branch };
}

export function branchAlias(branch) {
  assert.match(
    branch,
    /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/,
    'The release branch must be a valid container tag',
  );
  assert.ok(
    branch !== 'latest' &&
      !branch.startsWith('build-') &&
      !branch.startsWith('sha-') &&
      !versionPattern.test(branch),
    'The release branch collides with a reserved image tag',
  );
  return branch;
}

export function verifyReleaseBranch(repo, branch, commit, request = api) {
  branchAlias(branch);
  assert.match(commit, shaPattern);
  const ref = request(repo, `git/ref/heads/${encodeURIComponent(branch)}`);
  assert.equal(ref.ref, `refs/heads/${branch}`);
  assert.equal(ref.object?.type, 'commit');
  assert.match(ref.object.sha, shaPattern);
  const comparison = request(
    repo,
    `compare/${commit}...${ref.object.sha}`,
    '--jq',
    '{status, merge_base_commit: {sha: .merge_base_commit.sha}}',
  );
  assert.ok(
    ['ahead', 'identical'].includes(comparison.status) &&
      comparison.merge_base_commit?.sha === commit,
    `The tagged commit must belong to release branch ${branch}; no images were published`,
  );
  return ref.object.sha;
}

export function imageRecord(env, index) {
  assert.match(env.GITHUB_REPOSITORY, /^[\w.-]+\/[\w.-]+$/);
  assert.equal(env.IMAGE, `ghcr.io/${env.GITHUB_REPOSITORY.toLowerCase()}`);
  assert.match(env.GITHUB_SHA, shaPattern);
  assert.match(env.DIGEST, digestPattern);
  assert.match(env.GITHUB_REF, /^refs\/(heads|tags)\/[^\s]+$/);
  assert.match(env.GITHUB_RUN_ID, /^\d+$/);
  assert.match(env.GITHUB_RUN_ATTEMPT, /^\d+$/);
  assert.equal(index.mediaType, 'application/vnd.oci.image.index.v1+json');
  const platforms = ['amd64', 'arm64'].map((arch) => {
    const matches = index.manifests.filter(
      (entry) =>
        entry.platform?.os === 'linux' && entry.platform.architecture === arch,
    );
    assert.equal(matches.length, 1, `Expected exactly one linux/${arch} image`);
    assert.match(matches[0].digest, digestPattern);
    return { platform: `linux/${arch}`, digest: matches[0].digest };
  });
  const plan = publicationPlan({
    ...env,
    EVENT: env.GITHUB_EVENT_NAME,
    DEFAULT_BRANCH: env.RELEASE_BRANCH,
  });
  assert.ok(
    plan.publish,
    'Image evidence is only generated for version-tag pushes',
  );
  const tags = env.IMAGE_TAGS.split(' ');
  assert.deepEqual(
    tags,
    plan.tags,
    'Published tags must match the release plan',
  );
  assert.match(env.RELEASE_BRANCH_COMMIT, shaPattern);
  return {
    schemaVersion: 1,
    version: plan.version,
    image: env.IMAGE,
    digest: env.DIGEST,
    reference: `${env.IMAGE}@${env.DIGEST}`,
    tags,
    source: {
      repository: env.GITHUB_REPOSITORY,
      commit: env.GITHUB_SHA,
      ref: env.GITHUB_REF,
      releaseBranch: plan.branch,
      releaseBranchCommit: env.RELEASE_BRANCH_COMMIT,
    },
    workflow: {
      path: '.github/workflows/container.yml',
      run: `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}`,
    },
    platforms,
  };
}

export function containerNotes(record) {
  const { image, reference, tags, source, workflow, platforms } = record;
  const meaning = (tag) =>
    tag === 'latest'
      ? 'Most recently published stable release'
      : tag === source.releaseBranch
        ? `Most recently published release from ${source.releaseBranch}; includes prereleases`
        : 'Exact Git version tag for this release';
  return `## Published container

\`docker pull ${image}:${tags.includes('latest') ? 'latest' : tags.find((tag) => tag.startsWith('v')) || tags[0]}\`

| Container tag | What it means |
| --- | --- |
${tags.map((tag) => `| \`${image}:${tag}\` | ${meaning(tag)} |`).join('\n')}

All tags above resolved to this image when published. Tags can move; use the
digest below to keep running these exact bytes.

| Build identity | Value |
| --- | --- |
| Image version | \`${record.version}\` |
| Image digest (multi-platform index) | \`${record.digest}\` |
| Git commit SHA (source code, not an image digest) | [\`${source.commit}\`](https://github.com/${source.repository}/commit/${source.commit}) |
| Build source ref | \`${source.ref}\` |
| Release branch | \`${source.releaseBranch}\` (contains the tagged commit) |
| Build and verification | [GitHub Actions run](${workflow.run}) |

\`docker pull ${reference}\`

Docker selects the matching architecture automatically:

| Platform | Image manifest digest |
| --- | --- |
${platforms.map(({ platform, digest }) => `| ${platform} | \`${digest}\` |`).join('\n')}

SBOMs (dependency inventories), build provenance, and the exact image reference
are in the workflow's evidence artifact. Complete vulnerability reports are in
the two \`vulnerabilities-\` artifacts. Fixable High/Critical findings block
publication; unfixed findings are reported, not declared harmless.

[Container package](https://github.com/${source.repository}/pkgs/container/${source.repository.split('/')[1]})
`;
}

export function verificationNotes(record) {
  const tagged = record.source.ref.startsWith('refs/tags/');
  const ref = record.source.ref.replace(/^refs\/(heads|tags)\//, '');
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  return `# Verify this container

Install Docker Buildx and the official [SLSA verifier](https://github.com/slsa-framework/slsa-verifier#installation).
Then check the signed record attached to this exact image:

\`\`\`sh
slsa-verifier verify-image ${quote(record.reference)} \\
  --source-uri ${quote(`github.com/${record.source.repository}`)} \\
  --source-${tagged ? 'tag' : 'branch'} ${quote(ref)} --print-provenance
docker buildx imagetools inspect ${quote(record.reference)} --format '{{json .SBOM}}'
docker buildx imagetools inspect ${quote(record.reference)} --format '{{json .Provenance}}'
\`\`\`

Confirm the source commit is \`${record.source.commit}\` in
\`invocation.configSource.digest.sha1\` and the caller is
\`.github/workflows/container.yml\`. Versioned releases use tag provenance;
branch, scheduled, and manual builds do not publish images or signed provenance.

\`release.json\` is a convenient index of the image references, not a signed
attestation. \`SHA256SUMS\` checks downloaded files for corruption; verify the
registry's signed provenance for build origin. Keep the OCI index, both images,
SBOMs, and Sigstore objects together when mirroring the image.
`;
}

// gh handles authentication; errors (including permission/network failures) are
// fatal. Use list APIs so an absent object is not confused with a failed lookup.
function gh(...args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

function api(repo, route, ...args) {
  return JSON.parse(gh('api', `repos/${repo}/${route}`, ...args));
}

export function existingRelease(repo, tag, request = api) {
  for (let page = 1; ; page++) {
    const releases = request(repo, `releases?per_page=30&page=${page}`);
    assert.ok(Array.isArray(releases), 'Invalid GitHub release list');
    const found = releases.find((release) => release.tag_name === tag);
    if (found || releases.length < 30) return found;
  }
}

export function assertTagTarget(refs, sha, resolveCommit) {
  assert.equal(refs.length, 1, 'The release tag must already exist');
  assert.equal(
    resolveCommit(),
    sha,
    'The release tag points to a different commit; it will not be moved',
  );
}

function checkTag(repo, tag, sha, request = api) {
  const refs = request(repo, `git/matching-refs/tags/${tag}`).filter(
    (entry) => entry.ref === `refs/tags/${tag}`,
  );
  assertTagTarget(refs, sha, () => request(repo, `commits/${tag}`).sha);
}

const evidenceFiles = [
  'release.json',
  'container.md',
  'VERIFYING.md',
  'image.txt',
  'index.json',
  'toolchain.txt',
  'slsa-provenance.json',
  'sbom-amd64.json',
  'sbom-arm64.json',
  'buildkit-provenance-amd64.json',
  'buildkit-provenance-arm64.json',
  'vulnerabilities-amd64.json',
  'vulnerabilities-arm64.json',
];

export function assetsToUpload(release, marker, files) {
  assert.ok(
    release.draft && release.body?.includes(marker),
    'An existing release belongs to another build or is already published; left unchanged',
  );
  return files.filter(({ name, digest }) => {
    const existing = release.assets.find((asset) => asset.name === name);
    if (!existing) return true;
    assert.equal(
      existing.digest,
      digest,
      `Existing release asset ${name} differs or has no checksum; left unchanged`,
    );
    return false;
  });
}

export function createDraft(
  env,
  { request = api, execute = gh, directory = '.' } = {},
) {
  assert.equal(
    env.GITHUB_EVENT_NAME,
    'push',
    'GitHub Releases require a version-tag push',
  );
  const tag = releaseVersion(env.GITHUB_REF);
  const repo = env.GITHUB_REPOSITORY;
  const file = (relative) => path.join(directory, relative);
  const record = JSON.parse(
    readFileSync(file('evidence/release.json'), 'utf8'),
  );
  assert.equal(record.image, env.IMAGE);
  assert.equal(record.digest, env.DIGEST);
  assert.equal(record.source.repository, env.GITHUB_REPOSITORY);
  assert.equal(record.source.commit, env.GITHUB_SHA);
  assert.equal(record.source.ref, env.GITHUB_REF);
  assert.equal(record.version, tag);
  assert.ok(
    record.workflow.run.startsWith(
      `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/attempts/`,
    ),
  );
  assert.ok(record.tags.includes(tag));
  checkTag(repo, tag, env.GITHUB_SHA, request);
  for (const arch of ['amd64', 'arm64']) {
    const report = readFileSync(
      file(`scans/vulnerabilities-${arch}/gev-vulnerabilities.json`),
      'utf8',
    );
    assert.ok(
      Array.isArray(JSON.parse(report).matches),
      'Missing or invalid scan report',
    );
    writeFileSync(file(`evidence/vulnerabilities-${arch}.json`), report);
  }
  const files = evidenceFiles.map((name) => ({
    name,
    digest: `sha256:${createHash('sha256')
      .update(readFileSync(file(`evidence/${name}`)))
      .digest('hex')}`,
  }));
  writeFileSync(
    file('evidence/SHA256SUMS'),
    files.map(({ name, digest }) => `${digest.slice(7)}  ${name}\n`).join(''),
  );
  files.push({
    name: 'SHA256SUMS',
    digest: `sha256:${createHash('sha256')
      .update(readFileSync(file('evidence/SHA256SUMS')))
      .digest('hex')}`,
  });
  // Re-run failed jobs increments GITHUB_RUN_ATTEMPT even when the build jobs
  // are not rerun. Keep identity tied to the downloaded build record instead.
  const marker = `<!-- gev-container:${record.workflow.run}:${record.digest} -->`;
  let release = existingRelease(repo, tag, request);
  if (!release) {
    const generated = request(
      repo,
      'releases/generate-notes',
      '-f',
      `tag_name=${tag}`,
    );
    const notes = `## Highlights\n\n<!-- Add the usual release highlights, screenshots, and upgrade notes here before publishing. -->\n\n${generated.body}\n\n${containerNotes(record)}\nThe files below include both architecture scans, SBOMs, provenance,\n\`release.json\`, and \`VERIFYING.md\`.\n\n${marker}\n`;
    writeFileSync(file('evidence/release-notes.md'), notes);
    execute(
      'release',
      'create',
      tag,
      '--repo',
      repo,
      '--draft',
      '--verify-tag',
      '--title',
      tag,
      '--notes-file',
      file('evidence/release-notes.md'),
      ...(tag.includes('-') ? ['--prerelease'] : []),
    );
    release = existingRelease(repo, tag, request);
    assert.ok(release, 'The created draft could not be read back');
  }
  // Resume a failed upload only for this exact build. Never rewrite notes or
  // overwrite an existing asset, including ones the author added manually.
  const missing = assetsToUpload(release, marker, files);
  if (missing.length)
    execute(
      'release',
      'upload',
      tag,
      ...missing.map(({ name }) => file(`evidence/${name}`)),
      '--repo',
      repo,
    );
  const checked = existingRelease(repo, tag, request);
  assert.equal(
    assetsToUpload(checked, marker, files).length,
    0,
    'Some release assets were not uploaded',
  );
  console.log(
    `## Draft release ready\n\n[Edit ${tag} and publish when ready](${checked.html_url}). Add your release highlights above the container details. Images are published; the GitHub Release remains a draft.\n`,
  );
}

function main(command, env) {
  if (command === 'prepare') {
    const plan = publicationPlan(env);
    let branchCommit = '';
    if (plan.publish) {
      checkTag(env.GITHUB_REPOSITORY, plan.version, env.GITHUB_SHA);
      assert.ok(
        !existingRelease(env.GITHUB_REPOSITORY, plan.version),
        'A release already exists for this version; use a new version or edit the existing release manually',
      );
      branchCommit = verifyReleaseBranch(
        env.GITHUB_REPOSITORY,
        plan.branch,
        env.GITHUB_SHA,
      );
    }
    for (const [key, value] of Object.entries({
      image: `ghcr.io/${env.GITHUB_REPOSITORY.toLowerCase()}`,
      created: new Date().toISOString(),
      version: plan.version,
      publish: plan.publish,
      branch: plan.branch,
      branch_commit: branchCommit,
      tags: plan.tags.join(' '),
    }))
      console.log(`${key}=${value}`);
  } else if (command === 'evidence') {
    const record = imageRecord(
      env,
      JSON.parse(readFileSync('evidence/index.json', 'utf8')),
    );
    writeFileSync(
      'evidence/release.json',
      `${JSON.stringify(record, null, 2)}\n`,
    );
    writeFileSync('evidence/container.md', containerNotes(record));
    writeFileSync('evidence/VERIFYING.md', verificationNotes(record));
    console.log(containerNotes(record));
  } else if (command === 'draft') createDraft(env);
  else throw new Error('Expected prepare, evidence, or draft');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv[2], process.env);
