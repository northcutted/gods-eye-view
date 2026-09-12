# 🐳 Run the globe with Docker

**One app container. No API keys required to get started.** Docker runs the
server; your browser renders the globe. You do not need Node or npm installed
on the Docker host.

The included [compose.yaml](../compose.yaml) is both a working setup and a
commented guide. Start with its defaults, then adapt the image, port, keys, and
network to your own stack.

**[Quick Start](#-quick-start) · [Keys](#-add-optional-keys) · [Your Stack](#-add-it-to-your-stack) · [Updates](#-update-or-roll-back) · [Under the Hood](#-under-the-hood)**

## 🎯 Why a container?

Pinokio makes desktop installation approachable, and `npm run dev` is the right
tool when you are editing the app. This adds a third option: running a built
application as a service on a Docker host, home server, or NAS.

- **Build once, run those bytes.** The image includes the compiled app and server.
  Starting it does not install npm packages or compile JavaScript. A digest lets
  you deploy or roll back to the same image on another machine.
- **Less software in production.** The distroless Node 26 runtime has no shell,
  npm, or package manager. Build tools stay in the builder. The default deployment
  runs as a non-root account and cannot rewrite its own application files.
- **Efficient asset delivery.** Browser code is bundled and minified; large static
  assets have Brotli/gzip copies prepared during the build. Hashed bundles can be
  cached, while HTML and runtime configuration stay refreshable. There is no
  development transform server or hot-reload connection in production.
- **An inspectable supply chain.** Signed build records link the image to its
  source and workflow. Dependency inventories and vulnerability reports help
  maintainers identify what needs updating before promoting an image.

These are deployment benefits, not a different globe engine. The browser still
does the rendering, and the same provider handlers serve live data. Distroless
does not make JavaScript faster or eliminate vulnerabilities. Compression adds
some build time and image storage in exchange for less network transfer.
See the [benchmark and its limits](PERFORMANCE.md#container-versus-npm-run-dev).

## ⚡ Quick Start

You need a checkout of this repository and Docker with **Compose 2.24 or newer**.
Check with `docker compose version`. Run these commands from the repository
root, where `compose.yaml` lives. Add this line to your private `.env`, keeping
any existing settings:

```dotenv
GEV_IMAGE=ghcr.io/bilawalsidhu/gods-eye-view:latest
```

```sh
docker compose pull app
docker compose up -d --no-build app
docker compose ps
```

Open **http://localhost:8080**. Docker downloads the prebuilt app; there is
nothing to compile locally. The app starts with its keyless providers, just
like the terminal setup. `latest` is the easy default and moves after verified
builds. It is not a promise that the app has reached a stable release.

**Canonical image:** `ghcr.io/bilawalsidhu/gods-eye-view`, published from
[`bilawalsidhu/gods-eye-view`](https://github.com/bilawalsidhu/gods-eye-view).
All published-image examples in this guide use that upstream identity. These
pull commands become available when upstream enables container publication.
Until then, build locally as below. The dated
[validation record](CONTAINER-VALIDATION.md) includes historical fork tests;
those are not evidence that a canonical upstream image has been published.

### Build from your checkout

Leave `GEV_IMAGE` unset in your shell and `.env` (or set it to
`gods-eye-view:local`), then run:

```sh
docker compose up --build -d
```

The first build downloads its dependencies; later builds can reuse local
layers. Do not use `--build` with the published image address: it would label
your local build with that address instead of running the downloaded image.

### The commands you'll use most

```sh
# See whether the app is running and healthy.
docker compose ps

# Follow the server logs. Ctrl+C stops following, not the container.
docker compose logs --tail=100 -f app

# Check your Compose settings without printing their resolved values.
docker compose config --quiet

# Stop the app but keep its container and saved cache.
docker compose stop

# Start it again.
docker compose up -d

# Remove the container and its Compose network, but keep the saved cache.
docker compose down
```

Do not add `--volumes` to `down` unless you mean to delete the saved cache
**and its provider usage counter**. Review logs before sharing them; never
paste your `.env` or a full resolved Compose configuration into a public issue.

Server-side voice conversation logs are disabled in the deployed app. The
browser does not send those records, and `/api/realtime/debug-log` is not
registered. Ordinary process messages still appear in `docker compose logs`;
there is no `.gev-logs` volume to configure. This does not change the local
development server's conversation logging or your voice provider's policies.

### Port 8080 already taken?

Add `GEV_HTTP_PORT=9090` to your existing `.env` (or create it), then run
`docker compose up -d`. Open **http://localhost:9090**.

The app still listens on port 8080 _inside_ Docker. Only the port on your
machine changes. The default address, `127.0.0.1`, keeps direct access on the
Docker host rather than opening it to your network.

## 🔑 Add optional keys

**Keys are upgrades, not prerequisites.** Use [.env.example](../.env.example)
as the list of supported settings. Put the keys you want in a private `.env`
beside `compose.yaml`; if you already have that file, edit it rather than
overwriting it. Keep it out of Git.

Then recreate the app so it receives the new values:

```sh
docker compose up -d --force-recreate app
```

A plain `restart` does not load changed environment settings. You do not need
to rebuild the image when a key changes.

**Different from the development setup:** the container does not save keys
through the in-app POWER UP panel. Its key-saving routes are disabled. Use
`.env` or your stack's environment settings instead. Keys in your host shell
are not automatically passed through by this Compose file.

Google Maps and Cesium ion credentials are intentionally sent to the browser.
Restrict their allowed sites and APIs at the provider. Other provider credentials
stay in the server environment. Environment variables are not a secret vault:
people with administrative access to Docker can inspect them.

Compose fixes the internal `HOST`, `PORT`, and cache path, overriding any
development values in `.env`, such as `PORT=4173`. `GEV_HTTP_PORT` changes
the host-facing port. Development-only `VITE_*` settings are not runtime
configuration for the built container.

## 🧩 Add it to your stack

There is no database or sidecar to add. You need the app service, its cache
volume, and outbound access to the live data providers.

### Using an existing Compose project

1. Copy the `app` service and the top-level `cache` volume declaration from
   [compose.yaml](../compose.yaml) into your stack. Rename them if those names
   are already taken, updating the service's volume reference too.
2. Choose the image. Use `ghcr.io/bilawalsidhu/gods-eye-view:latest` for easy
   updates, or a verified digest to pin exact bytes. Set `GEV_IMAGE` and remove
   `build` for a published image. For a local build, point `build.context` at
   this repository, not at your other stack's directory.
3. Point `env_file` at the app's private environment file, or use your stack's
   existing environment mapping. Relative paths are resolved from the Compose
   file's location.
4. Keep the non-root user, read-only filesystem, cache mount, temporary mount,
   and health check. The comments explain what each one does.

Do not mount the repository over `/app`, add a shell startup command, or
mount the Docker socket. The image already has the built application and its
startup command.

### Putting it behind your existing proxy

A reverse proxy is the service that receives requests for your domain and
passes them to the app. Use it for **HTTPS and authentication** before sharing
this installation. God's Eye View has no built-in login, and someone who can
reach its APIs can consume your provider quotas.

The commented network example in `compose.yaml` is for a proxy that already
runs in Docker:

1. Uncomment the service's `networks` section and the matching top-level
   `networks` section. Set `name` to your proxy's existing Docker network.
2. Set the proxy's upstream to **`http://gods-eye-view:8080`**. That name is the
   network alias in the example; keep it unique on the shared network.
3. Serve the app at the root of its hostname, such as `https://globe.example.com/`,
   not under a path like `/globe/`. Forward all routes, including `/api/*`,
   and enable WebSocket forwarding.
4. Remove the app's `ports` block if all access should go through that proxy.

Inside a proxy container, `localhost` means the **proxy itself**, not this app.
Docker services on the same network communicate through their internal ports;
they do not need a published host port.
[Docker's networking guide](https://docs.docker.com/compose/how-tos/networking/)
covers shared networks in more detail.

If your proxy runs directly on the Docker host instead, keep the loopback
port mapping and point it at `http://127.0.0.1:8080` (or your chosen host port).

Keep outbound internet access enabled. An isolated, internal-only Docker network
would prevent the server from reaching providers. Set spending limits and
quotas at those providers too: app throttles are not billing caps, and requests
behind a proxy currently share that proxy's per-IP throttle bucket.
See [the security model](../SECURITY.md).

### Keep the cache when you move

The named volume stores cached provider data and **TomTom's daily usage
counter**. It survives container replacement and ordinary `docker compose down`.
Docker normally prefixes its name with your Compose project name.

Changing the project name or moving the service into another stack can create
a fresh volume. Use `docker volume ls` to identify the original, then follow
the commented `external` volume example in Compose to attach that exact
volume. Take a backup before moving state; do not assume a fresh volume
contains your previous usage history.

A new Docker-managed volume gets the image's cache-directory ownership. If you
prefer a host-directory bind mount, prepare it for UID/GID `65532:65532`;
a permissions error is not a reason to run the app as root.
See [Docker's volume guide](https://docs.docker.com/engine/storage/volumes/).

Start with **one app instance**. Its usage counters are not a shared,
transactional budget across replicas, even if several instances share files.

### Running on a NAS

Use the same image and safety settings on a Synology or another Linux NAS.
When a verified image is available, pulling it is usually more practical
than compiling the app on the NAS. Import the Compose project into your NAS's
container manager, set `GEV_IMAGE` to `ghcr.io/bilawalsidhu/gods-eye-view:latest`
(or a verified digest), and remove `build`.
Keep the default entrypoint; you do not need a terminal or npm inside the image.

- **Check the Compose version, not just the Docker version.** Our optional
  `.env` syntax needs Compose 2.24+. If the NAS's project importer rejects it,
  update Compose or replace `env_file` with the manager's explicit environment
  settings. A keyless installation can omit `env_file` altogether.
- **Prefer the named cache volume.** It avoids many shared-folder ownership
  surprises. If you choose a host folder, grant UID/GID `65532:65532` access to
  that specific cache folder, including any NAS ACLs. Do not change the
  container to the NAS administrator's account or make the folder world-writable.
- **Loopback means the NAS, not your laptop.** The default published port is
  reachable on the NAS itself. Use its authenticated HTTPS reverse proxy for
  access from your other devices, following the proxy instructions above.
- **Voice needs a secure browser connection.** A page opened from an ordinary
  `http://NAS-IP:8080` address cannot request microphone access. HTTPS is needed
  for remote devices; browsers treat local `localhost` access specially.
  See [microphone access requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#privacy_and_security).
- **Moving source from a Mac?** Prefer a Git checkout. The build excludes
  AppleDouble (`._*`) and `__MACOSX` metadata alongside `.DS_Store`, so these
  transfer artifacts do not become application assets.

These are configuration guidelines, not a claim that this image has been
tested on every NAS model or container-manager version.

## 🔄 Update or roll back

For the default published `latest` image, update with:

```sh
docker compose pull app
docker compose up -d --no-build app
```

Pulling downloads the newer image; `up` replaces the running container while
keeping its cache. Updates are not installed automatically.

For a local source build, leave `GEV_IMAGE` unset or set to
`gods-eye-view:local`, then update your checkout and run:

```sh
docker compose up --build -d
```

### Pin a build or roll back

For exact version control, first verify the image as described below. An image
**digest** is its content fingerprint: unlike a tag such as `latest`, it always
identifies the same image bytes. Set this in your private `.env`, replacing
the placeholder with the verified release digest:

```dotenv
GEV_IMAGE=ghcr.io/bilawalsidhu/gods-eye-view@sha256:REPLACE_WITH_VERIFIED_DIGEST
```

Use the digest from a verified `bilawalsidhu/gods-eye-view` publication. Then:

```sh
docker compose pull app
docker compose up -d --no-build app
docker compose ps
```

`--no-build` makes sure you run the downloaded image, not a new local build.
To roll back, set `GEV_IMAGE` to a previously verified digest and run the same
commands. Keep the cache volume. If you later return to source builds, remove
`GEV_IMAGE` first so your local build does not use a release image reference.

### Something isn't working?

| What you see                                 | What to check                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| Docker cannot connect to its daemon          | Start Docker Desktop or your Docker service.                                     |
| Port is already allocated                    | Set `GEV_HTTP_PORT` to an unused host port.                                      |
| A key change has no effect                   | Recreate the container; do not just restart it.                                  |
| Permission denied for `/app/.gev-cache`      | Check the volume or bind-mount ownership, not just the environment value.        |
| The image has no `sh`, `bash`, or `curl`     | That's expected. Use logs and the Node health check below.                       |
| Healthy container, but a feed is unavailable | Health checks cover the local server, not provider accounts, quotas, or outages. |

To run the built-in check yourself, without a shell inside the image:

```sh
docker compose exec app /nodejs/bin/node /app/server/standalone/healthcheck.mjs
```

A successful check exits with code zero. The check is also available as HTTP
`GET /healthz`. Docker marks failures as unhealthy; `restart: unless-stopped`
does **not** automatically restart a still-running unhealthy container.

## 🛡️ Under the hood

You do not need to change these settings to run the app. They are here so
operators and contributors can inspect how the image is built and protected.

**Distroless** means the runtime image includes Node and its required libraries,
without a shell, npm, or package manager. Build tools live in a separate build
stage and are not copied into the running image. The server starts directly
with Node; it does not install dependencies or rebuild itself at startup.

Fewer installed tools means fewer unnecessary components to patch and fewer
ready-made utilities available to an attacker. It also means there is no
`docker exec ... sh` troubleshooting session: use process logs and the Node
health check. Node and its libraries still need updates, and a compromised Node
process can still access anything its permissions and network allow.
See [the distroless project's rationale](https://github.com/GoogleContainerTools/distroless#why-should-i-use-distroless-images).

Compose runs it as a non-root user, keeps application files read-only, removes
extra Linux privileges, and limits server memory, CPU, and process counts.
Only the persistent cache and a small disposable `/tmp` are writable. The app
has up to ten seconds to drain requests; Compose allows 15 seconds before
forcing a stop. Other deployment tools should keep that grace period and use
HTTP `/healthz` for their probes.

### What comes with a release?

| Term              | What it tells you                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **OCI image**     | The standard container format understood by Docker and other compatible tools. Its labels record source, version, license, and base image.  |
| **SBOM**          | A software bill of materials: an inventory of the dependencies in the image and the tools used to build it.                                 |
| **Provenance**    | A build record connecting an image to its source and build process. A signature helps you check who issued that record.                     |
| **SLSA Build L3** | Requirements for build isolation and trustworthy build records. It does not mean an app is free of vulnerabilities.                         |
| **VEX**           | An evidence-backed explanation of whether a particular vulnerability affects a particular product. It is not a general-purpose ignore list. |

The [workflow](../.github/workflows/container.yml) uses the SLSA project's
isolated container provenance generator for Build L3. A hosted fork build and
independent verification have passed. This helps a consumer detect an image
that did not come from the expected repository, commit, or workflow. It is not
a code audit, a vulnerability-free guarantee, or independent certification of
every repository control. The builder, signer, and GitHub platform remain trust
assumptions; maintainers must protect publishing branches and tags.
Local builds do not acquire GitHub-signed provenance by using the same Dockerfile.

### Reading the GitHub Actions checks

There are two workflows in the Actions tab:

- **Application checks** tests the app on Node 24 and 26, builds its browser
  assets, and checks the Windows installation path used by Pinokio.
- **Container build and release** checks the container and, for eligible runs,
  publishes images to GitHub Container Registry. It does not deploy the app
  to your server or restart your containers.

The container workflow has two paths. Pull requests and manual runs on
non-default branches build and test without publishing. Runs on the default
branch (`main`) and supported version-tag pushes take the release path.

| Job in Actions                                      | What it does                                                                                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Check application**                               | Runs formatting, package import-boundary checks, and unit tests on each listed Node version.                                                        |
| **Choose build-only or publishing**                 | Reads the dependency pins, sets the image name and version, and decides which path this run can take. Application checks follow this job.           |
| **Test container without publishing**               | Builds and tests an image on AMD64 and ARM64, without uploading it to the registry. This is the build-only path.                                    |
| **Build, test, and scan image**                     | Builds each architecture, uploads a temporary staging image with its dependency inventory and build records, then tests and scans that exact image. |
| **Assemble multi-platform image**                   | Joins the tested AMD64 and ARM64 images under one reference so Docker can select the right architecture.                                            |
| **Sign build provenance (SLSA)**                    | Calls the isolated signing workflow to attach a signed record of where the build came from.                                                         |
| **Verify evidence and publish image tags**          | Checks the signed build record and attached inventories, then gives the verified image its tags. Uploads the verification evidence for inspection.  |
| **Create draft GitHub Release (version tags only)** | Uses the Git tag as the release version. Creates editable release notes and attaches the verified image evidence and scans after publishing.        |

On a pull request, skipped release jobs are expected. On a release run, the
build-only job is skipped instead. If a check fails, later jobs on that path
do not proceed. Open the failed job and step to see which check needs attention.
The draft-release job is skipped for branch builds, including manual runs on
main. This does not prevent normal container publishing.

A **staging image** is a candidate uploaded for testing, not an approved release.
Only the final verification job assigns tags such as `main`, a version, or
`latest`; it does not rebuild the image. The vulnerability step blocks
High/Critical findings with available fixes and reports the others, as described
below. A green PR run does not mean the signing and publishing path has run.

If branch protection already requires checks by their old names, update those
required-check selections to match the names above after the renamed checks run.
Changing workflow labels does not update repository protection settings.

### Prepare a GitHub Release when you're ready

Push a version tag to prepare a GitHub Release. Branch pushes, scheduled builds,
and manual runs on main publish images only; there is no separate version input.

1. Create and push a version tag, such as `v1.2.3`, on the commit you intend to
   release. The tag must include the container workflow. Push one release tag
   at a time; do not move it afterward.
2. Wait for **Container build and release** to pass its checks, scans, and
   provenance verification. It uses the Git tag verbatim: `v1.2.3` becomes
   release **v1.2.3**, container tag **`:v1.2.3`**, and OCI image version
   **`v1.2.3`**. The same version is recorded in `release.json`.
3. Follow **Draft release ready** in the Actions summary. Add your usual
   highlights, screenshots, and upgrade notes above the container section,
   review the generated changelog, and publish the release when ready.

This builds the tagged commit, not whichever commit happens to be on main
when the workflow finishes. The tag must already exist and resolve to the
tested commit; the workflow never creates or moves a Git tag. The image version
is published before the draft is created, so a draft failure does not undo a
successful image publication.
A version such as `v1.2.3-rc.1` creates a prerelease draft and does not move
the container's `latest` tag. An ordinary main build later can still move
`latest`, so use the explicit prerelease tag or digest to test that build.

The container section lists published tags, the Git commit SHA, the image
digest, and AMD64/ARM64 manifest digests. Downloads include `release.json`,
both SBOMs, BuildKit and signed SLSA provenance, both complete scan reports,
`VERIFYING.md`, and checksums. `release.json` is an index of references, not a
replacement for signed provenance. Registry evidence remains attached too.

Existing releases are not rewritten. If an asset upload fails, use **Re-run
failed jobs**: the same draft job can upload missing files from that exact
build without replacing notes or existing assets. A different build, altered
asset, or already-published release is left unchanged and requires manual
review. Use a new Git tag for a new release. Only this tag-only job
gets permission to write releases; it has no image-build or signing role.

GitHub Releases and the container's `latest` tag are separate: publishing notes
does not control which image `latest` points to, and nothing here deploys the
app to users' servers. Full application-release/CD coordination can follow
later. See GitHub's [tag-triggered workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#push)
and [draft release support](https://cli.github.com/manual/gh_release_create).

### Run the container browser check locally

This is a contributor check, not a requirement for running the app. It needs
Node/npm on the test machine because Chrome runs **outside** the app container:

```sh
npm ci --ignore-scripts
npx --no-install puppeteer browsers install chrome
docker build -t gods-eye-view:browser-check .
npm run test:container:browser -- gods-eye-view:browser-check
```

The script starts a temporary container with the normal non-root/read-only
restrictions and a loopback-only random port. It checks the keyless startup,
first-run choices, Explore button, visible attribution, and rendered globe
geometry. It also checks that production does not upload conversation logs.
The temporary container and its test cache volume are removed afterward;
your existing app container and cache are not used.

Reports and screenshots go to `output/container-browser/`. Set
`GEV_BROWSER_ARTIFACTS_DIR` to keep runs in separate directories, or
`CONTAINER_ENGINE=podman` to use Podman. `PUPPETEER_EXECUTABLE_PATH` can select
an already-installed compatible Chrome instead of downloading one.

External provider calls get simulated unavailable responses, while OSM tile
requests receive a tiny local fixture image. This exercises the keyless map
fallback without keys, paid calls, or live-feed dependencies. It is **not** a
live-data, typography, geographic-accuracy, or performance acceptance test.
Linux CI uses software rendering; local macOS uses Metal.

To check that the test catches broken startup, add `--negative-control` after
the image name. That deliberately withholds the built application JavaScript
and **must fail**, even though the container's HTTP health check still passes.

The workflow runs this check on AMD64 for both PR validation and releases,
before release promotion. Both AMD64 and ARM64 retain their runtime checks.
Chrome for Testing is installed only on the test runner; neither Chrome nor
Puppeteer is added to the distroless runtime. Actions retains browser screenshots
and diagnostic reports for 14 days, including failures after the test starts.

<details>
<summary>Build and signing details — for maintainers and security reviewers</summary>

The Dockerfile pins the Node builder and distroless runtime by digest. The
frontend comes from the pinned BuildKit image. Release builds verify Google's
signature on the exact base read from that Dockerfile. Dependencies
come from the committed npm lockfile with installation scripts disabled.
The compilation step runs without network access, and `.dockerignore` excludes
local credentials and generated files from the build input.

Compilation uses the builder's native CPU; the JavaScript and assets work on
both AMD64 and ARM64. The runtime has the browser assets, server bundle, CCTV
configuration, licenses, and dependency metadata, but no runnable
`node_modules` tree. The bundled `ws` client has native accelerators disabled.
Package metadata under `/app/third-party` lets SBOM tools identify bundled
dependencies; it does not mean every upstream file is shipped.

Pull requests build and test both architectures without publishing or signing
permissions. Trusted main/tag builds use standard GitHub-hosted runners,
pinned Buildx/BuildKit, and no shared build cache. The sequence is:

1. Build each platform image with BuildKit `mode=max` provenance and SPDX SBOMs
   for the runtime and builder. Push temporary staging tags, then test and
   scan those exact image digests.
2. Join the platforms in one OCI index—the multi-platform image reference—while
   keeping the build records and SBOMs attached.
3. Call the SLSA project's isolated `generator_container_slsa3.yml@v2.1.0`
   workflow to create and sign provenance. The image-build job has no OIDC
   signing permission; the signing identity comes from the separate workflow.
4. On a fresh runner, verify source repository, branch/tag, commit, calling
   workflow, provenance, and SBOMs before assigning release tags to that digest.

The signed SLSA record covers the index digest, which in turn covers the
platform images and attached BuildKit records. Those BuildKit records are not
individually signed. BuildKit's `mode=max` alone does not establish Build L3.

The SLSA generator uses a full version tag because its official verifier
requires that identity; ordinary actions use pinned commit hashes. The generator
and GitHub's runner isolation are explicit trust assumptions. See the
[official container integration](https://github.com/slsa-framework/slsa-github-generator/tree/v2.1.0/internal/builders/container)
and [SLSA requirements](https://slsa.dev/spec/v1.2/build-requirements).

Main builds publish `latest`, `main`, and `sha-COMMIT`. Supported Git version
tags publish that exact version, such as `v0.1.1`, and prepare a draft release.
Stable version builds update `latest`; prerelease builds do not. Therefore
`latest` means the most recently promoted default-branch or stable-version
build, not necessarily the latest GitHub Release or highest version number.
Only tag builds create a draft GitHub Release; the maintainer chooses the Git
tag and publishes the notes. Image updates do not restart deployments.
The Actions summary prints copyable pull commands, the full multi-platform digest
and the separate AMD64/ARM64 manifest digests.
Weekly main builds exercise the pipeline but do not update pinned dependencies.
Temporary `build-RUN-ATTEMPT-ARCH` staging tags can remain after a failed check:
they are not approved releases.

High/Critical scanner findings block promotion **when Grype reports an available
fix**. We use `only-fixed: true`: `wont-fix`, `not-fixed`, and unknown fix states
are report-only. Here, Grype's `fixed` state means a fixed package version is
available, not that the version in our image is already safe.

The Actions summary shows High/Critical counts by fix state. Its JSON artifact
keeps actionable findings in `matches` and report-only findings in
`ignoredMatches`, including why they were filtered. Lower-severity findings are
also retained. Scanner errors still fail the build. See
[Grype's fix-availability filtering](https://oss.anchore.com/docs/guides/vulnerability/filter-results/).

This is **risk acceptance based on fix availability**, not a claim that an
unfixed issue is harmless. It also is not an approved VEX exception: the
[VEX assessment](CONTAINER-VEX.md) remains separate evidence. Each new scan
checks availability again, so a new fix can turn a report-only finding into a
blocker. A valid build signature does not fix vulnerabilities or provide login.

</details>

### Verify a published image

This is an operator check for a published release, not a prerequisite for
trying the local build. Install the official `slsa-verifier` (v2.7.1 or newer)
and Docker Buildx, then replace the digest and version below with your release:

```sh
IMAGE=ghcr.io/bilawalsidhu/gods-eye-view@sha256:REPLACE_WITH_VERIFIED_DIGEST
slsa-verifier verify-image "$IMAGE" \
  --source-uri github.com/bilawalsidhu/gods-eye-view \
  --source-tag v0.1.1 --print-provenance
docker buildx imagetools inspect "$IMAGE" --format '{{json .SBOM}}'
docker buildx imagetools inspect "$IMAGE" --format '{{json .Provenance}}'
```

Use the actual upstream digest and build ref. For a main build, use
`--source-branch main` instead of `--source-tag`. Versioned releases always
use their Git tag. The generated `VERIFYING.md` selects the right flag for its
build; `release.json` records the source ref. Check
the expected commit in `invocation.configSource.digest.sha1` and the expected
caller `.github/workflows/container.yml` too; the repository name alone does
not tell you that you have the intended release.

GitHub keeps the `container-evidence-COMMIT` artifact and scanner reports for
90 days. Evidence also stays attached in the registry. When backing up or
mirroring releases, preserve the multi-platform index, images, build records,
SBOMs, and Sigstore objects together. A single-platform export or ordinary
`docker save` can lose parts of that trail.

<details>
<summary>Publishing your own fork and maintaining the pipeline</summary>

Canonical publication runs in `bilawalsidhu/gods-eye-view` and targets
`ghcr.io/bilawalsidhu/gods-eye-view`. The workflow derives its image name and
source identity from the repository running it, so a fork publishes only to
its own namespace. Fork maintainers testing their own images must use that
fork's image address and matching `--source-uri`; ordinary upstream deployments
use the canonical references above. Historical fork digests must not be
substituted into the upstream verification example.

Standard GitHub-hosted runners are free for public repositories. This workflow
uses those runners, the repository's short-lived `GITHUB_TOKEN` for GHCR, and
keyless signing rather than a stored signing key or personal access token.
Storage/retention and private-repository usage have their own billing rules:
see [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
and [GHCR access control](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
A new GHCR package may need its owner to set visibility to public before
anonymous pulls work.

Before treating published tags as approved releases, enforce CODEOWNERS
review and passing checks on main, prevent force pushes, and restrict changes
to `v*` release tags. Check those settings in the publishing repository;
adding workflow files does not enable those protections.

Dependabot opens update PRs weekly; it does not merge them or update running
containers. Its coverage includes:

- npm dependencies and the lockfile, including browser/build test tools.
- The Node builder and distroless runtime in the root `Dockerfile`.
- Buildx, BuildKit, Cosign, Grype, and the SBOM scanner in
  `.github/container-tools/Dockerfile`. This small file is a dependency manifest,
  not an extra application image. `scripts/container-toolchain.mjs` reads its
  digest pins and installs the tools only on disposable Actions runners.
- Actions and the reusable SLSA workflow, including actions nested in the local
  browser-test composite action.

The container workflow's Node 26 version and base-signature target follow the root Dockerfile,
so an update cannot leave a second hard-coded copy behind. The Dockerfile
frontend comes from the pinned BuildKit image. Node major upgrades are a
deliberate maintainer decision: keep builder and distroless runtime aligned,
then update the contract tests. Recheck Node 26's support lifecycle too.

Review update PRs and their checks before merging. Weekly main builds rescan
the pinned inputs against fresh vulnerability data; they do not silently
upgrade packages. Newly published images still need an operator-controlled
deployment. Never delete registry attestations merely to tidy the package list.

Contributors with Node installed can test a locally built image with:

```sh
docker build -t gods-eye-view:check .
node scripts/test-container.mjs gods-eye-view:check
```

The script creates and removes its own test container and volume. It checks
non-root execution, no shell/npm, read-only app files, writable/persistent
cache, public-only browser configuration, disabled setup routes, and clean
shutdown. For Podman, build with `podman build --format oci` and set
`CONTAINER_ENGINE=podman` when running the script.

For a Node-only check, `npm run build:container && npm start` runs the generated
bundle. The usual `npm run dev` and `npm run build` remain development workflows.

</details>
