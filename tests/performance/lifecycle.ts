import { expect, type Page, type BrowserContext } from '@playwright/test';
import { addView, newPlan } from './setup';
import { storedPlan } from '../planning/helpers';
import type { benchmarkData } from './data';

export async function lifecycle(page: Page, context: BrowserContext, data: Awaited<ReturnType<typeof benchmarkData>>[number]) {
  const session = await context.newCDPSession(page);
  const memory = async () => {
    // SVAR удерживает callbacks восстановления прокрутки до 2 с (PBT-073).
    // Снимок после завершения этого окна, вне измеряемых операций.
    await page.waitForTimeout(2200);
    await session.send('HeapProfiler.collectGarbage');
    return { heap: await session.send('Runtime.getHeapUsage'), dom: await session.send('Memory.getDOMCounters'),
      subscriptions: await page.evaluate(() => window.__projectBoard!.activeSubscriptionCount()) };
  };
  const base = await page.evaluate(() => window.__projectBoard!.activeSubscriptionCount());
  const samples = [];
  // Разогрев выделений библиотек до контрольной baseline.
  for (let cycle = 0; cycle <= 20; cycle++) {
    await addView(page, data.title);
    const pane = page.getByRole('group', { name: `План · ${data.title}`, exact: true }).last();
    await expect.poll(() => page.evaluate(() => window.__projectBoard!.activeSubscriptionCount())).toBe(base + 1);
    await pane.getByRole('button', { name: /^Свернуть/ }).click();
    await pane.getByRole('button', { name: /^Развернуть План/ }).click();
    await pane.getByRole('button', { name: /^Закрыть План/ }).click();
    await expect.poll(() => page.evaluate(() => window.__projectBoard!.activeSubscriptionCount())).toBe(base);
    if (cycle % 5 === 0) samples.push({ cycle, ...await memory() });
  }
  const title = 'Временный документ benchmark';
  const json = JSON.stringify({ ...JSON.parse(data.json), title });
  const id = await newPlan(page, { ...data, title, json });
  await page.getByRole('group', { name: `План · ${title}`, exact: true }).getByRole('button', { name: /^Закрыть/ }).click();
  await expect.poll(() => page.evaluate(() => window.__projectBoard!.activeSubscriptionCount())).toBe(base);
  await page.getByRole('button', { name: 'Каталог документов', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: 'Каталог документов' });
  for (const name of [title, `Подготовка ${title}`]) {
    const row = catalog.locator('.doc-catalog__row').filter({ has: page.getByText(name, { exact: true }) });
    await row.getByRole('button', { name: `Удалить «${name}»`, exact: true }).click();
    await catalog.locator('.doc-catalog__confirm').getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(catalog.getByText(name, { exact: true })).toHaveCount(0);
  }
  await page.keyboard.press('Escape');
  await expect.poll(() => storedPlan(page, id)).toBeNull();
  expect(await page.evaluate(id => window.__projectBoard!.readDocument(id), id)).toBeUndefined();
  const afterDelete = await memory();
  await session.detach();
  return { taskCount: data.content.tasks.length, samples, deletedDocumentAbsent: true, afterDelete };
}
