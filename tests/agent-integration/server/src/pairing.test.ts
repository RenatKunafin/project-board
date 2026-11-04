import { describe, expect, it } from 'vitest';
import { ManualClock } from './clock.js';
import { PairingService, MAX_PAIRING_ATTEMPTS, PAIRING_CODE_TTL_MS, SESSION_TTL_MS } from './pairing.js';

const RUN_ID = 'run-1';

describe('PairingService: коды и сессии', () => {
  it('код обменивается на bearer-сессию этого runId', () => {
    const pairing = new PairingService(new ManualClock(), RUN_ID);
    const active = pairing.issuePairingCode();
    const session = pairing.pair(active.code);
    expect(session.runId).toBe(RUN_ID);
    expect(session.token.length).toBeGreaterThan(32);
    expect(pairing.authenticate(session.token).runId).toBe(RUN_ID);
  });

  it('код одноразовый: повторное использование отклоняется', () => {
    const pairing = new PairingService(new ManualClock(), RUN_ID);
    const active = pairing.issuePairingCode();
    pairing.pair(active.code);
    expect(() => pairing.pair(active.code)).toThrow('Код сопряжения неизвестен');
  });

  it('неизвестный и истёкший код отклоняются', () => {
    const clock = new ManualClock();
    const pairing = new PairingService(clock, RUN_ID);
    expect(() => pairing.pair('no-such-code')).toThrow('Код сопряжения неизвестен');
    const active = pairing.issuePairingCode();
    clock.advance(PAIRING_CODE_TTL_MS + 1);
    expect(() => pairing.pair(active.code)).toThrow('Код сопряжения истёк');
  });

  it('лимит неверных попыток исчерпывается и сжигает код', () => {
    const pairing = new PairingService(new ManualClock(), RUN_ID);
    const active = pairing.issuePairingCode();
    for (let attempt = 0; attempt < MAX_PAIRING_ATTEMPTS; attempt += 1) {
      expect(() => pairing.pair('wrong-input')).toThrow('Код сопряжения неизвестен');
    }
    // После 10 неверных вводов валидный код последней выдачи уже изъят.
    expect(() => pairing.pair(active.code)).toThrow('Код сопряжения неизвестен');
  });

  it('сессия истекает и отзывается', () => {
    const clock = new ManualClock();
    const pairing = new PairingService(clock, RUN_ID);
    const session = pairing.pair(pairing.issuePairingCode().code);
    clock.advance(SESSION_TTL_MS + 1);
    expect(() => pairing.authenticate(session.token)).toThrow('Сессия истекла');

    const second = pairing.pair(pairing.issuePairingCode().code);
    pairing.revoke(second.token);
    expect(() => pairing.authenticate(second.token)).toThrow('Сессия недействительна');
  });

  it('без bearer сессия не проходит', () => {
    const pairing = new PairingService(new ManualClock(), RUN_ID);
    expect(() => pairing.authenticate(undefined)).toThrow('Сессия не сопряжена');
    expect(() => pairing.authenticate('garbage')).toThrow('Сессия недействительна');
  });
});
