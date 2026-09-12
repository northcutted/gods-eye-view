import { createProductionServer, installShutdown } from './http.js';
import { constants } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}
// Fail startup if budget/cache persistence is unavailable instead of silently
// resetting provider accounting every time the service is restarted.
const cache = path.resolve(process.env.GEV_CACHE_DIR || '.gev-cache');
await mkdir(cache, { recursive: true, mode: 0o700 });
await access(cache, constants.R_OK | constants.W_OK);
const server = await createProductionServer();
server.on('error', (error) => {
  console.error('[HTTP] Server failed:', error.code || 'internal error');
  process.exitCode = 1;
});
installShutdown(server);
server.listen(port, host, () =>
  console.log(`[HTTP] Listening on ${host}:${port}`),
);
