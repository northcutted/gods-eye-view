#!/usr/bin/env node
/** First-run smoke test of a built image, with Chrome outside the container. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';

// A tiny, opaque PNG is enough to exercise imagery decoding and globe rendering.
// It is a fixture, not a live map. No external provider requests leave the page.
const TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0o8AAAAASUVORK5CYII=',
  'base64',
);

export function browserResponse(url, origin, { negativeControl = false } = {}) {
  const target = new URL(url);
  if (['data:', 'blob:'].includes(target.protocol)) return null;
  if (target.origin === origin) {
    if (negativeControl && /^\/assets\/.*\.js$/.test(target.pathname)) {
      return { status: 200, contentType: 'application/javascript', body: '' };
    }
    // Exercise these real runtime routes, rather than simulating their behavior.
    if (
      !target.pathname.startsWith('/api/') ||
      /^\/api\/(?:setup(?:\/|$)|realtime\/debug-log(?:\/|$))/.test(
        target.pathname,
      )
    ) {
      return null;
    }
  } else if (
    target.hostname === 'tile.openstreetmap.org' &&
    /\.png$/.test(target.pathname)
  ) {
    return {
      status: 200,
      contentType: 'image/png',
      body: TILE,
      headers: { 'Access-Control-Allow-Origin': '*' },
    };
  }
  // Includes Esri metadata: deliberately exercise the existing keyless OSM fallback.
  return {
    status: 503,
    contentType: 'application/json',
    body: '{"error":"Unavailable in offline container smoke test"}',
    headers: { 'Access-Control-Allow-Origin': '*' },
  };
}

export async function runBrowserSmoke(
  url,
  { artifacts, negativeControl = false },
) {
  const origin = new URL(url).origin;
  await mkdir(artifacts, { recursive: true });
  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 30_000,
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      (await puppeteer.executablePath()),
    // Match the existing browser harnesses: Metal on macOS, software in Linux CI.
    // Neither mode makes this smoke test a performance benchmark.
    args: [
      '--no-sandbox',
      ...(process.platform === 'darwin'
        ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
        : [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
          ]),
      '--disable-dev-shm-usage',
    ],
  });
  const page = await browser.newPage();
  const pageErrors = [];
  const assetFailures = [];
  const conversationUploads = [];
  const result = {
    url,
    negativeControl,
    providerMode: 'offline-fixtures',
    rendererMode: process.platform === 'darwin' ? 'metal' : 'swiftshader',
    browserVersion: await browser.version(),
    passed: false,
  };
  try {
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (
        /initialization failed|An error occurred while rendering/.test(
          message.text(),
        )
      )
        pageErrors.push(message.text());
    });
    page.on('response', (response) => {
      const target = new URL(response.url());
      if (
        target.origin === origin &&
        !target.pathname.startsWith('/api/') &&
        response.status() >= 400
      ) {
        assetFailures.push(`${response.status()} ${target.pathname}`);
      }
    });
    page.on('requestfailed', (request) => {
      const target = new URL(request.url());
      if (target.origin === origin && !target.pathname.startsWith('/api/')) {
        assetFailures.push(`Network failure ${target.pathname}`);
      }
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const target = new URL(request.url());
      if (
        target.pathname === '/api/realtime/debug-log' &&
        request.method() === 'POST'
      )
        conversationUploads.push(target.pathname);
      const response = browserResponse(request.url(), origin, {
        negativeControl,
      });
      void (response ? request.respond(response) : request.continue()).catch(
        (error) => pageErrors.push(error.message),
      );
    });
    await page.goto(`${origin}/?welcome=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    console.log(
      'Browser loaded the container document; waiting for application startup.',
    );
    await page.waitForFunction(
      () => Boolean(window.__godsEyeView?.voiceCommands),
      { timeout: negativeControl ? 10_000 : 60_000 },
    );
    await page.waitForSelector('#first-run-launcher.visible', {
      visible: true,
      timeout: 30_000,
    });
    console.log('Application started and the first-run launcher is visible.');
    const initial = await page.evaluate(() => ({
      config: globalThis.__GEV_CONFIG__,
      choices: [...document.querySelectorAll('[data-first-run-choice]')].map(
        (element) => element.dataset.firstRunChoice,
      ),
      keyPanelAbsent:
        !document.querySelector('#key-setup-chip') &&
        !document.querySelector('#key-setup'),
      creditsVisible: Boolean(
        document
          .querySelector('#cesium-credits .cesium-credit-expand-link')
          ?.getBoundingClientRect().height,
      ),
      loadingHidden: document
        .querySelector('#loading-screen')
        ?.classList.contains('hidden'),
      developmentScripts: [...document.scripts].some((script) =>
        /\/(?:src\/main\.js|@vite\/client)/.test(script.src),
      ),
    }));
    result.initial = initial;
    assert.deepEqual(initial.config, {
      googleApiKey: '',
      cesiumToken: '',
      realtimeDebugLogging: false,
    });
    assert.deepEqual(initial.choices.sort(), [
      'contacts',
      'environmental',
      'explore',
      'space-missions',
    ]);
    assert.equal(initial.keyPanelAbsent, true);
    assert.equal(initial.creditsVisible, true);
    assert.equal(initial.loadingHidden, true);
    assert.equal(initial.developmentScripts, false);
    await page.screenshot({ path: path.join(artifacts, 'first-run.png') });

    await page.click('[data-first-run-choice="explore"]');
    await page.waitForFunction(
      () => !document.querySelector('#first-run-launcher.visible'),
      { timeout: 15_000 },
    );
    // Pull back from the default city view so a uniform fixture tile cannot
    // fill the entire canvas. This checks globe rendering, not live geography.
    await page.evaluate(() => {
      const { viewer } = window.__godsEyeView;
      viewer.camera.flyHome(0);
      viewer.scene.requestRender();
      viewer.render();
    });
    await page.waitForFunction(
      () => window.__godsEyeView.viewer.scene.globe.tilesLoaded,
      { timeout: 30_000 },
    );
    const globe = await page.evaluate(() => {
      const { viewer } = window.__godsEyeView;
      viewer.scene.requestRender();
      viewer.render();
      const canvas = viewer.scene.canvas;
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      // Read the displayed canvas, not whichever intermediate framebuffer
      // Cesium's post-processing happened to leave bound in WebGL.
      const probe = document.createElement('canvas');
      probe.width = 64;
      probe.height = 40;
      const context = probe.getContext('2d');
      context.drawImage(canvas, 0, 0, probe.width, probe.height);
      const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
      const colors = new Set();
      for (let i = 0; i < pixels.length; i += 4)
        colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      return {
        alive: !viewer.isDestroyed(),
        shown: viewer.scene.globe.show,
        contextLost: gl.isContextLost(),
        width: canvas.width,
        height: canvas.height,
        sampledColors: colors.size,
        renderedTiles: viewer.scene.globe._surface._tilesToRender.length,
      };
    });
    result.globe = globe;
    assert.equal(globe.alive, true);
    assert.equal(globe.shown, true);
    assert.equal(globe.contextLost, false);
    assert.ok(globe.width > 0 && globe.height > 0);
    assert.ok(globe.renderedTiles > 0, 'Cesium must draw globe geometry');
    assert.ok(
      globe.sampledColors > 8,
      'Canvas must contain a rendered scene, not a flat blank image',
    );
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(assetFailures, []);
    assert.deepEqual(
      conversationUploads,
      [],
      'Production must not upload conversation logs',
    );
    result.passed = true;
    await page.screenshot({ path: path.join(artifacts, 'explore.png') });
    console.log(
      'PASS: built container boots keyless, shows first-run choices, opens Explore, and renders globe geometry without conversation uploads.',
    );
  } catch (error) {
    result.error = error.message;
    await page
      .screenshot({ path: path.join(artifacts, 'failure.png') })
      .catch(() => {});
    throw error;
  } finally {
    try {
      await writeFile(
        path.join(artifacts, 'result.json'),
        `${JSON.stringify({ ...result, pageErrors, assetFailures, conversationUploads }, null, 2)}\n`,
      );
    } finally {
      await browser.close();
    }
  }
}

async function main() {
  const [image, ...args] = process.argv.slice(2);
  if (!image || args.some((arg) => arg !== '--negative-control')) {
    throw new Error(
      'Usage: node scripts/test-container-browser.mjs IMAGE [--negative-control]',
    );
  }
  const engine = process.env.CONTAINER_ENGINE || 'docker';
  const run = (...command) =>
    execFileSync(engine, command, {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });
  // Resolve a mutable tag once: the running container uses these exact local bytes.
  const inspected = JSON.parse(run('image', 'inspect', image))[0];
  assert.equal(inspected.Config.User, '65532:65532');
  const name = `gev-browser-test-${randomUUID()}`;
  const artifacts = path.resolve(
    process.env.GEV_BROWSER_ARTIFACTS_DIR || 'output/container-browser',
  );
  await mkdir(artifacts, { recursive: true });
  const volume = `${name}-cache`;
  run('volume', 'create', volume);
  let id;
  try {
    id = run(
      'create',
      '--name',
      name,
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--pids-limit=128',
      '--memory=1g',
      '--publish=127.0.0.1::8080',
      `--volume=${volume}:/app/.gev-cache`,
      '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=16m',
      '--env=GOOGLE_MAPS_API_KEY=',
      '--env=CESIUM_ION_TOKEN=',
      '--env=OPENAI_API_KEY=',
      inspected.Id,
    ).trim();
    run('start', id);
    const portMapping = run('port', id, '8080/tcp').trim();
    assert.match(portMapping, /^127\.0\.0\.1:\d+$/);
    const url = `http://${portMapping}`;
    let healthy = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const response = await fetch(`${url}/healthz`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          healthy = true;
          break;
        }
      } catch {
        /* Wait for the container's HTTP listener. */
      }
      await delay(250);
    }
    assert.ok(healthy, 'Container must become healthy before launching Chrome');
    await writeFile(
      path.join(artifacts, 'image.json'),
      `${JSON.stringify({ requestedImage: image, imageId: inspected.Id, repoDigests: inspected.RepoDigests }, null, 2)}\n`,
    );
    await runBrowserSmoke(url, {
      artifacts,
      negativeControl: args.includes('--negative-control'),
    });
  } finally {
    try {
      if (id) {
        try {
          await writeFile(
            path.join(artifacts, 'container.log'),
            run('logs', id),
          );
        } finally {
          run('rm', '--force', id);
        }
      }
    } finally {
      // Only remove the uniquely named test volume created above.
      run('volume', 'rm', volume);
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}
