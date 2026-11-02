/** HTTP-клиент браузерного канала стенда (D3/D4). Один запрос ≤5 с; опрос ограничен. */

export interface PairedSession {
  readonly token: string;
  readonly runId: string;
  readonly expiresAt: number;
}

export interface ProbeRequestInfo {
  readonly phase: 'queued' | 'processing' | 'ready' | 'applied' | 'failed' | 'idle';
  readonly failure: { readonly code: string; readonly message: string } | null;
  readonly result: {
    readonly resultId: string;
    readonly nonce: string;
    readonly snapshot: ProbeSnapshotWire;
  } | null;
}

export interface ProbeSnapshotWire {
  readonly kind: 'agent-probe-snapshot';
  readonly schemaVersion: number;
  readonly fixtureId: string;
  readonly sprintName: string;
  readonly asOf: string;
  readonly items: readonly { readonly id: string; readonly title: string; readonly status: string; readonly points: number }[];
}

export interface ProbeEnvelopeWire {
  readonly schemaVersion: number;
  readonly runId: string;
  readonly requestId: string;
  readonly targetDocumentId: string;
  readonly baseRevision: number;
  readonly fixtureId: string;
  readonly expiresAt: number;
  readonly nonce: string;
}

export class ProbeConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProbeConnectionError';
  }
}

const REQUEST_TIMEOUT_MS = 5000;

async function call(address: string, path: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${address.replace(/\/+$/, '')}${path}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ProbeConnectionError(`Компонент недоступен: ${reason}`);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object' && 'message' in body.error
        ? String((body.error as { message: unknown }).message)
        : `HTTP ${response.status}`;
    if (response.status === 403) {
      throw new ProbeConnectionError(`Источник не разрешён компонентом: ${message}`);
    }
    throw new ProbeConnectionError(message);
  }
  return body;
}

export function pair(address: string, code: string): Promise<PairedSession> {
  return call(address, '/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  }) as Promise<PairedSession>;
}

export function createRequest(address: string, token: string, baseRevision: number): Promise<{ envelope: ProbeEnvelopeWire }> {
  return call(address, '/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ baseRevision, fixtureId: 'fixture-b' }),
  }) as Promise<{ envelope: ProbeEnvelopeWire }>;
}

export function fetchStatus(address: string, token: string, requestId: string): Promise<ProbeRequestInfo> {
  return call(address, `/requests/${encodeURIComponent(requestId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  }) as Promise<ProbeRequestInfo>;
}

export function sendAck(address: string, token: string, requestId: string): Promise<void> {
  return call(address, `/requests/${encodeURIComponent(requestId)}/ack`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }).then(() => undefined);
}

export function disconnect(address: string, token: string): Promise<void> {
  return call(address, '/disconnect', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }).then(() => undefined);
}

/** Ограниченный опрос D3: раз в секунду, только активный запрос, сеанс ≤120 с. */
export const POLL_INTERVAL_MS = 1000;
export const POLL_SESSION_LIMIT_MS = 120_000;

export async function* pollRequest(
  address: string,
  token: string,
  requestId: string,
): AsyncGenerator<ProbeRequestInfo, void, void> {
  const startedAt = Date.now();
  for (;;) {
    const status = await fetchStatus(address, token, requestId);
    if (status.phase === 'ready' || status.phase === 'applied' || status.phase === 'failed') {
      yield status;
      return;
    }
    yield status;
    if (Date.now() - startedAt >= POLL_SESSION_LIMIT_MS) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
