import { access, mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as buildBrowser } from 'vite';
import { build as buildServer } from 'esbuild';
import { createBrowserViteConfig } from '../build/vite.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'out');
// Only our dedicated generated directory is replaced; ordinary dist is untouched.
await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, 'server/standalone'), { recursive: true });

await buildBrowser({
  ...createBrowserViteConfig({
    plugins: [
      {
        name: 'runtime-browser-configuration',
        transformIndexHtml: {
          order: 'post',
          handler: () => [
            {
              tag: 'script',
              attrs: { src: '/runtime-config.js' },
              injectTo: 'head-prepend',
            },
          ],
        },
      },
    ],
  }),
  root,
  configFile: false,
  envFile: false,
  // Also close Vite's default VITE_* exposure to inherited build environments.
  envPrefix: '__GEV_NO_BUILD_ENV__',
  // vite-plugin-cesium joins root and outDir itself; an absolute outDir doubles
  // the root and leaves Cesium outside the directory copied into the image.
  build: { outDir: 'out/dist', chunkSizeWarningLimit: 1500 },
});

// The plugin logs copy failures without failing the build. Missing engine,
// styles, workers, or data must be a build error, not a broken shipped globe.
for (const asset of [
  'Cesium.js',
  'Widgets/widgets.css',
  'Workers',
  'Assets',
  'ThirdParty',
]) {
  await access(path.join(out, 'dist/cesium', asset));
}

const result = await buildServer({
  absWorkingDir: root,
  entryPoints: ['server/standalone/index.mjs'],
  outfile: path.join(out, 'server/standalone/index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node26',
  format: 'esm',
  metafile: true,
  // ws optional native accelerators are neither needed nor shipped.
  external: ['bufferutil', 'utf-8-validate'],
  define: {
    'process.env.WS_NO_BUFFER_UTIL': '"1"',
    'process.env.WS_NO_UTF_8_VALIDATE': '"1"',
  },
  banner: {
    js: "import { createRequire as bundledCreateRequire } from 'node:module'; const require = bundledCreateRequire(import.meta.url);",
  },
});
await writeFile(
  path.join(out, 'server-build.json'),
  JSON.stringify(result.metafile, null, 2),
);
await cp(
  path.join(root, 'server/standalone/healthcheck.mjs'),
  path.join(out, 'server/standalone/healthcheck.mjs'),
);
await cp(path.join(root, 'config'), path.join(out, 'config'), {
  recursive: true,
});
await cp(path.join(root, 'LICENSE'), path.join(out, 'LICENSE'));
await cp(path.join(root, 'DATA_SOURCES.md'), path.join(out, 'DATA_SOURCES.md'));

// Keep package identities and licenses inspectable after bundling. This is the
// declared production dependency inventory (browser + server), not runnable modules.
const lock = JSON.parse(
  await readFile(path.join(root, 'package-lock.json'), 'utf8'),
);
for (const [name, entry] of Object.entries(lock.packages)) {
  if (!name || entry.dev || !name.startsWith('node_modules/')) continue;
  const source = path.join(root, name);
  const target = path.join(out, 'third-party', name);
  await mkdir(target, { recursive: true });
  try {
    await cp(
      path.join(source, 'package.json'),
      path.join(target, 'package.json'),
    );
    for (const license of [
      'LICENSE',
      'LICENSE.md',
      'LICENSE.txt',
      'license',
      'license.md',
      'COPYING',
      'NOTICE',
    ]) {
      await cp(path.join(source, license), path.join(target, license)).catch(
        (error) => {
          if (error.code !== 'ENOENT') throw error;
        },
      );
    }
  } catch (error) {
    if (!entry.optional || error.code !== 'ENOENT') throw error;
  }
}
console.log('Container application prepared in out/');
