import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  publicationPlan,
  imageRecord,
  containerNotes,
  verificationNotes,
  assertTagTarget,
  assetsToUpload,
  createDraft,
  existingRelease,
  releaseVersion,
} from '../../scripts/container-publication.mjs';

const sha = 'a'.repeat(40);
const digest = `sha256:${'b'.repeat(64)}`;
const base = {
  EVENT: 'push',
  GITHUB_REF: 'refs/heads/main',
  DEFAULT_BRANCH: 'main',
  GITHUB_SHA: sha,
  GITHUB_REPOSITORY: 'bilawalsidhu/gods-eye-view',
  IMAGE: 'ghcr.io/bilawalsidhu/gods-eye-view',
  DIGEST: digest,
  GITHUB_RUN_ID: '123',
  GITHUB_RUN_ATTEMPT: '1',
};
const index = {
  mediaType: 'application/vnd.oci.image.index.v1+json',
  manifests: ['amd64', 'arm64', 'unknown'].map((arch, i) => ({
    platform: {
      os: arch === 'unknown' ? 'unknown' : 'linux',
      architecture: arch,
    },
    digest: `sha256:${String(i).repeat(64)}`,
  })),
};
const recordFor = (env) =>
  imageRecord(
    { ...env, IMAGE_TAGS: publicationPlan(env).tags.join(' ') },
    index,
  );

test('verified default-branch builds publish latest, main, and the commit tag', () => {
  for (const EVENT of ['push', 'schedule', 'workflow_dispatch']) {
    assert.equal(publicationPlan({ ...base, EVENT }).release, false);
    assert.deepEqual(publicationPlan({ ...base, EVENT }).tags, [
      `sha-${sha}`,
      'main',
      'latest',
    ]);
  }
  assert.ok(
    publicationPlan({
      ...base,
      GITHUB_REF: 'refs/heads/trunk',
      DEFAULT_BRANCH: 'trunk',
    }).tags.includes('latest'),
  );
  for (const env of [
    { EVENT: 'pull_request' },
    { GITHUB_REF: 'refs/heads/feature' },
  ]) {
    assert.equal(publicationPlan({ ...base, ...env }).publish, false);
    assert.equal(publicationPlan({ ...base, ...env }).release, false);
    assert.deepEqual(publicationPlan({ ...base, ...env }).tags, []);
  }
});

test('versions retain their own tag; prerelease runs never promote latest', () => {
  assert.deepEqual(
    publicationPlan({ ...base, GITHUB_REF: 'refs/tags/v1.2.3' }).tags,
    [`sha-${sha}`, 'v1.2.3', 'latest'],
  );
  for (const EVENT of ['push', 'workflow_dispatch']) {
    const stable = publicationPlan({
      ...base,
      EVENT,
      GITHUB_REF: 'refs/tags/v1.2.3',
    });
    assert.equal(stable.version, 'v1.2.3');
    assert.equal(stable.release, true);
    assert.equal(stable.publish, true);
    assert.deepEqual(
      publicationPlan({ ...base, EVENT, GITHUB_REF: 'refs/tags/v1.2.3-rc.1' })
        .tags,
      [`sha-${sha}`, 'v1.2.3-rc.1'],
    );
  }
  const prerelease = publicationPlan({
    ...base,
    GITHUB_REF: 'refs/tags/v1.2.3-rc.1',
  });
  assert.equal(prerelease.version, 'v1.2.3-rc.1');
  assert.equal(prerelease.release, true);
});

test('only tag refs can name releases; branches and malformed versions are rejected', () => {
  for (const GITHUB_REF of [
    'refs/heads/main',
    'refs/heads/v1.2.3',
    'refs/pull/123/merge',
  ]) {
    assert.throws(() => releaseVersion(GITHUB_REF), /version tag/);
    assert.equal(
      publicationPlan({ ...base, EVENT: 'workflow_dispatch', GITHUB_REF })
        .release,
      false,
    );
    assert.throws(() => createDraft({ ...base, GITHUB_REF }), /version tag/);
  }
  assert.equal(
    publicationPlan({
      ...base,
      EVENT: 'pull_request',
      GITHUB_REF: 'refs/tags/v1.2.3',
    }).release,
    false,
  );
  for (const version of [
    'latest',
    'v01.2.3',
    'v1.2',
    'v1.2.3-rc.01',
    `v1.2.3-${'a'.repeat(129)}`,
    'v1.2.3\n',
    'v1.2.3\ntags=evil',
    'v1.2.3;echo nope',
  ])
    assert.throws(() =>
      publicationPlan({ ...base, GITHUB_REF: `refs/tags/${version}` }),
    );
});

