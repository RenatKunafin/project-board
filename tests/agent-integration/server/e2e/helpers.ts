import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/** Путь к собранному CLI компонента (сборка обязательна до тестов). */
export const CLI_PATH = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

export interface ProbeSessionInfo {
  readonly runId: string;
  readonly address: string;
  readonly pairingCode: string;
}

/** Синтетическая fixture B на стороне исполнителя (агента). */
export const FIXTURE_B = {
  kind: 'agent-probe-snapshot',
  schemaVersion: 1,
  fixtureId: 'fixture-b',
  sprintName: 'Синтетический спринт B',
  asOf: '2026-11-02T12:00:00.000Z',
  items: [
    { id: 'a-1', title: 'Начальная задача 1', status: 'done', points: 2 },
    { id: 'a-2', title: 'Начальная задача 2', status: 'in-progress', points: 3 },
    { id: 'b-1', title: 'Добавленная синтетическая задача', status: 'todo', points: 5 },
  ],
} as const;

function parseContent(payload: unknown): Record<string, unknown> {
  const result = payload as { content?: { type: string; text?: string }[] };
  return JSON.parse(result.content?.[0]?.text ?? '{}');
}

/** Активные компоненты тестового файла: afterEach закрывает всё незакрытое. */
export const activeComponents = new Set<ProbeComponent>();

/**
 * Управляемый исполнитель (D8: автоматические тесты используют имитатор):
 * запускает собранный компонент процессом (stdio-MCP + HTTP) и вызывает
 * его инструменты как агент по явной команде.
 */
export class ProbeComponent {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private readonly whenStarted: Promise<{ runId: string; address: string }>;

  constructor(private readonly options: { allowedOrigin: string; port: number }) {
    activeComponents.add(this);
    this.whenStarted = this.start();
  }

  private async start(): Promise<{ runId: string; address: string }> {
    const stderrChunks: Buffer[] = [];
    let announced: { runId: string; address: string } | null = null;
    this.transport = new StdioClientTransport({
      command: process.execPath,
      args: [CLI_PATH, '--allowed-origin', this.options.allowedOrigin, '--port', String(this.options.port)],
      stderr: 'pipe',
    });
    this.transport.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      const match = /"event":"listening","address":"(http:\/\/127\.0\.0\.1:\d+)","runId":"([^"]+)"/.exec(
        Buffer.concat(stderrChunks).toString('utf8'),
      );
      if (match) announced = { address: match[1] ?? '', runId: match[2] ?? '' };
    });
    this.client = new Client({ name: 'agent-probe-e2e', version: '0.0.1' });
    await this.client.connect(this.transport);
    const deadline = Date.now() + 10_000;
    while (!announced && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!announced) {
      throw new Error(`Компонент не сообщил адрес: ${Buffer.concat(stderrChunks).toString('utf8')}`);
    }
    return announced;
  }

  get address(): Promise<string> {
    return this.whenStarted.then((info) => info.address);
  }

  get runId(): Promise<string> {
    return this.whenStarted.then((info) => info.runId);
  }

  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) throw new Error('Компонент не запущен');
    return this.client.callTool({ name, arguments: args });
  }

  /** probe_session: состояние и одноразовый код сопряжения. */
  async probeSession(): Promise<ProbeSessionInfo> {
    const body = parseContent(await this.call('probe_session', {})) as ProbeSessionInfo;
    return body;
  }

  /** Одна обработка по явной команде: claim → submit fixture B. */
  async processPendingRequest(): Promise<{ readonly status: string; readonly message?: string }> {
    const claim = parseContent(await this.call('claim_probe_request', {})) as {
      status: string;
      attemptToken?: string;
      envelope?: { requestId: string; nonce: string };
    };
    if (claim.status === 'empty') return { status: 'empty' };
    if (!claim.attemptToken || !claim.envelope) throw new Error(`Некорректный claim: ${JSON.stringify(claim)}`);
    const payload = JSON.stringify({
      schemaVersion: 1,
      runId: await this.runId,
      requestId: claim.envelope.requestId,
      targetDocumentId: 'agent-probe/snapshot-v1',
      resultId: `res-${Date.now()}`,
      nonce: claim.envelope.nonce,
      snapshot: FIXTURE_B,
    });
    const submit = parseContent(await this.call('submit_probe_result', { attemptToken: claim.attemptToken, payload })) as {
      status?: string;
      message?: string;
    };
    return { status: submit.status ?? 'rejected', message: submit.message };
  }

  /** Поздний submit с токеном уже неактуальной обработки. */
  async submitStale(attemptToken: string, requestId: string, nonce: string): Promise<Record<string, unknown>> {
    const payload = JSON.stringify({
      schemaVersion: 1,
      runId: await this.runId,
      requestId,
      targetDocumentId: 'agent-probe/snapshot-v1',
      resultId: `res-stale-${Date.now()}`,
      nonce,
      snapshot: FIXTURE_B,
    });
    return parseContent(await this.call('submit_probe_result', { attemptToken, payload }));
  }

  async claimOnly(): Promise<{ attemptToken: string; requestId: string; nonce: string }> {
    const claim = parseContent(await this.call('claim_probe_request', {})) as {
      status: string;
      attemptToken?: string;
      envelope?: { requestId: string; nonce: string };
    };
    if (!claim.attemptToken || !claim.envelope) throw new Error(`claim пуст: ${JSON.stringify(claim)}`);
    return { attemptToken: claim.attemptToken, requestId: claim.envelope.requestId, nonce: claim.envelope.nonce };
  }

  async close(): Promise<void> {
    activeComponents.delete(this);
    await this.client?.close();
    this.client = null;
    this.transport = null;
  }
}

export function startComponent(allowedOrigin: string, port: number): ProbeComponent {
  return new ProbeComponent({ allowedOrigin, port });
}
