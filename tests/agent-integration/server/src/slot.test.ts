import { describe, expect, it } from 'vitest';
import { ManualClock } from './clock.js';
import { FIXTURE_B, type ProbeResultEnvelope } from './envelope.js';
import { ProbeSlot, SLOT_TTL_MS } from './slot.js';

const RUN_ID = 'run-1';

function resultFor(requestId: string, nonce: string, resultId = 'result-1'): ProbeResultEnvelope {
  return {
    schemaVersion: 1,
    runId: RUN_ID,
    requestId,
    targetDocumentId: 'agent-probe/snapshot-v1',
    resultId,
    nonce,
    snapshot: FIXTURE_B,
  };
}

describe('ProbeSlot: один слот обмена', () => {
  it('пустая очередь даёт null при захвате', () => {
    const slot = new ProbeSlot(new ManualClock(), RUN_ID);
    expect(slot.claim()).toBeNull();
    expect(slot.phase).toBe('idle');
  });

  it('повторный запрос возвращает тот же конверт, а не второй', () => {
    const slot = new ProbeSlot(new ManualClock(), RUN_ID);
    const first = slot.request(3, 'fixture-b');
    const second = slot.request(3, 'fixture-b');
    expect(second.requestId).toBe(first.requestId);
    expect(second.nonce).toBe(first.nonce);
  });

  it('второй независимый запрос отклоняется', () => {
    const slot = new ProbeSlot(new ManualClock(), RUN_ID);
    slot.request(3, 'fixture-b');
    expect(() => slot.request(4, 'fixture-b')).toThrow('Слот занят');
  });

  it('один захват: повторный claim до результата невозможен', () => {
    const slot = new ProbeSlot(new ManualClock(), RUN_ID);
    slot.request(3, 'fixture-b');
    const claim = slot.claim();
    expect(claim).not.toBeNull();
    expect(slot.claim()).toBeNull();
    expect(slot.phase).toBe('processing');
  });

  it('submit по чужому attemptToken отклоняется', () => {
    const slot = new ProbeSlot(new ManualClock(), RUN_ID);
    const envelope = slot.request(3, 'fixture-b');
    const claim = slot.claim();
    expect(claim).not.toBeNull();
    expect(() => slot.submit('wrong-token', resultFor(envelope.requestId, envelope.nonce))).toThrow('Попытка не совпадает');
  });

  it('ready ≠ applied: ack переводит в applied только из ready', () => {
    const slot = new ProbeSlot(new ManualClock(), RUN_ID);
    const envelope = slot.request(3, 'fixture-b');
    expect(() => slot.ack(envelope.requestId)).toThrow('Подтверждение невозможно');
    const claim = slot.claim();
    expect(claim).not.toBeNull();
    expect(slot.submit(claim!.attemptToken, resultFor(envelope.requestId, envelope.nonce))).toBe('ready');
    expect(slot.phase).toBe('ready');
    expect(slot.ack(envelope.requestId)).toBe('applied');
    expect(slot.ack(envelope.requestId)).toBe('already-applied');
    expect(slot.phase).toBe('applied');
  });

  it('повтор submit того же результата идемпотентен, другой результат отклоняется', () => {
    const slot = new ProbeSlot(new ManualClock(), RUN_ID);
    const envelope = slot.request(3, 'fixture-b');
    const claim = slot.claim()!;
    const first = resultFor(envelope.requestId, envelope.nonce, 'result-1');
    expect(slot.submit(claim.attemptToken, first)).toBe('ready');
    expect(slot.submit(claim.attemptToken, first)).toBe('duplicate');
    expect(() => slot.submit(claim.attemptToken, resultFor(envelope.requestId, envelope.nonce, 'result-2'))).toThrow('другой результат');
  });

  it('fail фиксирует ошибку исполнителя', () => {
    const slot = new ProbeSlot(new ManualClock(), RUN_ID);
    slot.request(3, 'fixture-b');
    const claim = slot.claim()!;
    slot.fail(claim.attemptToken, 'нет доступа к инструментам');
    expect(slot.phase).toBe('failed');
    expect(slot.failure?.code).toBe('agent-failed');
  });

  it('TTL: поздний submit и ack после истечения отклоняются', () => {
    const clock = new ManualClock();
    const slot = new ProbeSlot(clock, RUN_ID);
    const envelope = slot.request(3, 'fixture-b');
    const claim = slot.claim()!;
    clock.advance(SLOT_TTL_MS + 1);
    expect(slot.phase).toBe('failed');
    expect(slot.failure?.code).toBe('expired');
    expect(() => slot.submit(claim.attemptToken, resultFor(envelope.requestId, envelope.nonce))).toThrow();
    expect(() => slot.ack(envelope.requestId)).toThrow('Подтверждение невозможно');
  });

  it('после applied новый запрос создаётся заново', () => {
    const slot = new ProbeSlot(new ManualClock(), RUN_ID);
    const envelope = slot.request(3, 'fixture-b');
    const claim = slot.claim()!;
    slot.submit(claim.attemptToken, resultFor(envelope.requestId, envelope.nonce));
    slot.ack(envelope.requestId);
    const next = slot.request(4, 'fixture-b');
    expect(next.requestId).not.toBe(envelope.requestId);
  });
});
