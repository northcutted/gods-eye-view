# 🧪 What we tested

**Local validation passed, and an earlier fork publication was verified.**
The revised workflow still needs a fresh hosted run. Application tests, runtime
safety checks, and a first-run browser check passed for the local image recorded
below. The scan retained four unfixed High/Critical library findings; under the
fixable-only policy, those are reported without blocking. This is a dated
validation record, not a vulnerability-free guarantee or an independent security
certification.

The canonical deployment target is `ghcr.io/bilawalsidhu/gods-eye-view`, with
source identity `github.com/bilawalsidhu/gods-eye-view`. Fork links and image
subjects below identify where historical tests actually ran; they are not
deployment recommendations or upstream publication claims. Use the canonical
examples in the [Docker guide](CONTAINERS.md) for deployment, once upstream
has published a verified image.

## Upstream PR preparation — September 12, 2026

The follow-up images were built from `9716fccf078d3f732029587882e9d61820c3ba0e`
plus the upstream-readiness changes, including precompressed assets. The
benchmark used ARM64 image ID
`sha256:d28d1d2b5afc90036a0138564f2e4b63c1c0cfd82ee6bcd0d22c945055675ea4`.
The final cleanup rebuild is
`sha256:eef91b44695f3564f6f09fee985a00bc0feb4b1bc9842117b8bf71fd27055fd3`.
These are local image identities, **not** published multi-platform digests.
All 890 application files matched byte-for-byte between the two images,
excluding the generated npm SBOM. That inventory also matched after removing
its generated document namespace and creation timestamp (22 package entries).
The final rebuild passed the runtime, browser, and image-scan checks below.

- Node 26.8.2 passed 2,967 tests with one existing skip. Node 24.20.0 passed
  the ordinary suite and all 14 additional allocation tests.
- The OCI build, hardened runtime checks, shutdown, and cache-persistence
  tests passed. Brotli/gzip round-trip and HTTP negotiation tests passed,
  including unchanged identity responses, cache headers, and no compression
  of runtime configuration.
- Chrome for Testing 152.0.7977.75 on macOS/Metal passed the image's first-run
  smoke test: all four choices, Explore, visible attribution, 12 rendered
  globe tiles, 303 sampled colors, no lost graphics context, no local asset
  errors, and no conversation uploads.
- Grype 0.118.0 scanned the exported OCI image using the release policy. The
  refreshed database was built at `2026-09-12T06:27:25Z`. The scan passed with
  zero actionable matches and 21 report-only matches, including the same four
  unfixed High/Critical findings listed below. This was an ARM64 scan, not a
  new AMD64 scan or a renewal of the historical VEX proposals.
- A fresh scanner positive control against `pkg:npm/lodash@4.17.20` failed
  with exit code 2 and two fixable High findings. That package was not added
  to the project. Reporting unfixed issues still does not bypass fixable ones.
- The dependency-managed Buildx 0.37.1, Cosign 3.1.3, and Grype 0.118.0 images
  were pulled and their binaries checked on Linux ARM64. Workflow linting,
  metadata parser tests, and installer cleanup tests passed. Formatting and
  package-boundary checks passed too. The revised tool installation path still needs
  its own hosted Actions run; local tests cannot establish hosted publication.

