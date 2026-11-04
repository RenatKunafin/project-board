import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { systemClock, type Clock } from './clock.js';
import { createProbeHttpServer } from './http.js';
import { newRunId } from './ids.js';
import { registerProbeTools } from './mcp.js';
import { PairingService } from './pairing.js';
import { ProbeSlot } from './slot.js';

export const PROBE_COMPONENT_VERSION = '0.1.0';

export interface ProbeComponent {
  readonly runId: string;
  readonly address: string;
  readonly port: number;
  close(): Promise<void>;
}

export interface ProbeComponentOptions {
  /** 0 — эфемерный порт (автотесты); прод-использование — явный порт. */
  readonly port: number;
  readonly allowedOrigin: string;
  readonly clock?: Clock;
  readonly stdout?: NodeJS.WriteStream;
}

/**
 * Один процесс стенда (D3): MCP stdio + HTTP JSON на 127.0.0.1.
 * stdout содержит только MCP-сообщения; служебные записи — stderr.
 */
export async function startProbeComponent(options: ProbeComponentOptions): Promise<ProbeComponent> {
  const clock = options.clock ?? systemClock;
  const runId = newRunId();
  const slot = new ProbeSlot(clock, runId);
  const pairing = new PairingService(clock, runId);

  const httpServer = createProbeHttpServer({ allowedOrigin: options.allowedOrigin, slot, pairing, clock, runId });
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port, '127.0.0.1', () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
  const address = httpServer.address();
  if (address === null || typeof address === 'string') {
    httpServer.close();
    throw new Error('Не удалось занять loopback-порт');
  }
  const url = `http://127.0.0.1:${address.port}`;

  const mcpServer = new McpServer({ name: 'project-board-agent-probe', version: PROBE_COMPONENT_VERSION });
  registerProbeTools(mcpServer, { slot, pairing, runId, address: url });
  await mcpServer.connect(new StdioServerTransport());

  process.stderr.write(`${JSON.stringify({ event: 'listening', address: url, runId, allowedOrigin: options.allowedOrigin })}\n`);

  return {
    runId,
    address: url,
    port: address.port,
    async close() {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
      await mcpServer.close();
    },
  };
}