test('image evidence separates source SHA, index digest, and both platform digests', () => {
  const record = recordFor(base);
  assert.equal(record.source.commit, sha);
  assert.equal(record.version, `sha-${sha}`);
  assert.equal(
    recordFor({ ...base, GITHUB_REF: 'refs/tags/v1.2.3' }).version,
    'v1.2.3',
  );
  assert.equal(record.digest, digest);
  assert.deepEqual(
    record.platforms.map((entry) => entry.platform),
    ['linux/amd64', 'linux/arm64'],
  );
  const notes = containerNotes(record);
  for (const text of [
    ':latest',
    sha,
    digest,
    'linux/amd64',
    'linux/arm64',
    'Git commit SHA',
    'Image digest',
    'Tags can move',
  ])
    assert.ok(notes.includes(text));
  for (const bad of [
    { IMAGE: 'ghcr.io/someone/else' },
    { DIGEST: 'latest' },
    { GITHUB_SHA: 'main' },
  ])
    assert.throws(() => recordFor({ ...base, ...bad }));
  assert.throws(() =>
    imageRecord(
      { ...base, IMAGE_TAGS: `sha-${sha}` },
      { ...index, manifests: index.manifests.slice(1) },
    ),
  );
  assert.throws(() =>
    imageRecord(
      { ...base, IMAGE_TAGS: `sha-${sha}` },
      { ...index, manifests: [...index.manifests, index.manifests[0]] },
    ),
  );
});

test('verification instructions use branch provenance for main and tag provenance for releases', () => {
  assert.ok(
    verificationNotes(recordFor(base)).includes("--source-branch 'main'"),
  );
  assert.ok(
    verificationNotes(
      recordFor({ ...base, GITHUB_REF: 'refs/tags/v1.2.3' }),
    ).includes("--source-tag 'v1.2.3'"),
  );
});

test('existing lightweight or annotated version tags must resolve to the tested commit', () => {
  assert.throws(
    () =>
      assertTagTarget([], sha, () =>
        assert.fail('absent tag should not be resolved'),
      ),
    /must already exist/,
  );
  for (const type of ['commit', 'tag']) {
    const refs = [
      { object: { type, sha: 'tag object can differ from commit' } },
    ];
    assertTagTarget(refs, sha, () => sha);
    assert.throws(
      () => assertTagTarget(refs, sha, () => 'c'.repeat(40)),
      /different commit/,
    );
  }
});

test('retrying uploads preserves notes and rejects other builds, published releases, and changed assets', () => {
  const marker = '<!-- fixture -->';
  const files = [{ name: 'release.json', digest }];
  const release = { draft: true, body: `Author notes\n${marker}`, assets: [] };
  assert.deepEqual(assetsToUpload(release, marker, files), files);
  assert.deepEqual(
    assetsToUpload({ ...release, assets: files }, marker, files),
    [],
  );
  assert.equal(release.body, `Author notes\n${marker}`);
  for (const changed of [
    { draft: false },
    { body: 'someone else' },
    { assets: [{ name: 'release.json', digest: 'sha256:bad' }] },
  ]) {
    assert.throws(() =>
      assetsToUpload({ ...release, ...changed }, marker, files),
    );
  }
});

test('release lookups paginate and never treat API errors as an absent release', () => {
  const calls = [];
  const request = (repo, route) => {
    calls.push(route);
    return calls.length === 1
      ? Array.from({ length: 30 }, (_, i) => ({ tag_name: `v1.0.${i}` }))
      : [{ tag_name: 'v0.1.0', draft: true }];
  };
  assert.equal(
    existingRelease(base.GITHUB_REPOSITORY, 'v0.1.0', request).draft,
    true,
  );
  assert.deepEqual(calls, [
    'releases?per_page=30&page=1',
    'releases?per_page=30&page=2',
  ]);
  assert.equal(
    existingRelease(base.GITHUB_REPOSITORY, 'v0.1.0', () => []),
    undefined,
  );
  assert.throws(
    () =>
      existingRelease(base.GITHUB_REPOSITORY, 'v0.1.0', () => {
        throw new Error('403 forbidden');
      }),
    /403/,
  );
  assert.throws(
    () => existingRelease(base.GITHUB_REPOSITORY, 'v0.1.0', () => ({})),
    /Invalid/,
  );
});