The [container/development benchmark](PERFORMANCE.md#container-versus-npm-run-dev)
records its own scope and repeatable procedure. Local reports and screenshots
are generated under ignored `output/`; they are not all committed here.

### Historical fork publication — not the canonical deployment

The previous hosted pipeline **did** pass on the test fork at commit `9716fcc`:
[historical fork run 34694764029](https://github.com/northcutted/gods-eye-view/actions/runs/34694764029).
Its published index is
`sha256:157d8afc9a895882eaa832c8a99003e8be7dd15317b609f4b221007d63abd76d`.
That image was pulled anonymously and its SLSA provenance independently verified.
Interactive Chrome checks exercised real map imagery, navigation to London,
NVG, flights, earthquakes, satellites, contacts, and cockpit view. Search needed
a Google key; AIS had no key; mapped installations and terrain were not fully
validated. Paid-provider accounts, voice, and NAS deployments remain outside
that check. These results establish a working fork publication, not an upstream
package or a successful hosted run of the uncommitted changes above.

### How the upstream-readiness review was done

This was an AI-assisted implementation review and local validation, performed
with Codex. It was not a repository-wide security audit. The source comparison
used upstream `aacfa06a311f9eac2fe3cb37533ef08e43a3c7ac` and fork HEAD
`9716fccf078d3f732029587882e9d61820c3ba0e`, plus the uncommitted container changes.
The image identities above identify the tested builds more precisely than the
HEAD commit alone.

1. **Review the additions from an upstream maintainer's perspective.** Compare
   the fork's deployment changes with upstream, then inspect the Dockerfile,
   Compose example, standalone server, shared provider handlers, workflow, and
   dependency manifests together. Restore upstream CODEOWNERS, remove stale
   npm script permissions and fork-specific deployment defaults, and keep
   GitHub Release/CD automation out of this PR. Preserve the existing
   development and Pinokio paths rather than replacing their setup.
2. **Follow each dependency to the place it is actually selected.** An action's
   commit pin does not update a tool version passed through its inputs. Move
   Buildx, BuildKit, Cosign, Grype, and the SBOM scanner into literal,
   digest-pinned image references that Dependabot can read. Include nested
   composite actions in its update paths. Derive the container workflow's
   Node version and base-signature target from the root Dockerfile instead of
   maintaining duplicate values. Node major upgrades remain intentional.
3. **Exercise the runtime contract, not just the health endpoint.** Build an
   OCI image and test non-root execution, absent shell/npm, read-only app files,
   writable persistent cache, public-only browser configuration, disabled
   credential-writing/conversation-log routes, and graceful shutdown. Then
   open the actual image in Chrome and check startup, controls, attribution,
   and rendered globe geometry. Unit tests separately cover compressed and
   uncompressed responses, caching, and unchanged runtime configuration.
4. **Check that safeguards can fail.** Parser tests reject missing, floating,
   duplicate, or incompatible tool pins and exercise simulated dependency
   updates. Installer tests use a mock Docker executor to check binary paths,
   executable permissions, and cleanup after a failed copy; actual pinned tool
   binaries were checked separately on Linux ARM64. The scanner's vulnerable
   package control still fails on fixable High findings. Earlier browser
   validation also deliberately withheld application JavaScript and failed
   despite a healthy HTTP endpoint. These controls have different scopes and
   do not substitute for a fresh hosted workflow run.
5. **Measure the performance claim rather than assume it.** Use the same
   browser application source and lockfile for development and the container,
   isolate credentials and caches, alternate run order, and retain every
   measured sample. Compare seven-run medians only after all rendering checks
   pass. The [benchmark method](PERFORMANCE.md#container-versus-npm-run-dev)
   explains fixture interception, excluded costs, failed harness trials, and
   the difference between launcher readiness and fully loaded live terrain.
6. **Keep conclusions tied to their evidence.** Scan the final image itself,
   retain unfixed findings, and distinguish them from inactive VEX proposals.
   Compare the final rebuild's application bytes and dependency inventory with
   the benchmarked image. Record local ARM64 results separately from the older
   hosted multi-platform publication; do not call the new workflow verified
   merely because its predecessor passed.

The measured improvement is in page delivery: 8.9% less time to the launcher
and 86.8% fewer transferred page-asset bytes in this controlled comparison.
The container's median frame rate was about 1 FPS lower, so there is no rendering
speedup claim. The maintenance improvement is explicit update coverage and
tested dependency selection, not proof that Dependabot has already opened or
merged an update PR. Distroless reduces shipped tools; signed provenance helps
verify build origin; scans report known vulnerabilities. None replaces the
others, access controls, or timely operator-managed updates.

## Original deployment and policy validation

The following is the historical record prepared on 2026-09-11 (America/Chicago), with
the follow-up VEX assessment, gate-policy checks, and browser testing on
2026-09-12 UTC. It records what was tested at
that time, not a promise about later images. The hosted run was
`34670683699`, for commit `6457653e511d9edaf12bf13d0acf92ec28335039`.
Its historical test subject (fork registry, not a deployment example) is
`ghcr.io/northcutted/gods-eye-view@sha256:969fcb52b1707d884bdf1aaa65df62a34323e2c9e39a9f0ba073b13bc40bd30a`.
For setup and everyday commands,
start with [Run the globe with Docker](CONTAINERS.md).

## What works locally?

The checks confirm that the app starts without a shell or npm, runs without
root privileges, serves the built app, keeps its code read-only, and retains
its cache across container replacement. Only the intended public browser keys
and the disabled conversation-logging setting are exposed by runtime
configuration. It also shuts down cleanly when Docker
asks it to stop.

<details>
<summary>Test counts, tool versions, and build evidence</summary>

- The full ordinary suite passed on Node 26.8.2 and Node 24.20.0: 2,936 passed,
  one existing skip per runtime. Both allocation test files passed under Node 24
  (14 additional tests). Node 26 intentionally skips the allocation probes.
  On macOS, these runs used `TMPDIR=/private/tmp` to avoid an existing fixture
  path comparison between `/var` and its canonical `/private/var` location.
- The adopted formatting and package boundary checks passed; the existing Vite
  browser build and the new container bundle both built. Existing large-browser-
  chunk warnings remain.
- Podman built and ran an OCI image. Pinned BuildKit 0.32.2 and Buildx 0.37.1
  also built an OCI archive with maximum provenance and the pinned SBOM scanner.
- Runtime tests passed as UID/GID 65532, with read-only root, all capabilities
  dropped, no network, a writable cache mount, no shell/npm, runtime-only public
  configuration, disabled setup/source routes, and clean SIGTERM shutdown.
- The distroless multi-platform base signature verified against Google's
  `keyless@distroless.iam.gserviceaccount.com` identity and issuer
  `https://accounts.google.com`.
- Both AMD64 and ARM64 BuildKit artifacts contain 97 runtime SBOM package
  entries, 449 builder SBOM entries, and SLSA v1 BuildKit provenance. The runtime inventory
  identifies Node, `ws`, `connect`, and `sirv`. The builder inventory also records
  npm, Vite, and esbuild. Package entries can include duplicate source/inventory
  observations; these counts are not unique-component counts.
- `npm audit --omit=dev` reported zero known npm vulnerabilities. This does not
  cover the operating-system libraries below.

</details>

## Did the built app work in a browser?

Yes, after fixing an asset-packaging bug. The first browser run found that
Cesium's engine and supporting files were copied outside the directory shipped
in the image. The HTTP health check passed, but the globe could not start.
The build now keeps those files in the right directory and fails if required
Cesium assets are missing. Both architecture runtime checks also request the
engine and styles from the running server.

The rebuilt ARM64 image passed the new browser check locally with Chrome for
Testing 152.0.7977.75, selected by the locked Puppeteer package, on macOS/Metal:

- The keyless app started, showed all four first-run choices and visible
  attribution, and opened Explore without offering the development key panel.
- Cesium drew globe geometry with no lost graphics context or local asset
  failures. The recorded run rendered 12 tiles and 318 distinct sampled colors.
  The first-run and Explore screenshots were inspected as well.
- No conversation records were uploaded. Separate runtime tests confirmed
  that conversation-log routes, including case and path aliases, return 404
  and do not create `.gev-logs`. Unit tests confirmed development logging still
  works and production skips uploads.
- A negative control withheld the built application JavaScript. The browser
  test failed as expected, even though the container remained healthy.
- A real build-context test excluded AppleDouble and `__MACOSX` fixtures while
  retaining an ordinary public asset. The temporary source fixtures were removed.

This is an offline startup/rendering check: external services return simulated
unavailable responses, and map tiles use a tiny fixture. It does not validate
live data, real map imagery, external fonts, microphone access, or performance.
GitHub's AMD64/software-rendering check subsequently passed in the hosted fork
pipeline; this local run itself was ARM64 only.
The hardened runtime and cache-persistence checks also passed on the rebuilt
ARM64 image; this follow-up did not regenerate the historical SBOM/VEX evidence
or rescan the new image. A release needs fresh evidence for its own digest.

See [how to run the browser check](CONTAINERS.md#run-the-container-browser-check-locally)
for commands and report locations. CI retains its screenshots, image identity,
container logs, and JSON results as browser-test artifacts for 14 days.

## What did the vulnerability scan find?

The image includes libraries from Debian, the Linux distribution underneath
Node. Grype, our image vulnerability scanner, found the following issues in
both architecture builds. A **release gate** is simply an automated check that
must pass before a build is promoted to a release tag.

Grype 0.118.0 scanned both final platform images against its then-current database.
The original all-findings High/Critical threshold failed with these findings:

| Advisory                                                                     | Scanner severity | Installed package                    | Reported fix state            |
| ---------------------------------------------------------------------------- | ---------------- | ------------------------------------ | ----------------------------- |
| [CVE-2026-5450](https://security-tracker.debian.org/tracker/CVE-2026-5450)   | Critical         | `libc6 2.41-12+deb13u3`              | `wont-fix`, no fixed version  |
| [CVE-2026-5928](https://security-tracker.debian.org/tracker/CVE-2026-5928)   | High             | `libc6 2.41-12+deb13u3`              | `wont-fix`, no fixed version  |
| [CVE-2026-5435](https://security-tracker.debian.org/tracker/CVE-2026-5435)   | High             | `libc6 2.41-12+deb13u3`              | `wont-fix`, no fixed version  |
| [CVE-2026-85091](https://security-tracker.debian.org/tracker/CVE-2026-85091) | High             | `zlib1g 1:1.3.dfsg+really1.3.1-1+b1` | `not-fixed`, no fixed version |

The exact base image is pinned by its content fingerprint (digest):
`sha256:f7e3539249fa844f7019255d3ed1acb5faf626006607a602f8a24d59f0a97c6c`.
It was the current nonroot Node 26 Debian 13 index when resolved for this work.

At the time of this assessment, Debian treated the three glibc issues as minor,
with no dedicated stable security update planned. Its tracker also marked the
installed zlib package vulnerable. The scanner's labels above describe the
packages; they do not demonstrate an attack against God's Eye View.

The follow-up [VEX assessment](CONTAINER-VEX.md) found evidence that the tested
app does not use the affected operations. It proposes four narrow exceptions,
with the image identities, native inspection, and debugger tests recorded.
It also keeps Debian's zlib package separate from the copy inside Node.

**Those VEX proposals are not approved, signed, or enabled.** Separately, the
release policy now blocks only High/Critical findings with a reported fix.
`wont-fix`, `not-fixed`, and unknown fix states remain in the JSON report and
are counted in the Actions summary, without blocking. This accepts the risk of
unfixed issues; it does not certify them as harmless or alter this historical
assessment. A signed build record does not fix a library either.

## Did we test the fixable-only policy?

Yes. We rescanned the same AMD64 and ARM64 images with Grype 0.118.0, using
`--only-fixed --fail-on high` and the workflow's `.github/grype.yaml` config.
These checks reused the database built on 2026-09-11 at 06:29:40 UTC so we could
compare policy behavior without changing the underlying vulnerability data.

- Both images passed. Each report retained all 20 original findings in
  `ignoredMatches`, including the four High/Critical findings above.
- Removing `--only-fixed` from the ARM64 scan restored the expected failure
  (exit code 2). The issues did not disappear; only their release handling changed.
- Scanning the test package reference `pkg:npm/lodash@4.17.20` with the new policy
  still failed (exit code 2), with two High findings that had fixed versions.
  This was a scanner control, not a dependency added to the app.
- A missing scan input failed (exit code 1). The workflow's summary step correctly
  counted the real reports and rejected missing, empty, malformed, and wrong-shape
  reports instead of showing a clean result.

The explicit YAML config also replaces `/dev/null`, which this Grype version
rejects as an unsupported config file. No package or advisory ignore rules were
added. The hosted Actions run passed with zero actionable findings. Its complete
scan reports are retained as workflow artifacts.

## Did we check the Compose examples?

Yes. Docker Compose 5.5.1 parsed and validated the local setup, a custom host
port with a fixture environment file, and an image-only setup using an existing
proxy network and cache volume. Assertions confirmed the non-root user,
read-only files, privilege restrictions, resource limits, and health check
were preserved in all three.

These were configuration checks, not a deployment of a proxy or a migration
of live data. The retained VEX trace hashes also matched; the documentation
changes did not replace the underlying evidence.

## What still needs follow-up?

- **Run the revised workflow on the fork.** Its new dependency-managed tool
  installation and both architecture builds need fresh hosted verification
  before calling these exact changes release-tested.
- **Versioned publication.** Main and commit tags have been exercised. A stable
  semver tag also updates `latest`; prereleases do not. Application releases and
  deployment automation remain a separate follow-up, with no GitHub Release
  creation job in this PR.
- **Keep release evidence current.** CI generates scans and build evidence for
  every candidate. The inactive VEX assessment stays historical; reproduce and
  review it for an exact release only if an exception is to be activated.
- **Enforce review rules.** Check main-branch, required-check, and release-tag
  protections in the publishing repository. CODEOWNERS alone does not enforce them.
- **Check package visibility.** Anonymous fork pulls passed. A newly created
  upstream package may still need its visibility set to public.
- **Broader deployment testing.** Paid-provider accounts, voice/microphone,
  different GPUs, and NAS-specific deployments still need testing.

Re-run the image scan after every base/dependency update; this record is a dated
snapshot, not a permanent assertion about either vulnerability status or SBOM
contents. See [deployment and verification instructions](CONTAINERS.md).
