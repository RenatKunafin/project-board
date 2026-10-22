import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium, expect } from '@playwright/test';

// Настоящая установка Chrome через CDP в отдельном временном профиле.
// Нужен запущенный production-preview; основной профиль пользователя не используется.
const url = 'http://localhost:4173/';
const profile = await mkdtemp(join(tmpdir(), 'project-board-pwa-'));
const output = 'test-results/screenshots';
await mkdir(output, { recursive: true });
let context;
let installed = false;
let browserCdp;
try {
  context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: false });
  const page = context.pages()[0];
  await page.goto(url);
  await expect(page.getByRole('status', { name: 'Готовность к офлайн-работе' })).toHaveText('Готово к работе офлайн');
  const cdp = await context.newCDPSession(page);
  const manifest = await cdp.send('Page.getAppManifest');
  const installability = await cdp.send('Page.getInstallabilityErrors');
  expect(installability.installabilityErrors).toEqual([]);
  await cdp.send('PWA.install', { manifestId: url, installUrlOrBundleUrl: url });
  installed = true;
  // CDP устанавливает без диалога браузера: явно выбираем то же
  // пользовательское «Открывать в отдельном окне», что и при ручной установке.
  await cdp.send('PWA.changeAppUserSettings', { manifestId: url, displayMode: 'standalone' });
  await page.close();
  // Закрыты все окна приложения. Новое запускается из установленной записи.
  // CDP-сессия страницы уже закрыта; browser session остаётся доступной.
  browserCdp = await context.browser().newBrowserCDPSession();
  await context.setOffline(true);
  const opened = context.waitForEvent('page');
  const launch = await browserCdp.send('PWA.launch', { manifestId: url });
  const app = await opened;
  await expect(app.getByRole('heading', { name: 'Project Board', exact: true })).toBeVisible();
  await expect(app.getByRole('status', { name: 'Готовность к офлайн-работе' })).toHaveText('Готово к работе офлайн');
  const standalone = await app.evaluate(() => matchMedia('(display-mode: standalone)').matches);
  expect(standalone).toBe(true);
  const window = await browserCdp.send('Browser.getWindowForTarget', { targetId: launch.targetId });
  await app.screenshot({ path: `${output}/pwa-installed-chrome.png` });
  const report = {
    browser: context.browser().version(), manifest: manifest.manifest,
    installability, launch, window, standalone,
    offlineRelaunch: true,
  };
  await writeFile(`${output}/pwa-installation.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  try {
    if (installed) {
      const cleanupCdp = browserCdp ?? await context.browser().newBrowserCDPSession();
      await cleanupCdp.send('PWA.uninstall', { manifestId: url });
    }
  } finally {
    await context?.close();
    // Chrome/macOS иногда оставляет app shim после CDP uninstall. Удаляем
    // только ярлык, ссылающийся на созданный этой проверкой временный профиль.
    if (process.platform === 'darwin') {
      const shortcut = join(homedir(), 'Applications/Chrome Apps.localized/Project Board.app');
      const { stdout } = await promisify(execFile)('plutil', [
        '-extract', 'CrAppModeUserDataDir', 'raw', '-o', '-', join(shortcut, 'Contents/Info.plist'),
      ]).catch(() => ({ stdout: '' }));
      if (stdout.trim().startsWith(`${profile}/`)) {
        await rm(shortcut, { recursive: true, force: true });
      }
    }
    await rm(profile, { recursive: true, force: true });
  }
}
