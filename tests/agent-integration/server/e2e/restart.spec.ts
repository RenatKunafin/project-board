import { expect, test } from '@playwright/test';
import { startComponent, activeComponents } from './helpers';

test.afterEach(async () => {
  await Promise.all([...activeComponents].map((component) => component.close()));
});

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('probe-fixture')).toHaveText('fixture-a');
});

test('restart компонента: слот потерян, старая сессия недействительна, новое сопряжение работает', async ({ page }) => {
  const first = await startComponent('http://127.0.0.1:4390', 43821);
  const address = await first.address;
  const session = await first.probeSession();

  await page.getByTestId('probe-address').fill(address);
  await page.getByTestId('probe-code').fill(session.pairingCode);
  await page.getByTestId('probe-pair').click();
  await expect(page.getByTestId('probe-phase')).toHaveAttribute('data-phase', 'connected');
  await page.getByTestId('probe-request').click();
  await expect(page.getByTestId('probe-phase')).toHaveAttribute('data-phase', 'queued', { timeout: 10_000 });

  // Захват обработки и гибель процесса: незавершённый обмен теряется заявленным образом.
  const stale = await first.claimOnly();
  // Вторая сессия первого процесса: после restart её bearer обязан потерять силу.
  const secondSession = await first.probeSession();
  const secondAddress = await first.address;
  const paired = await fetch(`${secondAddress}/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:4390' },
    body: JSON.stringify({ code: secondSession.pairingCode }),
  });
  expect(paired.status).toBe(200);
  const { token: staleToken } = (await paired.json()) as { token: string };
  await first.close();
  await expect(page.getByTestId('probe-phase')).toHaveAttribute('data-phase', 'failed', { timeout: 15_000 });

  // Перезапуск на том же порту: новый runId; старая сессия и поздний submit отклоняются.
  const second = await startComponent('http://127.0.0.1:4390', 43821);  const secondRunId = await second.runId;
  expect(secondRunId).not.toBe(session.runId);

  const staleOutcome = await second.submitStale(stale.attemptToken, stale.requestId, stale.nonce);
  expect(staleOutcome.code ?? 'slot-rejected').toBeTruthy();

  const reused = await fetch(`${await second.address}/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:4390', Authorization: `Bearer ${staleToken}` },
    body: '{}',
  });
  expect(reused.status).toBe(401);

  // Повторное сопряжение и полный обмен на новом процессе.
  const fresh = await second.probeSession();
  await page.getByTestId('probe-code').fill(fresh.pairingCode);
  await page.getByTestId('probe-address').fill(await second.address);
  await page.getByTestId('probe-pair').click();
  await expect(page.getByTestId('probe-phase')).toHaveAttribute('data-phase', 'connected');
  await page.getByTestId('probe-request').click();
  await expect(page.getByTestId('probe-phase')).toHaveAttribute('data-phase', 'queued', { timeout: 10_000 });
  const processed = await second.processPendingRequest();
  expect(processed.status).toBe('ready');
  await expect(page.getByTestId('probe-phase')).toHaveAttribute('data-phase', 'saved', { timeout: 15_000 });
  await expect(page.getByTestId('probe-fixture')).toHaveText('fixture-b');
});
