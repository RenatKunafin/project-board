import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { ManualClock } from './clock.js';
import { createProbeHttpServer } from './http.js';
import { PairingService } from './pairing.js';
import { ProbeSlot } from './slot.js';

const RUN_ID = 'run-http';
const ALLOWED_ORIGIN = 'http://localhost:4390';

interface TestContext {
  server: Server;
  port: number;
  base: string;
  slot: ProbeSlot;
  pairing: PairingService;
  clock: ManualClock;
}

let context: TestContext | null = null;

beforeEach(async () => {
  const clock = new ManualClock();
  const slot = new ProbeSlot(clock, RUN_ID);
  const pairing = new PairingService(clock, RUN_ID);
  const server = createProbeHttpServer({ allowedOrigin: ALLOWED_ORIGIN, slot, pairing, clock, runId: RUN_ID });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('нет адреса');
  context = { server, port: address.port, base: `http://127.0.0.1:${address.port}`, slot, pairing, clock };
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => context?.server.close((error) => (error ? reject(error) : resolve())));
  context = null;
});

function fetchProbe(path: string, init: RequestInit & { origin?: string; host?: string } = {}): Promise<Response> {
  const { origin = ALLOWED_ORIGIN, host, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set('Origin', origin);
  if (host) headers.set('Host', host);
  return fetch(`${context!.base}${path}`, { ...rest, headers });
}

async function pairedToken(): Promise<string> {
  const code = context!.pairing.issuePairingCode();
  const response = await fetchProbe('/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code.code }) });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { token: string };
  return body.token;
}

describe('Probe HTTP: Host/Origin/CORS/сессии', () => {
  it('запрос без Origin отклоняется до авторизации', async () => {
    const response = await fetch(`${context!.base}/requests`, { method: 'POST' });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('origin-forbidden');
  });

  it('чужой Origin и null Origin отклоняются', async () => {
    const foreign = await fetchProbe('/pair', { method: 'POST', origin: 'https://evil.example', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(foreign.status).toBe(403);
    const nullOrigin = await fetch(`${context!.base}/pair`, { method: 'POST', headers: { Origin: 'null', 'Content-Type': 'application/json' }, body: '{}' });
    expect(nullOrigin.status).toBe(403);
  });

  it('чужой Host отклоняется', async () => {
    // fetch не позволяет подменить Host (undici перезаписывает по URL), поэтому raw-сокет.
    const { connect } = await import('node:net');
    const response = await new Promise<string>((resolve, reject) => {
      const socket = connect(context!.port, '127.0.0.1');
      socket.on('error', reject);
      socket.on('connect', () => {
        socket.write('POST /pair HTTP/1.1\r\nHost: internal.corp:8080\r\nOrigin: https://evil.example\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}');
      });
      socket.on('data', (chunk) => resolve(chunk.toString('utf8')));
    });
    expect(response).toContain(' 403 ');
    expect(response).toContain('host-forbidden');
  });

  it('preflight возвращает CORS только для разрешённого origin без bearer', async () => {
    const response = await fetchProbe('/requests', { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('authorization');
    const foreign = await fetchProbe('/requests', { method: 'OPTIONS', origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
  });

  it('pair обменивает код на bearer; неверный код — 401', async () => {
    const token = await pairedToken();
    expect(token.length).toBeGreaterThan(32);
    const bad = await fetchProbe('/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'wrong' }) });
    expect(bad.status).toBe(401);
  });

  it('без bearer защищённые endpoints дают 401', async () => {
    const response = await fetchProbe('/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(401);
  });

  it('полный браузерный цикл: запрос → состояние → ack', async () => {
    const token = await pairedToken();
    const create = await fetchProbe('/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ baseRevision: 1, fixtureId: 'fixture-b' }),
    });
    expect(create.status).toBe(200);
    const { envelope } = (await create.json()) as { envelope: { requestId: string; nonce: string } };

    // Исполнитель обрабатывает напрямую через доменный API процесса.
    const claim = context!.slot.claim();
    expect(claim).not.toBeNull();

    const state = await fetchProbe(`/requests/${envelope.requestId}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(state.status).toBe(200);
    expect(((await state.json()) as { phase: string }).phase).toBe('processing');

    const ackEarly = await fetchProbe(`/requests/${envelope.requestId}/ack`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    expect(ackEarly.status).toBe(409);

    context!.slot.submit(claim!.attemptToken, {
      schemaVersion: 1,
      runId: RUN_ID,
      requestId: envelope.requestId,
      targetDocumentId: 'agent-probe/snapshot-v1',
      resultId: 'res-1',
      nonce: envelope.nonce,
      snapshot: {
        kind: 'agent-probe-snapshot',
        schemaVersion: 1,
        fixtureId: 'fixture-b',
        sprintName: 'Синтетический спринт B',
        asOf: '2026-11-02T12:00:00.000Z',
        items: [{ id: 'b-1', title: 'Задача', status: 'todo', points: 1 }],
      },
    });

    const ready = await fetchProbe(`/requests/${envelope.requestId}`, { headers: { Authorization: `Bearer ${token}` } });
    const readyBody = (await ready.json()) as { phase: string; result: { resultId: string } | null };
    expect(readyBody.phase).toBe('ready');
    expect(readyBody.result?.resultId).toBe('res-1');

    const ack = await fetchProbe(`/requests/${envelope.requestId}/ack`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    expect(ack.status).toBe(200);
    expect(((await ack.json()) as { phase: string }).phase).toBe('applied');
  });

  it('disconnect отзывает сессию', async () => {
    const token = await pairedToken();
    const disconnect = await fetchProbe('/disconnect', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    expect(disconnect.status).toBe(200);
    const after = await fetchProbe('/requests', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}' });
    expect(after.status).toBe(401);
  });

  it('тело больше 32 KiB даёт 413', async () => {
    const token = await pairedToken();
    const big = JSON.stringify({ baseRevision: 1, fixtureId: 'x'.repeat(40 * 1024) });
    const response = await fetchProbe('/requests', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: big });
    expect(response.status).toBe(413);
  });

  it('неизвестный запрос даёт 404, неизвестный маршрут — 404', async () => {
    const token = await pairedToken();
    const unknown = await fetchProbe('/requests/does-not-exist', { headers: { Authorization: `Bearer ${token}` } });
    expect(unknown.status).toBe(404);
    const route = await fetchProbe('/admin', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    expect(route.status).toBe(404);
  });
});
