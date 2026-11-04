import { describe, expect, it } from 'vitest';
import { EnvelopeError, FIXTURE_B, MAX_JSON_BYTES, parseResultPayload } from './envelope.js';

function validPayload(): string {
  return JSON.stringify({
    schemaVersion: 1,
    runId: 'run-1',
    requestId: 'req-1',
    targetDocumentId: 'agent-probe/snapshot-v1',
    resultId: 'res-1',
    nonce: 'nonce-1',
    snapshot: FIXTURE_B,
  });
}

describe('parseResultPayload: строгая схема результата', () => {
  it('разбирает корректный конверт fixture-b', () => {
    const parsed = parseResultPayload(validPayload());
    expect(parsed.snapshot.fixtureId).toBe('fixture-b');
    expect(parsed.snapshot.items).toHaveLength(3);
  });

  it('не-строка и повреждённый JSON отклоняются', () => {
    expect(() => parseResultPayload({ not: 'string' })).toThrow(EnvelopeError);
    expect(() => parseResultPayload('not json{')).toThrow('корректным JSON');
  });

  it('чужая схема/версия/статус отклоняются', () => {
    const base = JSON.parse(validPayload());
    expect(() => parseResultPayload(JSON.stringify({ ...base, schemaVersion: 2 }))).toThrow('Схема результата');
    expect(() => parseResultPayload(JSON.stringify({ ...base, snapshot: { ...base.snapshot, kind: 'other' } }))).toThrow('Схема результата');
    expect(() => parseResultPayload(JSON.stringify({ ...base, snapshot: { ...base.snapshot, items: [{ ...base.snapshot.items[0], status: 'blocked' }] } }))).toThrow('Схема результата');
  });

  it('превышение 32 KiB отклоняется до разбора', () => {
    const big = 'x'.repeat(MAX_JSON_BYTES + 10);
    const base = JSON.parse(validPayload());
    const payload = JSON.stringify({ ...base, snapshot: { ...base.snapshot, sprintName: big } });
    expect(() => parseResultPayload(payload)).toThrow('превышает 32 KiB');
  });

  it('пустой список items отклоняется', () => {
    const base = JSON.parse(validPayload());
    expect(() => parseResultPayload(JSON.stringify({ ...base, snapshot: { ...base.snapshot, items: [] } }))).toThrow('Схема результата');
  });
});
