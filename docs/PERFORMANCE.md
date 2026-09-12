# Performance baseline

This page records one hardware-rendered Apple M5 comparison captured on 22
August 2026 in Chrome 150 at 1440 x 900. It is not a minimum hardware
specification and should not be used to predict performance on untested systems.
The original capture artifacts are not included here, so this page records
results rather than defining a runnable benchmark.

## Test context

The baseline was captured on 22 August 2026 with these conditions:

| Setting | Value |
| --- | --- |
| Renderer | Apple M5 Metal through the hardware ANGLE path |
| Browser | Chrome 150 in a fresh isolated profile |
| Viewport | 1440 x 900 at device pixel ratio 1 |
| Focus | Page foregrounded for controlled scenes |
| Scene sample | 5 seconds of scripted motion, then 5 seconds at rest |
| Startup | Browser cache disabled; three samples |

The capture covered three startup samples, 16 cold layer scenarios with 14
measurements, 23 controlled option and stress scenes, and five
hardware-rendered overlay scenes.

## Startup

| Sample | App ready | Initial settle | Load event | Motion / rest | Used JS heap |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 784.980 ms | 2,035.082 ms | 439.5 ms | 60 / 60 FPS | 102.9 MiB |
| 2 | 604.849 ms | 1,855.836 ms | 442.4 ms | 60 / 60 FPS | 111.6 MiB |
| 3 | 558.527 ms | 1,809.592 ms | 438.8 ms | 60 / 60 FPS | 105.1 MiB |
| Median | 604.849 ms | 1,855.836 ms | 439.5 ms | 60 / 60 FPS | 105.1 MiB |

The initial-settle measurement is the more useful launch reference because it
includes the first visual and data settling window. All three samples reached
the display ceiling during both motion and rest.

## Cold layer activation

Cold activation was measured separately from warm option switching. Live object
counts are included so that future runs can compare source populations before
attributing a difference to the client.

| Layer | Activation | Source count | Motion / rest | Used JS heap |
| --- | ---: | ---: | ---: | ---: |
| CCTV city | 19,608.240 ms | 48 | 60 / 60 FPS | 192.7 MiB |
| Space Missions (report label: Rocket missions) | 3,581.066 ms | 26 | 60 / 60 FPS | 131.3 MiB |
| Radio | 3,458.709 ms | 750 | 60 / 60 FPS | 124.8 MiB |
| Bikeshare | 2,069.498 ms | 633 | 60 / 60 FPS | 157.4 MiB |
| Datacenters | 817.693 ms | 4,362 | 59.6 / 60 FPS | 328.2 MiB |
| Flights | 667.671 ms | 247 | 60 / 60 FPS | 118.4 MiB |
| Submarine cables | 614.727 ms | 2,629 | 60 / 60 FPS | 412.0 MiB |
| Military Flights | 557.113 ms | 68 | 60 / 60 FPS | 118.4 MiB |

CCTV had the largest cold activation cost in this capture. Submarine cables
used the most heap, followed by datacenters. Completed single-layer samples
generally reached 60 FPS, so activation time and heap separate these cases more
clearly than steady-state frame rate.

## Aircraft, detection, and Cockpit

| Scene | Motion / rest |
| --- | ---: |
| Idle globe | 60 / 60 FPS |
| Flights, 2D | 60 / 60 FPS |
| Flights, 3D proximity | 60 / 60 FPS |
| Flights, all 3D models | 60 / 60 FPS |
| Military Flights, all 3D models | 60 / 60 FPS |
| Detection at 25% | 39.3 / 41.1 FPS |
| Detection at 50% | 37.4 / 39.8 FPS |
| Detection at 100% | 34.4 / 35.5 FPS |
| Cockpit | 49.6 / 49.2 FPS |

The clean detection scenes processed 8,169 to 8,170 observations. Selected
labels rose from 14 at 25% density to 28 at 50% and 56 at 100%. The aircraft
rows came from an earlier loaded, foreground-controlled pass because the clean
rerun received no live aircraft rows.

## Visual styles and combined stress

