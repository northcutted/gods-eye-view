# 🐳 Run the globe with Docker

**One app container. No API keys required to get started.** Docker runs the
server; your browser renders the globe. You do not need Node or npm installed
on the Docker host.

The included [compose.yaml](../compose.yaml) is both a working setup and a
commented guide. Start with its defaults, then adapt the image, port, keys, and
network to your own stack.

**[Quick Start](#-quick-start) · [Keys](#-add-optional-keys) · [Your Stack](#-add-it-to-your-stack) · [Updates](#-update-or-roll-back) · [Under the Hood](#-under-the-hood)**

## ⚡ Quick Start

You need a checkout of this repository and Docker with **Compose 2.24 or newer**.
Check with `docker compose version`. Run these commands from the repository
root, where `compose.yaml` lives:

```sh
docker compose up --build -d
docker compose ps
```

Open **http://localhost:8080**. The first build downloads its dependencies;
later builds can reuse local build layers. The app starts with its keyless
providers, just like the terminal setup.

**Release status:** this guide currently starts by building your checkout.
The first hosted image release has not been verified yet. Release checks block
High/Critical findings when a fix is available; unfixed findings are reported
without blocking. Local builds are available for testing, not as signed
releases. See [what we tested](CONTAINER-VALIDATION.md).

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
2. Choose the image. For a published release, set `GEV_IMAGE` to its verified
   digest and remove `build`. For a local build, point `build.context` at
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

## 🔄 Update or roll back

For a local source build, after updating your checkout:

```sh
docker compose up --build -d
```

For a published release, first verify the image as described below. An image
**digest** is its content fingerprint: unlike a tag such as `main`, it always
identifies the same image bytes. Set this in your private `.env`, replacing
the placeholder with the verified release digest:

```dotenv
GEV_IMAGE=ghcr.io/northcutted/gods-eye-view@sha256:REPLACE_WITH_VERIFIED_DIGEST
```

Then:

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

The [workflow](../.github/workflows/container.yml) is designed to produce
SLSA Build L3 provenance. **That claim still needs a successful hosted build
and independent verification.** Local builds do not get a GitHub-signed
attestation merely because they use the same Dockerfile.

<details>
<summary>Build and signing details — for maintainers and security reviewers</summary>

The Dockerfile pins the Node builder, distroless runtime, and Dockerfile frontend
by digest. Release builds verify Google's distroless signature. Dependencies
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

Main releases use `main` and `sha-COMMIT`. Version tags such as `v0.1.1` also
publish that version; stable releases update `latest`, prereleases do not.
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
IMAGE=ghcr.io/northcutted/gods-eye-view@sha256:REPLACE_WITH_VERIFIED_DIGEST
slsa-verifier verify-image "$IMAGE" \
  --source-uri github.com/northcutted/gods-eye-view \
  --source-tag v0.1.1 --print-provenance
docker buildx imagetools inspect "$IMAGE" --format '{{json .SBOM}}'
docker buildx imagetools inspect "$IMAGE" --format '{{json .Provenance}}'
```

For a main build, use `--source-branch main` instead of `--source-tag`. Check
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
to `v*` release tags. No repository rulesets were present during the initial
validation; adding workflow files does not enable those protections.

Dependabot proposes npm, Docker, and action updates weekly. Also review the
workflow's explicit BuildKit/scanner image digests and Buildx, Cosign, and Grype
versions; updating an action does not automatically update all its inputs.
Recheck Node 26 and distroless support as part of normal maintenance.

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
