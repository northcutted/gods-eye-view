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
  branchAlias,
  verifyReleaseBranch,
} from '../../scripts/container-publication.mjs';

const sha = 'a'.repeat(40);
const digest = `sha256:${'b'.repeat(64)}`;
const base = {
  EVENT: 'push',
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REF: 'refs/tags/v1.2.3',
  DEFAULT_BRANCH: 'main',
  RELEASE_BRANCH: 'main',
  RELEASE_BRANCH_COMMIT: sha,
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

test('workflow keeps all publishing permissions behind explicit tag-push gates', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/container.yml', import.meta.url),
    'utf8',
  ).replaceAll('\r\n', '\n');
  const job = (name) =>
    workflow.split(`\n  ${name}:\n`)[1]?.split(/\n  [\w-]+:\n/)[0];
  assert.ok(workflow.includes("branches: ['**']"));
  assert.ok(workflow.includes("tags: ['v*']"));
  assert.ok(
    workflow.includes("'publish' || github.ref"),
    'release runs must serialize alias promotion',
  );
  for (const name of [
    'build',
    'index',
    'provenance',
    'verify-and-promote',
    'draft-release',
  ]) {
    assert.ok(
      job(name)?.includes(
        "if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/') && needs.prepare.outputs.publish == 'true'",
      ),
      name,
    );
  }
  for (const name of ['prepare', 'checks', 'check-image']) {
    assert.ok(job(name)?.includes('contents: read'), name);
    assert.ok(!job(name).includes('packages: write'), name);
    assert.ok(!job(name).includes('id-token: write'), name);
    assert.ok(!job(name).includes('contents: write'), name);
  }
});

test('only an intentional tag push can publish; every other CI event is build-only', () => {
  for (const EVENT of [
    'push',
    'pull_request',
    'schedule',
    'workflow_dispatch',
  ]) {
    for (const GITHUB_REF of [
      'refs/heads/main',
      'refs/heads/feature',
      'refs/pull/123/merge',
      'refs/tags/v1.2.3',
    ]) {
      if (EVENT === 'push' && GITHUB_REF.startsWith('refs/tags/')) continue;
      const env = { ...base, EVENT, GITHUB_EVENT_NAME: EVENT, GITHUB_REF };
      const plan = publicationPlan(env);
      assert.equal(plan.publish, false, `${EVENT} ${GITHUB_REF}`);
      assert.deepEqual(plan.tags, []);
      assert.equal(plan.branch, '');
      assert.throws(() => recordFor(env));
      assert.throws(() => createDraft(env), /version.tag/);
    }
  }
});

test('versions retain their own tag; prerelease runs never promote latest', () => {
  assert.deepEqual(
    publicationPlan({ ...base, GITHUB_REF: 'refs/tags/v1.2.3' }).tags,
    ['v1.2.3', 'latest', 'main'],
  );
  for (const DEFAULT_BRANCH of ['main', 'trunk']) {
    const stable = publicationPlan({
      ...base,
      DEFAULT_BRANCH,
      GITHUB_REF: 'refs/tags/v1.2.3',
    });
    assert.equal(stable.version, 'v1.2.3');
    assert.equal(stable.publish, true);
    assert.deepEqual(stable.tags, ['v1.2.3', 'latest', DEFAULT_BRANCH]);
    assert.deepEqual(
      publicationPlan({
        ...base,
        DEFAULT_BRANCH,
        GITHUB_REF: 'refs/tags/v1.2.3-rc.1',
      }).tags,
      ['v1.2.3-rc.1', DEFAULT_BRANCH],
    );
  }
  const prerelease = publicationPlan({
    ...base,
    GITHUB_REF: 'refs/tags/v1.2.3-rc.1',
  });
  assert.equal(prerelease.version, 'v1.2.3-rc.1');
  assert.equal(prerelease.publish, true);
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
        .publish,
      false,
    );
    assert.throws(() => createDraft({ ...base, GITHUB_REF }), /version tag/);
  }
  assert.equal(
    publicationPlan({
      ...base,
      EVENT: 'pull_request',
      GITHUB_REF: 'refs/tags/v1.2.3',
    }).publish,
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
  assert.equal(record.version, 'v1.2.3');
  assert.equal(record.source.releaseBranch, 'main');
  assert.equal(record.source.releaseBranchCommit, sha);
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
      { ...base, IMAGE_TAGS: 'v1.2.3 latest main' },
      { ...index, manifests: index.manifests.slice(1) },
    ),
  );
  assert.throws(() =>
    imageRecord(
      { ...base, IMAGE_TAGS: 'v1.2.3 latest main' },
      { ...index, manifests: [...index.manifests, index.manifests[0]] },
    ),
  );
});

test('published-image instructions verify the version tag, not the branch alias', () => {
  assert.ok(!verificationNotes(recordFor(base)).includes('--source-branch'));
  assert.ok(
    verificationNotes(
      recordFor({ ...base, GITHUB_REF: 'refs/tags/v1.2.3' }),
    ).includes("--source-tag 'v1.2.3'"),
  );
});

test('branch aliases cannot collide with version, latest, commit, or staging tags', () => {
  assert.equal(branchAlias('main'), 'main');
  assert.equal(branchAlias('trunk'), 'trunk');
  for (const branch of [
    'latest',
    'v1.2.3',
    'sha-abc',
    'build-123',
    'release/1.x',
    'main\ninjected',
    '',
    'a'.repeat(129),
  ])
    assert.throws(() => branchAlias(branch));
});

test('release branch check accepts ancestors, rejects off-branch commits, and propagates API failures', () => {
  const head = 'c'.repeat(40);
  const calls = [];
  const ref = { ref: 'refs/heads/main', object: { type: 'commit', sha: head } };
  const request = (repo, route) => {
    calls.push(route);
    if (route === 'git/ref/heads/main') return ref;
    return { status: 'ahead', merge_base_commit: { sha } };
  };
  assert.equal(
    verifyReleaseBranch(base.GITHUB_REPOSITORY, 'main', sha, request),
    head,
  );
  assert.deepEqual(calls, ['git/ref/heads/main', `compare/${sha}...${head}`]);
  for (const status of ['behind', 'diverged', 'unknown'])
    assert.throws(
      () =>
        verifyReleaseBranch(
          base.GITHUB_REPOSITORY,
          'main',
          sha,
          (repo, route) =>
            route.startsWith('git/')
              ? ref
              : { status, merge_base_commit: { sha } },
        ),
      /must belong/,
    );
  assert.equal(
    verifyReleaseBranch(base.GITHUB_REPOSITORY, 'main', sha, (repo, route) =>
      route.startsWith('git/')
        ? { ...ref, object: { type: 'commit', sha } }
        : { status: 'identical', merge_base_commit: { sha } },
    ),
    sha,
  );
  assert.throws(
    () =>
      verifyReleaseBranch(base.GITHUB_REPOSITORY, 'main', sha, () => {
        throw new Error('403 forbidden');
      }),
    /403/,
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
