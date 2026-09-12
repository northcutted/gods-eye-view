# 🧪 What we tested

**The local container builds and runs. The release checks are not all green.**
Application tests and runtime safety checks passed, but four library findings
still block release. No published image or GitHub-signed build has been verified.

This is the validation record prepared on 2026-09-11 (America/Chicago), with
the follow-up VEX assessment on 2026-09-12 UTC. It records what was tested at
that time, not a promise about later images. For setup and everyday commands,
start with [Run the globe with Docker](CONTAINERS.md).

## What works locally?

The checks confirm that the app starts without a shell or npm, runs without
root privileges, serves the built app, keeps its code read-only, and retains
its cache across container replacement. Only the intended public browser keys
are exposed by runtime configuration. It also shuts down cleanly when Docker
asks it to stop.

<details>
<summary>Test counts, tool versions, and build evidence</summary>

- The full ordinary suite passed on Node 26.8.2 and Node 24.20.0: 2,931 passed,
  one existing skip per runtime. Both allocation test files passed under Node 24
  (14 additional tests). Node 26 intentionally skips the allocation probes.
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

## What's holding up the release?

The image includes libraries from Debian, the Linux distribution underneath
Node. Grype, our image vulnerability scanner, found the following issues in
both architecture builds. A **release gate** is simply an automated check that
must pass before a build is promoted to a release tag.

Grype 0.118.0 scanned both final platform images against its then-current database.
The High/Critical threshold failed with the following findings:

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

**Those proposals are not approved, signed, or enabled.** The release remains
blocked pending review and release-specific validation. A signed build record
tells you where an image came from; it does not fix a library or make a
vulnerability finding disappear.

## Did we check the Compose examples?

Yes. Docker Compose 5.5.1 parsed and validated the local setup, a custom host
port with a fixture environment file, and an image-only setup using an existing
proxy network and cache volume. Assertions confirmed the non-root user,
read-only files, privilege restrictions, resource limits, and health check
were preserved in all three.

These were configuration checks, not a deployment of a proxy or a migration
of live data. The retained VEX trace hashes also matched; the documentation
changes did not replace the underlying evidence.

## What still needs a real release run?

- **Build and verify on GitHub.** No Git commit, push, release, registry
  publication, or GitHub signing run was performed. Validate the hosted
  workflow and verify its published digest with
  `slsa-verifier` before claiming a released Build L3 artifact.
- **Run the exact CI versions.** GitHub CI pins Node 24.14.0 for the allocation
  baseline; local Node 24 checks used the installed 24.20.0. The exact hosted
  baseline still needs its CI run.
- **Enforce review rules.** The repository had no rulesets during this
  validation. CODEOWNERS are supplied, but review, required-check, and
  release-tag protections still need enforcement in GitHub.
- **Check download access.** A newly created GHCR package may need its
  visibility set to public before anonymous users can pull it.
- **Check real-world use.** The smoke checks do not exercise paid/live
  provider accounts or establish a browser-level visual acceptance result.

Re-run the image scan after every base/dependency update; this record is a dated
snapshot, not a permanent assertion about either vulnerability status or SBOM
contents. See [deployment and verification instructions](CONTAINERS.md).
