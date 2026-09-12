import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

/** Precompress static assets once at build time, never on a request thread. */
export async function compressAssets(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await compressAssets(filename);
    } else if (
      entry.isFile() &&
      /\.(?:html|js|css|json|svg|wasm)$/.test(entry.name)
    ) {
      const source = await readFile(filename);
      if (source.length < 1024) continue;
      const encodings = [
        [
          'br',
          await brotli(source, {
            params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
          }),
        ],
        ['gz', await gz(source, { level: 9 })],
      ];
      for (const [extension, compressed] of encodings) {
        if (compressed.length < source.length)
          await writeFile(`${filename}.${extension}`, compressed);
      }
    }
  }
}
