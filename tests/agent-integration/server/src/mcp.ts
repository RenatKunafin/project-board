import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PROBE_TARGET_DOCUMENT_ID, parseResultPayload, isExpectedResult, EnvelopeError } from './envelope.js';
import type { PairingService } from './pairing.js';
import type { ProbeSlot } from './slot.js';

interface ProbeToolDeps {
  readonly slot: ProbeSlot;
  readonly pairing: PairingService;
  readonly runId: string;
  readonly address: string;
}

function text(payload: unknown): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: JSON.stringify(payload) }];
}

/**
 * MCP-инструменты пробы (D5): имена — внутренний контракт стенда,
 * не будущий публичный API. Инструкция агенту — вернуть заданную
 * синтетическую fixture B, не обращаясь к корпоративным источникам.
 */
export function registerProbeTools(server: McpServer, deps: ProbeToolDeps): void {
  const { slot, pairing, runId, address } = deps;

  server.registerTool(
    'probe_session',
    {
      description:
        'Синтетическая проба PBT-121: состояние компонента, адрес браузерного канала и одноразовый код сопряжения. Корпоративные источники не запрашивать.',
      inputSchema: {},
    },
    async () => {
      const pairing = deps.pairing.issuePairingCode();
      return {
        content: text({
          runId,
          address,
          schemaVersion: 1,
          targetDocumentId: PROBE_TARGET_DOCUMENT_ID,
          expectedFixtureId: 'fixture-b',
          pairingCode: pairing.code,
          pairingExpiresAt: pairing.expiresAt,
        }),
      };
    },
  );

  server.registerTool(
    'claim_probe_request',
    {
      description:
        'Атомарно взять единственный ожидающий синтетический запрос либо получить пустой ответ. Обработку выполняет один вызов submit_probe_result или fail_probe_request.',
      inputSchema: {},
    },
    async () => {
      const claim = slot.claim();
      if (!claim) {
        return { content: text({ status: 'empty' }) };
      }
      return {
        content: text({
          status: 'claimed',
          attemptToken: claim.attemptToken,
          envelope: claim.envelope,
          instruction:
            'Собери ответ инструментом submit_probe_result: сгенерируй синтетический снимок по правилам fixture-b (готовые значения из конверта не выдумывать за корпоративные данные).',
        }),
      };
    },
  );

  server.registerTool(
    'submit_probe_result',
    {
      description: 'Вернуть синтетический результат обработки по attemptToken. payload — JSON-строка конверта результата.',
      inputSchema: {
        attemptToken: z.string().min(1),
        payload: z.string().min(2),
      },
    },
    async ({ attemptToken, payload }) => {
      try {
        const result = parseResultPayload(payload);
        const envelope = slot.activeRequest;
        if (!envelope || !isExpectedResult(result, { runId, requestId: envelope.requestId, nonce: envelope.nonce, targetDocumentId: envelope.targetDocumentId, fixtureId: envelope.fixtureId })) {
          return { isError: true, content: text({ code: 'mismatch', message: 'Результат не совпадает с активным запросом (runId/requestId/nonce/цель/fixture)' }) };
        }
        const outcome = slot.submit(attemptToken, result);
        return { content: text({ status: outcome === 'duplicate' ? 'duplicate-ignored' : 'ready' }) };
      } catch (error) {
        const code = error instanceof EnvelopeError ? error.code : 'slot-rejected';
        const message = error instanceof Error ? error.message : 'Результат отклонён';
        return { isError: true, content: text({ code, message }) };
      }
    },
  );

  server.registerTool(
    'fail_probe_request',
    {
      description: 'Зафиксировать диагностируемую ошибку обработки по attemptToken.',
      inputSchema: {
        attemptToken: z.string().min(1),
        message: z.string().min(1),
      },
    },
    async ({ attemptToken, message }) => {
      try {
        slot.fail(attemptToken, message);
        return { content: text({ status: 'failed' }) };
      } catch (error) {
        return { isError: true, content: text({ code: 'slot-rejected', message: error instanceof Error ? error.message : 'Ошибка не зафиксирована' }) };
      }
    },
  );

  void pairing;
}