| Scene | Motion / rest |
| --- | ---: |
| Normal | 60 / 60 FPS |
| CRT (report label: Retro) | 60 / 60 FPS |
| NVG (report label: Surveillance) | 60 / 60 FPS |
| FLIR (report label: Thermal) | 49 / 60 FPS |
| Anime | 60 / 59.8 FPS |
| Noir | 47 / 56.6 FPS |
| Snow | 42.3 / 45.8 FPS |
| Combined static | 57.6 / 60 FPS |
| Combined operational | 39.9 / 43.1 FPS |

The combined static scene rendered 11,575 objects, used 872.2 MiB of JavaScript
heap, and issued 48,665 text draws during motion and 54,106 at rest. The combined
operational sample contained 3,909 observations and two selected labels, but its
live aircraft and traffic rows were empty, so it remains a limited stress case.

Snow, Noir, dense detection, and text-heavy combined layers are the clearest
controlled comparison points for later optimization work.

## Keyed live sources

NASA FIRMS, AISStream, and TomTom were captured in a separate hardware-rendered
pass. The page was visible but was not the focused window, so these frame rates
must not be compared directly with the foreground-controlled scenes above.

| Source | Point-in-time population | Activation or coverage | Motion / rest |
| --- | ---: | --- | ---: |
| NASA FIRMS | 100,430 detections in 3,557 cells | 30.0 s activation | 32.1 / 55.2 FPS |
| AISStream | 12,000 vessels | 6.4 s activation | 22.1 / 29.8 FPS |
| TomTom Traffic | 4,222 road dots | 70% coverage, 2 decoded tiles | 45.0 / 51.7 FPS |

These populations change continuously. A future comparison must record the
live counts again and match the focus conditions.

## Controls for a future capture

Use the same controls before attributing a difference to the application:

1. Record the exact GPU renderer and reject software-rendered or unavailable GPU
   strings.
2. Use a 1440 x 900 viewport at device pixel ratio 1 and keep the page focused.
3. Measure cache-disabled startup separately from cold layer activation and warm
   option switching.
4. Repeat startup three times and compare medians.
5. Sample each option for 5 seconds in scripted motion and 5 seconds at rest.
6. Record live object counts before attributing a difference to the client.
7. Treat a live-source outage as missing coverage, not as evidence of low client
   rendering cost.

## What is not established yet

- This report does not establish Windows performance.
- The report does not record machine memory capacity, so it cannot support a
  minimum-memory recommendation.
- The report does not cover other GPU renderers or viewport configurations.
- Military Installations is outside this comparison because it requires close
  camera context.
- The keyed pass has no controlled rerun suitable for comparison with the
  option scenes.

Use this page as a regression baseline for one known hardware and browser
configuration, not as a compatibility guarantee.

## Container versus npm run dev

This is a separate comparison on an Apple M1 Pro, not a rerun of the M5
baseline above. It compares the production container with the normal Vite
development server. Pinokio itself was not benchmarked: its installation,
launcher, and credential setup are different concerns.

The container bundles and minifies browser code and serves Brotli/gzip copies
prepared at build time. Development deliberately keeps source modules and hot
reload. Those choices can improve page delivery; distroless itself does not
accelerate Cesium or make live providers respond faster.

### September 12, 2026 results

Seven measured runs per mode, plus one unreported warm-up each, completed all
startup and globe-rendering checks. The [per-run evidence](benchmarks/container-vs-dev-2026-09-12.json)
keeps every measured sample, the image identity, source commit, tool versions,
and hardware details. These are medians, not best runs:

| Measurement | npm run dev | Container |
| --- | ---: | ---: |
| Visible, usable first-run launcher | 2,544 ms | 2,318 ms |
| Page-asset transfer | 34.15 MiB | 4.49 MiB |
| Page-asset requests | 216 | 24 |
| Load event | 654 ms | 578 ms |
| Browser JS heap estimate | 72.83 MiB | 41.67 MiB |
| Simple-globe motion | 58.8 FPS | 57.8 FPS |

The container reached the launcher **8.9% sooner** and transferred **86.8% fewer
page-asset bytes**. It was quicker to reach the launcher in all seven pairs.
There was **no frame-rate improvement**: the container's median was about
1 FPS lower. This supports a delivery/startup benefit, not a claim that Docker
improves rendering or every interaction.

