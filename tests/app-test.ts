import { test as base, type Page } from '@playwright/test';
export * from '@playwright/test';

/** Существующие сценарии начинают с пустого дашборда после явного отказа от восстановления. */
export const test = base.extend({
  page: async ({ page, context }, use) => {
    const attached = new WeakSet<Page>();
    const attach = (target: Page): void => {
      if (attached.has(target)) return;
      attached.add(target);
      target.on('domcontentloaded', () => {
        if (target.url().includes('#storage-selftest')) return;
        void target.getByRole('button', { name: 'Продолжить без восстановления' })
          .click({ timeout: 2_000 }).catch(() => {});
      });
    };
    context.on('page', attach);
    for (const target of context.pages()) attach(target);
    await use(page);
    context.off('page', attach);
  },
});
