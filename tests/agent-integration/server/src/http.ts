import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Clock } from './clock.js';
import { PairingError } from './pairing.js';
import type { PairingService } from './pairing.js';
import type { ProbeSlot } from './slot.js';
import { MAX_JSON_BYTES, PROBE_SCHEMA_VERSION } from './envelope.js';

interface ProbeHttpDeps {
  readonly allowedOrigin: string;
  readonly slot: ProbeSlot;
  readonly pairing: PairingService;
  readonly clock: Clock;
  readonly runId: string;
}

interface HttpErrorBody {
  readonly error: { readonly code: string; readonly message: string };
}

class HttpBodyError extends Error {
  constructor(
    message: string,
    readonly code: 'too-large' | 'invalid-json',
  ) {
    super(message);
    this.name = 'HttpBodyError';
  }
}

const ALLOWED_HEADERS = 'authorization, content-type';

function bearerOf(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).byteLength;
    if (size > MAX_JSON_BYTES) {
      throw new HttpBodyError('Тело запроса превышает 32 KiB', 'too-large');
    }
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpBodyError('Тело не является корректным JSON', 'invalid-json');
  }
}

/**
 * Браузерный HTTP JSON канал на loopback (D3/D4).
 * Каждый запрос проверяет точный Host 127.0.0.1:<port> и точный Origin
 * до чтения тела; bearer связывает действия с runId и единственной целью.
 */
export function createProbeHttpServer(deps: ProbeHttpDeps): Server {
  const { allowedOrigin, slot, pairing } = deps;

  const corsHeaders = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };

  function fail(response: ServerResponse, status: number, code: string, message: string): void {
    const body: HttpErrorBody = { error: { code, message } };
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders });
    response.end(JSON.stringify(body));
  }

  function ok(response: ServerResponse, body: unknown, status = 200): void {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders });
    response.end(JSON.stringify(body));
  }

  return createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (error instanceof HttpBodyError) {
        fail(response, error.code === 'too-large' ? 413 : 400, error.code, error.message);
        return;
      }
      const message = error instanceof Error ? error.message : 'Внутренняя ошибка';
      if (!response.headersSent) fail(response, 400, 'bad-request', message);
      else response.end();
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const address = request.socket.localAddress;
    // Слушаем только IPv4 loopback; Host должен быть точным адресом компонента.
    if (address !== '127.0.0.1') {
      response.writeHead(403).end();
      return;
    }
    const port = String(request.socket.localPort);
    const host = request.headers.host;
    if (host !== `127.0.0.1:${port}`) {
      fail(response, 403, 'host-forbidden', 'Компонент принимает обращения только по точному адресу 127.0.0.1');
      return;
    }
    const origin = request.headers.origin;
    if (origin === undefined || origin === 'null' || origin !== allowedOrigin) {
      fail(response, 403, 'origin-forbidden', 'Источник страницы не разрешён для этого компонента');
      return;
    }

    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') {
      // Preflight: Host/Origin уже проверены; сессионный bearer не требуется.
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }

    if (path === '/pair' && request.method === 'POST') {
      const body = (await readJsonBody(request)) as { code?: unknown };
      if (typeof body.code !== 'string' || body.code.length === 0) {
        fail(response, 400, 'invalid-payload', 'Ожидается поле code');
        return;
      }
      try {
        const session = pairing.pair(body.code);
        ok(response, { token: session.token, runId: session.runId, expiresAt: session.expiresAt, schemaVersion: PROBE_SCHEMA_VERSION });
      } catch (error) {
        if (error instanceof PairingError && error.issue.code !== 'unknown-session') {
          fail(response, 401, error.issue.code, error.message);
          return;
        }
        throw error;
      }
      return;
    }

    // Все остальные endpoints требуют действующую сессию.
    try {
      pairing.authenticate(bearerOf(request));
    } catch (error) {
      if (error instanceof PairingError) {
        fail(response, 401, error.issue.code, error.message);
        return;
      }
      throw error;
    }

    if (path === '/disconnect' && request.method === 'POST') {
      pairing.revoke(bearerOf(request));
      ok(response, { disconnected: true });
      return;
    }

    if (path === '/requests' && request.method === 'POST') {
      const body = (await readJsonBody(request)) as { baseRevision?: unknown; fixtureId?: unknown };
      const baseRevision = Number(body.baseRevision);
      const fixtureId = typeof body.fixtureId === 'string' ? body.fixtureId : 'fixture-b';
      if (!Number.isInteger(baseRevision) || baseRevision < 0) {
        fail(response, 400, 'invalid-payload', 'Ожидается неотрицательное целое baseRevision');
        return;
      }
      try {
        const envelope = slot.request(baseRevision, fixtureId);
        ok(response, { envelope });
      } catch (error) {
        fail(response, 409, 'slot-busy', error instanceof Error ? error.message : 'Слот занят');
        return;
      }
      return;
    }

    const requestMatch = /^\/requests\/([^/]+)$/.exec(path);
    if (requestMatch && request.method === 'GET') {
      const requestId = decodeURIComponent(requestMatch[1] ?? '');
      const result = slot.resultOf(requestId);
      const active = slot.activeRequest;
      if (!active || active.requestId !== requestId) {
        fail(response, 404, 'unknown-request', 'Запрос не найден в этом запуске компонента');
        return;
      }
      ok(response, {
        phase: slot.phase,
        failure: slot.failure,
        result: result ? { resultId: result.resultId, nonce: result.nonce, snapshot: result.snapshot } : null,
      });
      return;
    }

    const ackMatch = /^\/requests\/([^/]+)\/ack$/.exec(path);
    if (ackMatch && request.method === 'POST') {
      const requestId = decodeURIComponent(ackMatch[1] ?? '');
      try {
        const outcome = slot.ack(requestId);
        ok(response, { phase: 'applied', outcome });
      } catch (error) {
        fail(response, 409, 'ack-invalid', error instanceof Error ? error.message : 'Подтверждение отклонено');
        return;
      }
      return;
    }

    fail(response, 404, 'not-found', 'Неизвестный маршрут компонента');
  }
}
