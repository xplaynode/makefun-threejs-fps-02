// serve.ts -- tiny static server for the game/ folder, used to play
// SLAGLINE during development: `node serve.ts` (add `--port 8080` to pick
// a port). Built only on the Node 22 standard library. Requests can never
// escape game/, and the MIME table covers just what a browser game needs.
// Treat it as a local dev tool, not a server for the public internet.

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('./game', import.meta.url)));
const cliArgs = process.argv.slice(2);
const flagIndex = cliArgs.indexOf('--port');
const requested = flagIndex === -1 ? 8080 : Number(cliArgs[flagIndex + 1]);
const listenPort = Number.isInteger(requested) && requested > 0 && requested < 65536 ? requested : 8080;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

const server = createServer((request, response) => {
  let urlPath: string;
  try {
    const parsedUrl = new URL(request.url ?? '/', 'http://localhost');
    urlPath = decodeURIComponent(parsedUrl.pathname);
  } catch {
    response.writeHead(400).end('bad request');
    return;
  }
  if (urlPath.endsWith('/')) urlPath = urlPath + 'index.html';
  const targetFile = resolve(join(rootDir, normalize(urlPath)));
  const insideRoot = targetFile === rootDir || targetFile.startsWith(rootDir + sep);
  if (!insideRoot) {
    response.writeHead(403).end('forbidden');
    return;
  }
  let byteSize: number;
  try {
    const info = statSync(targetFile);
    if (info.isFile() === false) throw new Error('directory');
    byteSize = info.size;
  } catch {
    response.writeHead(404).end('not found');
    return;
  }
  const extension = extname(targetFile).toLowerCase();
  response.writeHead(200, {
    'content-type': MIME_TYPES[extension] ?? 'application/octet-stream',
    'content-length': byteSize,
    'cache-control': 'no-store',
  });
  createReadStream(targetFile).pipe(response);
});
server.listen(listenPort, '127.0.0.1', () => {
  console.log('SLAGLINE is playable at http://localhost:' + listenPort);
});
