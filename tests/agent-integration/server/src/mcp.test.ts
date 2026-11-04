import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ManualClock } from './clock.js';
import { FIXTURE_B } from './envelope.js';
import { registerProbeTools } from './mcp.js';
import { PairingService } from './pairing.js';
import { ProbeSlot } from './slot.js';

const RUN_ID = 'run-mcp';
const ADDRESS = 'http://127.0.0.1:43821';

async function connectedPair() {
  const clock = new ManualClock();
  const slot = new ProbeSlot(clock, RUN_ID);
  const pairing = new PairingService(clock, RUN_ID);
  const server = new McpServer({ name: 'project-board-agent-probe', version: '0.1.0' });
  registerProbeTools(server, { slot, pairing, runId: RUN_ID, address: ADDRESS });
  const client = new Client({ name: 'probe-test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, slot, pairing, async close() { await client.close(); await server.close(); } };
}

function parseContent(payload: { content: { type: string; text?: string }[] }): Record<string, unknown> {
  return JSON.parse(payload.content[0]?.text ?? '{}');
}

describe('MCP-инструменты пробы', () => {
  it('probe_session отдаёт runId, адрес и одноразовый код', async () => {
    const probe = await connectedPair();
    try {
      const result = await probe.client.callTool({ name: 'probe_session', arguments: {} });
      const body = parseContent(result as never);
      expect(body.runId).toBe(RUN_ID);
      expect(body.address).toBe(ADDRESS);
      expect(typeof body.pairingCode).toBe('string');
      expect((body.pairingCode as string).length).toBeGreaterThanOrEqual(22);
      expect(probe.pairing.pair(body.pairingCode as string).runId).toBe(RUN_ID);
    } finally {
      await probe.close();
    }
  });

  it('пустая очередь: claim возвращает empty', async () => {
    const probe = await connectedPair();
    try {
      const result = await probe.client.callTool({ name: 'claim_probe_request', arguments: {} });
      expect(parseContent(result as never).status).toBe('empty');
    } finally {
      await probe.close();
    }
  });

  it('полный обмен: claim → submit → ready, повтор submit идемпотентен', async () => {
    const probe = await connectedPair();
    try {
      const envelope = probe.slot.request(2, 'fixture-b');
      const claim = parseContent((await probe.client.callTool({ name: 'claim_probe_request', arguments: {} })) as never) as { status: string; attemptToken: string; envelope: typeof envelope };
      expect(claim.status).toBe('claimed');
      expect(claim.envelope.requestId).toBe(envelope.requestId);

      const payload = JSON.stringify({
        schemaVersion: 1,
        runId: RUN_ID,
        requestId: envelope.requestId,
        targetDocumentId: 'agent-probe/snapshot-v1',
        resultId: 'res-mcp-1',
        nonce: envelope.nonce,
        snapshot: FIXTURE_B,
      });
      const submit = parseContent((await probe.client.callTool({ name: 'submit_probe_result', arguments: { attemptToken: claim.attemptToken, payload } })) as never);
      expect(submit.status).toBe('ready');
      const duplicate = parseContent((await probe.client.callTool({ name: 'submit_probe_result', arguments: { attemptToken: claim.attemptToken, payload } })) as never);
      expect(duplicate.status).toBe('duplicate-ignored');
      expect(probe.slot.phase).toBe('ready');
    } finally {
      await probe.close();
    }
  });

  it('несовпадающий результат отклоняется isError', async () => {
    const probe = await connectedPair();
    try {
      const envelope = probe.slot.request(2, 'fixture-b');
      const claim = parseContent((await probe.client.callTool({ name: 'claim_probe_request', arguments: {} })) as never) as { attemptToken: string };
      const payload = JSON.stringify({
        schemaVersion: 1,
        runId: RUN_ID,
        requestId: envelope.requestId,
        targetDocumentId: 'agent-probe/snapshot-v1',
        resultId: 'res-other',
        nonce: 'wrong-nonce',
        snapshot: FIXTURE_B,
      });
      const submit = await probe.client.callTool({ name: 'submit_probe_result', arguments: { attemptToken: claim.attemptToken, payload } });
      expect((submit as { isError?: boolean }).isError).toBe(true);
      expect(parseContent(submit as never).code).toBe('mismatch');
      expect(probe.slot.phase).toBe('processing');
    } finally {
      await probe.close();
    }
  });

  it('fail_probe_request фиксирует ошибку исполнителя', async () => {
    const probe = await connectedPair();
    try {
      probe.slot.request(1, 'fixture-b');
      const claim = parseContent((await probe.client.callTool({ name: 'claim_probe_request', arguments: {} })) as never) as { attemptToken: string };
      const fail = parseContent((await probe.client.callTool({ name: 'fail_probe_request', arguments: { attemptToken: claim.attemptToken, message: 'инструменты недоступны' } })) as never);
      expect(fail.status).toBe('failed');
      expect(probe.slot.failure?.code).toBe('agent-failed');
    } finally {
      await probe.close();
    }
  });
});
