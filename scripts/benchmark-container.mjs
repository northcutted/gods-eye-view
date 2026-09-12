#!/usr/bin/env node
/** Compare serving modes, not provider speed. Run against isolated, keyless servers. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';
import { browserResponse } from './test-container-browser.mjs';

export function median(values) {
  assert.ok(values.length && values.every(Number.isFinite));
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function localOrigin(value) {
  const url = new URL(value);
  assert.ok(
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
    'Benchmark only loopback servers',
  );
  assert.equal(url.protocol, 'http:');
  assert.ok(
    !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash,
  );
  return url.origin;
}

export function summarize(samples) {
  return Object.fromEntries(
    ['dev', 'container'].map((mode) => [
      mode,
      Object.fromEntries(
        ['cold'].map((cache) => {
          const rows = samples.filter(
            (row) => row.mode === mode && row.cache === cache,
          );
          return [
            cache,
            Object.fromEntries(
              [
                'appReadyMs',
                'ttfbMs',
                'loadMs',
                'assetRequests',
                'assetWireBytes',
                'jsHeapBytes',
              ].map((key) => [key, median(rows.map((row) => row[key]))]),
            ),
          ];
        }),
      ),
    ]),
  );
}

async function launchBrowser() {
  return puppeteer.launch({
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      (await puppeteer.executablePath()),
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      ...(process.platform === 'darwin'
        ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
        : [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
          ]),
    ],
  });
}

async function measure(mode, origin, run, outputDirectory) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  const client = await page.createCDPSession();
  const errors = [];
  const consoleWarnings = [];
  try {
    await page.bringToFront();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('requestfailed', (request) => {
      const url = new URL(request.url());
      if (url.origin === origin && !url.pathname.startsWith('/api/'))
        errors.push(`${request.failure()?.errorText} ${url.pathname}`);
    });
    page.on('console', (message) => {
      if (['warn', 'error'].includes(message.type())) {
        consoleWarnings.push(message.text());
        if (consoleWarnings.length > 30) consoleWarnings.shift();
      }
    });
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (
        url.origin === origin &&
        !url.pathname.startsWith('/api/') &&
        response.status() >= 400
      ) {
        errors.push(`${response.status()} ${url.pathname}`);
      }
    });
    await page.setCacheEnabled(false);
    // Intercept the page only. Puppeteer's all-target interception can stall
    // Cesium's development ES-module worker imports before their first message.
    // Workers load real same-origin code and perform geometry calculations.
    client.on('Fetch.requestPaused', ({ requestId, request }) => {
      const fixture = browserResponse(request.url, origin);
      const responseHeaders =
        fixture &&
        Object.entries({
          'Content-Type': fixture.contentType,
          ...fixture.headers,
        }).map(([name, value]) => ({ name, value }));
      void (
        fixture
          ? client.send('Fetch.fulfillRequest', {
              requestId,
              responseCode: fixture.status,
              responseHeaders,
              body: Buffer.from(fixture.body).toString('base64'),
            })
          : client.send('Fetch.continueRequest', { requestId })
      ).catch((error) => errors.push(error.message));
    });
    await client.send('Fetch.enable', {
      patterns: [{ urlPattern: '*', requestStage: 'Request' }],
    });
    await page.evaluateOnNewDocument(() => {
      localStorage.clear();
      sessionStorage.clear();
      performance.setResourceTimingBufferSize(2000);
      const check = () => {
        const launcher = document.querySelector('#first-run-launcher.visible');
        if (
          window.__godsEyeView?.voiceCommands &&
          launcher?.getBoundingClientRect().height
        ) {
          window.__benchmarkReadyMs = performance.now();
        } else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
    const cache = 'cold';
    await page.goto(`${origin}/?welcome=1&benchmark=${cache}`, {
      waitUntil: 'load',
      timeout: 90_000,
    });
    await page.waitForFunction(
      () => Number.isFinite(window.__benchmarkReadyMs),
      { timeout: 60_000 },
    );
    // The same boundary is used for both servers: the visible, usable launcher.
    const timing = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      const assets = performance
        .getEntriesByType('resource')
        .filter((entry) => {
          const url = new URL(entry.name);
          return (
            url.origin === location.origin && !url.pathname.startsWith('/api/')
          );
        });
      const canvas = window.__godsEyeView.viewer.scene.canvas;
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      const extension = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        appReadyMs: window.__benchmarkReadyMs,
        ttfbMs: navigation.responseStart - navigation.requestStart,
        loadMs: navigation.loadEventEnd,
        assetRequests: assets.length + 1,
        assetWireBytes:
          navigation.transferSize +
          assets.reduce((sum, entry) => sum + entry.transferSize, 0),
        gpu: extension
          ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER),
        jsHeapBytes: performance.memory?.usedJSHeapSize || 0,
        googleKeyPresent: Boolean(
          window.__GOOGLE_MAPS_API_KEY__ || window.__GEV_CONFIG__?.googleApiKey,
        ),
        cesiumKeyPresent: Boolean(
          window.__CESIUM_ION_TOKEN__ || window.__GEV_CONFIG__?.cesiumToken,
        ),
      };
    });
    assert.equal(
      timing.googleKeyPresent,
      false,
      'Use a keyless benchmark server',
    );
    assert.equal(
      timing.cesiumKeyPresent,
      false,
      'Use a keyless benchmark server',
    );
    assert.ok(timing.appReadyMs > 0 && timing.loadMs > 0);
    delete timing.googleKeyPresent;
    delete timing.cesiumKeyPresent;
    const row = {
      mode,
      run,
      cache,
      browser: await browser.version(),
      ...timing,
    };
    await page.click('[data-first-run-choice="explore"]');
    await page.evaluate(() => {
      const { viewer } = window.__godsEyeView;
      viewer.camera.cancelFlight();
      viewer.camera.flyHome(0);
      viewer.scene.requestRender();
      viewer.render();
    });
    await page.waitForFunction(
      () => {
        const { viewer } = window.__godsEyeView;
        viewer.render();
        return viewer.scene.globe.tilesLoaded;
      },
      { timeout: 30_000 },
    );
    const rendered = await page.evaluate(() => {
      const { viewer } = window.__godsEyeView;
      viewer.render();
      const probe = document.createElement('canvas');
      probe.width = 64;
      probe.height = 40;
      const ctx = probe.getContext('2d');
      ctx.drawImage(viewer.scene.canvas, 0, 0, 64, 40);
      const pixels = ctx.getImageData(0, 0, 64, 40).data;
      const colors = new Set();
      for (let i = 0; i < pixels.length; i += 4)
        colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      return {
        tiles: viewer.scene.globe._surface._tilesToRender.length,
        colors: colors.size,
      };
    });
    assert.ok(
      rendered.tiles > 0 && rendered.colors > 8,
      'Reject a blank or broken globe',
    );
    assert.deepEqual(errors, []);
    row.rendered = rendered;
    row.motion = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const { viewer } = window.__godsEyeView;
          const start = performance.now();
          let last = start;
          let renders = 0;
          const intervals = [];
          const remove = viewer.scene.postRender.addEventListener(
            () => renders++,
          );
          function frame(now) {
            intervals.push(now - last);
            last = now;
            viewer.camera.rotateRight(
              0.0003 * (now - start > 0 ? intervals.at(-1) : 0),
            );
            viewer.scene.requestRender();
            if (now - start < 5000) requestAnimationFrame(frame);
            else {
              remove();
              resolve({
                durationMs: now - start,
                renders,
                framesPerSecond: (renders * 1000) / (now - start),
                frameIntervalsMs: intervals,
              });
            }
          }
          requestAnimationFrame(frame);
        }),
    );
    await page.screenshot({
      path: path.join(outputDirectory, `${mode}-${run}.png`),
    });
    console.log(
      `${mode} ${run} ${cache}: ready=${row.appReadyMs.toFixed(1)}ms, ${(row.assetWireBytes / 1048576).toFixed(2)} MiB, ${row.assetRequests} requests`,
    );
    return [row];
  } catch (error) {
    const workers = page.workers().map((worker) => worker.url());
    await page
      .screenshot({
        path: path.join(outputDirectory, `${mode}-${run}-failure.png`),
      })
      .catch(() => {});
    const state = await page
      .evaluate(() => {
        const scene = window.__godsEyeView?.viewer?.scene;
        return {
          url: location.href,
          ready: window.__benchmarkReadyMs,
          tilesLoaded: scene?.globe.tilesLoaded,
          tiles: scene?.globe._surface._tilesToRender.length,
          imagery: scene?.imageryLayers.length,
          height:
            window.__godsEyeView?.viewer.camera.positionCartographic.height,
          globeShow: scene?.globe.show,
          visible: document.visibilityState,
          renderLoop: window.__godsEyeView?.viewer.useDefaultRenderLoop,
          contextLost: scene?.context._gl.isContextLost(),
          terrain:
            window.__godsEyeView?.viewer.terrainProvider.constructor.name,
          queues: [
            '_tileLoadQueueHigh',
            '_tileLoadQueueMedium',
            '_tileLoadQueueLow',
          ].map((key) =>
            scene?.globe._surface[key]?.map((t) => ({
              level: t.level,
              state: t.state,
              terrain: t.data?.terrainState,
              mesh: !!t.data?.mesh,
            })),
          ),
        };
      })
      .catch(() => null);
    await writeFile(
      path.join(outputDirectory, `${mode}-${run}-failure.json`),
      JSON.stringify(
        { error: error.message, state, errors, consoleWarnings, workers },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    await browser.close();
  }
}

async function main() {
  const options = new Map();
  for (let i = 2; i < process.argv.length; i += 2) {
    assert.ok(
      ['--dev-url', '--container-url', '--runs', '--output'].includes(
        process.argv[i],
      ),
      'Unknown benchmark option',
    );
    assert.ok(process.argv[i + 1], 'Missing option value');
    options.set(process.argv[i], process.argv[i + 1]);
  }
  const origins = {
    dev: localOrigin(options.get('--dev-url')),
    container: localOrigin(options.get('--container-url')),
  };
  assert.notEqual(origins.dev, origins.container);
  const runs = Number(options.get('--runs') || 7);
  assert.ok(Number.isInteger(runs) && runs >= 3 && runs <= 30);
  const outputDirectory = path.resolve(
    options.get('--output') || 'output/container-benchmark',
  );
  await mkdir(outputDirectory, { recursive: true });
  const result = {
    generatedAt: new Date().toISOString(),
    methodology:
      'Alternating order; fresh disposable Chrome process/profile with disabled HTTP cache per sample; already-running servers; offline provider fixtures; 1440x900 DPR 1; 5 seconds of globe motion without live layers. Asset requests/bytes use navigation and page resource timing after load and visible launcher, excluding API, external and worker-internal requests; transferSize includes browser-estimated headers. Not a cold-server-process, warm-cache, Pinokio launcher, live-provider, server-memory, or Core Web Vitals audit.',
    host: {
      platform: os.platform(),
      arch: os.arch(),
      cpu: os.cpus()[0].model,
      memoryBytes: os.totalmem(),
      node: process.versions.node,
    },
    origins,
    runs,
    passed: false,
    samples: [],
  };
  try {
    // Prime both servers once so Vite dependency optimization is not mistaken for
    // a recurring cold-browser cost. These samples are deliberately not reported.
    for (const mode of ['dev', 'container'])
      await measure(mode, origins[mode], 'warmup', outputDirectory);
    for (let run = 1; run <= runs; run++) {
      for (const mode of run % 2
        ? ['dev', 'container']
        : ['container', 'dev']) {
        result.samples.push(
          ...(await measure(mode, origins[mode], run, outputDirectory)),
        );
      }
    }
    result.summary = summarize(result.samples);
    result.motionMedianFps = Object.fromEntries(
      ['dev', 'container'].map((mode) => [
        mode,
        median(
          result.samples
            .filter((row) => row.mode === mode && row.motion)
            .map((row) => row.motion.framesPerSecond),
        ),
      ]),
    );
    result.passed = true;
    console.log(
      JSON.stringify(
        { summary: result.summary, motionMedianFps: result.motionMedianFps },
        null,
        2,
      ),
    );
  } catch (error) {
    result.error = error.message;
    throw error;
  } finally {
    await writeFile(
      path.join(outputDirectory, 'results.json'),
      `${JSON.stringify(result, null, 2)}\n`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await main();
