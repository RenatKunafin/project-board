import http from 'node:http';

// Только тестовый транспорт перед обычным vite preview. Файлы приложения,
// Service Worker и IndexedDB не подменяются; недоступный origin рвёт соединение.
let online = true;
http.createServer((request, response) => {
  if (request.url === '/__health') {
    response.writeHead(200).end('ready');
    return;
  }
  if (request.url === '/__network' && request.method === 'POST') {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      try {
        const settings = JSON.parse(body);
        if (typeof settings.online !== 'boolean') throw new Error('online must be boolean');
        online = settings.online;
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ online }));
      } catch {
        response.writeHead(400).end('invalid settings');
      }
    });
    return;
  }
  if (!online) {
    request.socket.destroy();
    return;
  }
  const upstream = http.request({
    hostname: 'localhost', port: 4173, method: request.method, path: request.url,
    headers: { ...request.headers, host: 'localhost:4173' },
  }, incoming => {
    // HTTP-кэш не должен подменять проверку ресурсов Service Worker.
    response.writeHead(incoming.statusCode ?? 502, { ...incoming.headers, 'cache-control': 'no-store' });
    incoming.pipe(response);
  });
  upstream.on('error', () => { response.writeHead(502).end('preview unavailable'); });
  request.pipe(upstream);
}).listen(4185, '127.0.0.1');
