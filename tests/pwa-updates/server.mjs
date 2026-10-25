import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve('.cache/pwa-updates');
let version = 'A';
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2' };
createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost:4184');
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/__version' && request.method === 'POST') {
    const next = url.searchParams.get('value');
    if (!['A', 'B', 'baseline'].includes(next)) { response.writeHead(400).end(); return; }
    version = next;
    response.end(version);
    return;
  }
  const path = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  // Старые хешированные assets сохраняются между публикациями.
  const versions = path.startsWith('/assets/') || /^\/workbox-.*\.js$/.test(path) ? [version, 'A', 'B', 'baseline'] : [version];
  for (const candidate of versions) {
    const directory = resolve(root, candidate);
    const file = resolve(directory, `.${path}`);
    if (!file.startsWith(directory + sep)) continue;
    try {
      const content = await readFile(file);
      response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
      response.end(content);
      return;
    } catch { /* Следующая версия для старого хешированного ресурса. */ }
  }
  response.writeHead(404).end();
}).listen(4184, 'localhost');
