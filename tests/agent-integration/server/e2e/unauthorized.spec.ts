import { expect, test } from '@playwright/test';
import { startComponent, activeComponents } from './helpers';

test.afterEach(async () => {
  await Promise.all([...activeComponents].map((component) => component.close()));
});

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('probe-fixture')).toHaveText('fixture-a');
});

test('чужая origin отклоняется до чтения/записи', async ({ page }) => {
  // Компонент разрешает только http://127.0.0.1:4390; страница открыта как http://localhost:4390.
  const component = await startComponent('http://127.0.0.1:4390', 43821);  const session = await component.probeSession();

  await page.goto('http://localhost:4390/');
  await expect(page.getByTestId('probe-fixture')).toHaveText('fixture-a');
  await page.getByTestId('probe-address').fill(session.address);
  await page.getByTestId('probe-code').fill(session.pairingCode);
  await page.getByTestId('probe-pair').click();
  // Чужая origin получает сетевой отказ на уровне CORS (тело ответа недоступно JS),
  // поэтому проверяем сам факт отказа и отсутствие сопряжения.
  await expect(page.getByTestId('probe-log')).toContainText('Сопряжение не выполнено', { timeout: 10_000 });
  await expect(page.getByTestId('probe-phase')).toHaveAttribute('data-phase', 'no-component');

  // Доступ отклонён до создания запроса: очередь пуста, документ не менялся.
  const processed = await component.processPendingRequest();
  expect(processed.status).toBe('empty');
  await page.reload();
  await expect(page.getByTestId('probe-fixture')).toHaveText('fixture-a');
  await expect(page.getByTestId('probe-revision')).toHaveText('1');
});

test('прямые вызовы без полномочий отклоняются; preflight не требует bearer', async ({ page }) => {
  const component = await startComponent('http://127.0.0.1:4390', 43821);  const session = await component.probeSession();
  const address = await component.address;

  const outcome = await page.evaluate(async (target) => {
    const results: Record<string, number> = {};
    const preflight = await fetch(`${target}/requests`, { method: 'OPTIONS' });
    results.preflight = preflight.status;
    // ACAO-заголовок ответа недоступен из JS (не safelisted); успешный непростой
    // POST ниже сам доказывает, что preflight прошёл с нашим CORS-разрешением.
    const noBearer = await fetch(`${target}/requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    results.noBearer = noBearer.status;
    const garbageBearer = await fetch(`${target}/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer garbage' },
      body: '{}',
    });
    results.garbageBearer = garbageBearer.status;
    const badCode = await fetch(`${target}/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'no-such' }) });
    results.badCode = badCode.status;
    return results;
  }, address);

  expect(outcome.preflight).toBe(204);
  expect(outcome.noBearer).toBe(401);
  expect(outcome.garbageBearer).toBe(401);
  expect(outcome.badCode).toBe(401);

  // Очередь осталась пустой, документ не тронут.
  const processed = await component.processPendingRequest();
  expect(processed.status).toBe('empty');
  await expect(page.getByTestId('probe-fixture')).toHaveText('fixture-a');
  void session;
});
