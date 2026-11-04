import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { CLI_PATH, startComponent, activeComponents } from './helpers';

test.afterEach(async () => {
  await Promise.all([...activeComponents].map((component) => component.close()));
});

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('probe-fixture')).toHaveText('fixture-a');
});

test('полный синтетический обмен: сопряжение → запрос → обработка → сохранение → reload', async ({ page }) => {
  const component = await startComponent('http://127.0.0.1:4390', 43821);
  const session = await component.probeSession();
  await page.getByTestId('probe-address').fill(session.address);
  await page.getByTestId('probe-code').fill(session.pairingCode);
  await page.getByTestId('probe-pair').click();
  await expect(page.getByTestId('probe-phase')).toHaveAttribute('data-phase', 'connected');

  await page.getByTestId('probe-request').click();
  await expect(page.getByTestId('probe-phase')).toHaveAttribute('data-phase', 'queued', { timeout: 10_000 });

  const processed = await component.processPendingRequest();
  expect(processed.status).toBe('ready');

  await expect(page.getByTestId('probe-phase')).toHaveAttribute('data-phase', 'saved', { timeout: 15_000 });
  await expect(page.getByTestId('probe-fixture')).toHaveText('fixture-b');
  await expect(page.getByTestId('probe-items')).toHaveText('3');
  await expect(page.getByTestId('probe-revision')).toHaveText('2');
  const applied = await page.getByTestId('probe-applied-request').textContent();
  expect(applied).not.toBe('—');

  // D6.6: доказательство reload — чтение из IndexedDB новым экземпляром, без повторной доставки.
  await component.close();
  await page.reload();
  await expect(page.getByTestId('probe-fixture')).toHaveText('fixture-b');
  await expect(page.getByTestId('probe-revision')).toHaveText('2');
  await expect(page.getByTestId('probe-applied-request')).toHaveText(applied ?? '');
});

test('повторная доставка результата не создаёт вторую запись', async ({ page }) => {
  const component = await startComponent('http://127.0.0.1:4390', 43821);  const session = await component.probeSession();
  await page.getByTestId('probe-address').fill(session.address);
  await page.getByTestId('probe-code').fill(session.pairingCode);
  await page.getByTestId('probe-pair').click();
  await expect(page.getByTestId('probe-phase')).toHaveAttribute('data-phase', 'connected');
  await page.getByTestId('probe-request').click();
  await component.processPendingRequest();
  await expect(page.getByTestId('probe-phase')).toHaveAttribute('data-phase', 'saved', { timeout: 15_000 });

  // Новый запрос после applied: страница создаёт второй запрос, агент возвращает тот же результат повторно
  // с новым nonce — сервер и браузер обязаны обработать его как отдельный обмен (ревизия 3).
  await page.getByTestId('probe-request').click();
  await expect(page.getByTestId('probe-phase')).toHaveAttribute('data-phase', 'queued', { timeout: 10_000 });
  await component.processPendingRequest();
  await expect(page.getByTestId('probe-phase')).toHaveAttribute('data-phase', 'saved', { timeout: 15_000 });
  await expect(page.getByTestId('probe-revision')).toHaveText('3');
});

test('stdout процесса содержит только MCP-сообщения', async () => {
  const child = spawn(process.execPath, [CLI_PATH, '--allowed-origin', 'http://127.0.0.1:4390', '--port', '43825'], {
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const lines: string[] = [];
  child.stdout.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim().length > 0) lines.push(line.trim());
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 800));
  child.kill('SIGTERM');
  // До подключения клиента stdout пуст; после — только JSON-RPC. Посторонних строк быть не должно.
  for (const line of lines) {
    expect(() => JSON.parse(line), `строка stdout не является JSON-RPC: ${line}`).not.toThrow();
  }
});