for (const version of ['v1.2.3', 'v1.2.3-rc.1']) {
  test(`draft flow for ${version} uses the existing tag and preserves notes across retries`, () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'gev-draft-test-'));
    const env = {
      ...base,
      GITHUB_REF: `refs/tags/${version}`,
    };
    let release;
    const mutations = [];
    let failUpload = true;
    try {
      mkdirSync(path.join(directory, 'evidence'));
      writeFileSync(
        path.join(directory, 'evidence/release.json'),
        JSON.stringify(recordFor(env)),
      );
      for (const name of [
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
      ])
        writeFileSync(path.join(directory, 'evidence', name), 'fixture');
      for (const arch of ['amd64', 'arm64']) {
        mkdirSync(path.join(directory, `scans/vulnerabilities-${arch}`), {
          recursive: true,
        });
        writeFileSync(
          path.join(
            directory,
            `scans/vulnerabilities-${arch}/gev-vulnerabilities.json`,
          ),
          JSON.stringify({
            matches: [],
            ignoredMatches: [{ fixture: 'unfixed report retained' }],
          }),
        );
      }
      const request = (repo, route, ...args) => {
        assert.equal(repo, base.GITHUB_REPOSITORY);
        if (route.startsWith('git/matching-refs'))
          return [{ ref: env.GITHUB_REF }];
        if (route === `commits/${version}`) return { sha };
        if (route === 'releases?per_page=30&page=1')
          return release ? [release] : [];
        if (route === 'releases/generate-notes') {
          assert.ok(args.includes(`tag_name=${version}`));
          return { body: '## What changed\nGenerated changelog' };
        }
        assert.fail(`Unexpected API request: ${route}`);
      };
      const execute = (...args) => {
        mutations.push(args);
        assert.equal(args[0], 'release');
        assert.ok(args.includes('--repo'));
        if (args[1] === 'create') {
          assert.ok(args.includes('--draft'));
          assert.equal(args.includes('--prerelease'), version.includes('-'));
          assert.ok(args.includes('--verify-tag'));
          assert.ok(
            !args.includes('--target'),
            'must not create a Git tag from a branch or commit',
          );
          assert.equal(args[2], version);
          assert.equal(args[args.indexOf('--title') + 1], version);
          release = {
            tag_name: version,
            draft: true,
            assets: [],
            body: readFileSync(args[args.indexOf('--notes-file') + 1], 'utf8'),
            html_url:
              'https://github.com/bilawalsidhu/gods-eye-view/releases/fixture',
          };
          assert.ok(release.body.includes('Generated changelog'));
          assert.ok(release.body.includes('## Published container'));
        } else if (args[1] === 'upload') {
          assert.ok(!args.includes('--clobber'));
          for (const file of args.slice(3, args.indexOf('--repo'))) {
            release.assets.push({
              name: path.basename(file),
              digest: `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`,
            });
            if (failUpload) throw new Error('Simulated interrupted upload');
          }
        } else assert.fail('Release editing is not allowed');
        return '';
      };
      assert.throws(
        () => createDraft(env, { directory, request, execute }),
        /interrupted upload/,
      );
      release.body = `Author added screenshots\n${release.body}`;
      const authorNotes = release.body;
      failUpload = false;
      env.GITHUB_RUN_ATTEMPT = '2';
      createDraft(env, { directory, request, execute });
      assert.equal(release.body, authorNotes);
      assert.equal(release.assets.length, 14);
      assert.equal(mutations.filter((args) => args[1] === 'create').length, 1);
      const before = mutations.length;
      createDraft(env, { directory, request, execute });
      assert.equal(
        mutations.length,
        before,
        'complete retry performs no writes',
      );
      release.draft = false;
      assert.throws(
        () => createDraft(env, { directory, request, execute }),
        /already published/,
      );
      assert.equal(mutations.length, before);
      unlinkSync(
        path.join(
          directory,
          'scans/vulnerabilities-arm64/gev-vulnerabilities.json',
        ),
      );
      assert.throws(
        () => createDraft(env, { directory, request, execute }),
        /ENOENT/,
      );
      assert.equal(
        mutations.length,
        before,
        'missing evidence cannot create a release',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
