# 🧪 What we tested

**The local container and hosted release pipeline passed.**
Application tests, runtime safety checks, and a first-run browser check passed.
The original scan found four
unfixed High/Critical library issues. Under the current fixable-only policy,
those are reported without blocking. The published image and GitHub-signed
provenance were verified for the merge recorded below.

This is the validation record prepared on 2026-09-11 (America/Chicago), with
the follow-up VEX assessment, gate-policy checks, and browser testing on
2026-09-12 UTC. It records what was tested at
that time, not a promise about later images. The hosted run was
`34670683699`, for commit `6457653e511d9edaf12bf13d0acf92ec28335039`.
Its multi-platform index is
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
GitHub's AMD64/software-rendering run is configured but has not run locally.
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

- **Versioned release.** The verified `main` run published the `main` and
  commit-SHA tags. A semver tag will additionally publish `latest` and create
  a GitHub Release with the exact image references and evidence files attached.
- **Keep evidence current.** Re-run the scan and refresh the VEX assessment
  after every base or dependency update. The hosted run used the exact CI Node
  24.14.0 and Node 26.8.2 checks.
- **Enforce review rules.** The repository had no rulesets during this
  validation. CODEOWNERS are supplied, but review, required-check, and
  release-tag protections still need enforcement in GitHub.
- **Check package visibility.** This package is currently public and anonymous
  pulls succeeded. New packages may still need their visibility set to public.
- **Check real-world use.** The browser smoke check covers offline first-run
  startup and rendering, not paid/live provider accounts, real imagery, or a
  full visual acceptance review. NAS-specific deployments still need testing.

Re-run the image scan after every base/dependency update; this record is a dated
snapshot, not a permanent assertion about either vulnerability status or SBOM
contents. See [deployment and verification instructions](CONTAINERS.md).
