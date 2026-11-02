#!/usr/bin/env node
/** Простой статический preview собранной панели стенда (без product SW/аналитики). */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.cache/agent-integration/web');
const port = Number(process.env.PORT ?? 4390);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
  const pathname = decodeURIComponent(url.pathname);
  const file = resolve(root, pathname === '/' ? 'index.html' : pathname.slice(1));
  if (!file.startsWith(root + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const content = await readFile(file);
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
    response.end(content);
  } catch {
    response.writeHead(404).end();
  }
}).listen(port, '127.0.0.1', () => {
  process.stderr.write(`[agent-probe-preview] http://127.0.0.1:${port}\n`);
});
