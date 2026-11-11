import { expect, test } from '@playwright/test';
import { startComponent, activeComponents } from './helpers';

test.afterEach(async () => {
  await Promise.all([...activeComponents].map((component) => component.close()));
});

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('probe-fixture')).toHaveText('fixture-a');
});

test('отключение компонента во время ожидания видно и не портит документ', async ({ page }) => {
  const component = await startComponent('http://127.0.0.1:4390', 43821);  const session = await component.probeSession();
  await page.getByTestId('probe-address').fill(session.address);
  await page.getByTestId('probe-code').fill(session.pairingCode);
  await page.getByTestId('probe-pair').click();
  await expect(page.getByTestId('probe-phase')).toHaveAttribute('data-phase', 'connected');
  await page.getByTestId('probe-request').click();
  await expect(page.getByTestId('probe-phase')).toHaveAttribute('data-phase', 'queued', { timeout: 10_000 });

  // Компонент остановлен: опрос обязан показать отказ, а не «вечное ожидание».
  await component.close();
  await expect(page.getByTestId('probe-phase')).toHaveAttribute('data-phase', 'failed', { timeout: 15_000 });
  await expect(page.getByTestId('probe-log')).toContainText('Компонент недоступен');

  // Прежние данные переживают аварию доставки.
  await page.reload();
  await expect(page.getByTestId('probe-fixture')).toHaveText('fixture-a');
  await expect(page.getByTestId('probe-revision')).toHaveText('1');
});

test('устойчивый отказ записи: нет ложного успеха и ACK, прежние данные целы', async ({ page }) => {
  const component = await startComponent('http://127.0.0.1:4390', 43821);
  // Страница с test-only обёрткой persistence (D6): save/saveAll отвергаются.
  await page.goto('/?pbt121fault=persistence');
  await expect(page.getByTestId('probe-fixture')).toHaveText('fixture-a');

  const session = await component.probeSession();
  await page.getByTestId('probe-address').fill(session.address);
  await page.getByTestId('probe-code').fill(session.pairingCode);
  await page.getByTestId('probe-pair').click();
  await expect(page.getByTestId('probe-phase')).toHaveAttribute('data-phase', 'connected');
  await page.getByTestId('probe-request').click();
  const processed = await component.processPendingRequest();
  expect(processed.status).toBe('ready');

  await expect(page.getByTestId('probe-phase')).toHaveAttribute('data-phase', 'failed', { timeout: 20_000 });
  await expect(page.getByTestId('probe-log')).toContainText('Применение не выполнено');
  const log = await page.getByTestId('probe-log').textContent();
  expect(log).not.toContain('подтверждён');

  // Reload без обёртки: сохранена прежняя fixture A, результата нет.
  await page.goto('/');
  await expect(page.getByTestId('probe-fixture')).toHaveText('fixture-a');
  await expect(page.getByTestId('probe-revision')).toHaveText('1');
});
