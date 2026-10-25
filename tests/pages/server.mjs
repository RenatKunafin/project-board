import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const base = '/project-board/';
const roots = { production: resolve('apps/project-board/dist'), A: resolve('.cache/pages/A'), B: resolve('.cache/pages/B') };
let version = 'production';
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain' };
createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost:4187');
  response.setHeader('Cache-Control', 'no-cache');
  if (url.pathname === '/__pages/version' && request.method === 'POST') {
    const next = url.searchParams.get('value');
    if (!Object.hasOwn(roots, next)) { response.writeHead(400).end(); return; }
    version = next; response.end(version); return;
  }
  if (url.pathname === base.slice(0, -1)) { response.writeHead(301, { Location: base }).end(); return; }
  if (!url.pathname.startsWith(base)) { response.writeHead(404).end(); return; }
  try {
    const directory = roots[version];
    const path = decodeURIComponent(url.pathname.slice(base.length)) || 'index.html';
    const file = resolve(directory, path);
    if (!file.startsWith(directory + sep)) { response.writeHead(404).end(); return; }
    // Только текущий артефакт, без fallback к старым assets/SPA или корню сайта.
    const content = await readFile(file);
    response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
    response.end(content);
  } catch { response.writeHead(404).end(); }
}).listen(4187, 'localhost');