Both used Node 26.8.2 and the browser application source at `9716fcc`, with the
container's precompression/server changes applied. Chrome 152.0.7977.75 used
Apple M1 Pro Metal on a 16 GiB Mac. Development ran natively; the ARM64 container
ran through Podman's Linux VM with the Compose-equivalent 2 CPU/1 GiB limits.
This practical local comparison does not isolate bundling, compression, runtime,
or VM overhead individually. It is not a network-throttled or Pinokio benchmark.
Fixture interception adds measurement overhead, especially to the development
mode's many requests. Treat timing differences as exploratory local results,
not a production latency guarantee; the transfer reduction is the clearer finding.

### How the comparison works

`npm run benchmark:container` runs an unreported warm-up for each server, then
seven samples per mode in alternating order. Each sample launches a fresh
Chrome process/profile, disables the HTTP cache, and uses a 1440 × 900 viewport
at device pixel ratio 1. Servers are already running; their process startup
and Vite's first dependency optimization are excluded.

Page-level provider requests use unavailable-response fixtures, with a tiny OSM
tile fixture. Application assets and Cesium geometry workers come from the real
servers. This avoids changes in live feed populations or provider latency.
The harness verifies that the launcher is visible and usable, opens Explore,
rejects a blank globe, and measures five seconds of scripted globe motion.
The fixture is not a map-quality or live-data test.

Startup means the visible first-run launcher and initialized application API,
not fully loaded real-world terrain. Transfer counts come from navigation and
page Resource Timing after load and launcher readiness; they exclude APIs,
external requests, and worker-internal imports. Byte totals include Chrome's
estimated response-header sizes. JS heap is a browser estimate, not server RSS,
container memory, or total device memory. Frame rates are useful only for the
recorded renderer and this simple scene.

Early harness trials stalled development ES-module workers under all-target
request interception. Those incomplete trials are not benchmark results. The
retained harness intercepts the page only and checks actual globe rendering;
it fails rather than counting a blank scene as fast. Screenshots, full frame
intervals, and failure diagnostics are written to ignored `output/` directories.

### Repeat it locally

This contributor check needs Node/npm and Chrome **outside** the container.
Use a clean checkout with no `.env`, Pinokio environment file, or inherited
provider keys. Build both modes from the same source and lockfile. On macOS or
Linux, install the locked tools and start the development server:

```sh
npm ci --ignore-scripts
npx --no-install puppeteer browsers install chrome
env -i PATH="$PATH" HOST=127.0.0.1 GEV_CACHE_DIR=.gev-cache \
  npm run dev -- --host 127.0.0.1 --port 4174 --strictPort
```

In another terminal, build and start a separate, keyless container. These names
are only for this disposable benchmark; do not reuse an existing app's volume:

```sh
docker build -t gods-eye-view:benchmark .
docker run --rm -d --name gev-benchmark \
  --read-only --user 65532:65532 --cap-drop=ALL \
  --security-opt=no-new-privileges --pids-limit=128 --memory=1g --cpus=2 \
  --tmpfs=/tmp:rw,noexec,nosuid,nodev,size=16m \
  --mount type=volume,source=gev-benchmark-cache,target=/app/.gev-cache \
  -p 127.0.0.1:4175:8080 gods-eye-view:benchmark
npm run benchmark:container -- \
  --dev-url http://127.0.0.1:4174 \
  --container-url http://127.0.0.1:4175 \
  --runs 7 --output output/container-benchmark
```

Keep the machine otherwise idle; do not run builds or tests during measurement.
`PUPPETEER_EXECUTABLE_PATH` can select an installed compatible Chrome. macOS uses
Metal; Linux defaults to software rendering, so do not compare its FPS with
hardware-rendered results. Podman users can substitute `podman` and build with
`--format oci`.

Afterward, stop the development server with Ctrl+C. Remove only this test
container and its disposable cache:

```sh
docker stop gev-benchmark
docker volume rm gev-benchmark-cache
```

Do not turn these local samples into a universal speed claim. A network-shaped
test, warm-cache visits, live layers, Windows, NAS hardware, server resource
profiling, and a separate Pinokio launch comparison would answer different
questions. No Lighthouse or Core Web Vitals result is claimed here.
