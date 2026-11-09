#!/usr/bin/env node
/** PBT-138: пошаговая локализация потери widgetInstances (D-lite, снимки БД на каждом шаге). */
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.CRASH_BASE ?? 'http://localhost:4173';
const DOCS = Number(process.env.DL_DOCS ?? 5);

function chromePids(dir) {
  const result = spawnSync('pgrep', ['-f', `user-data-dir=${dir}`], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout.split('\n').map((s) => Number(s.trim())).filter((n) => n > 0);
}

async function snapshot(page, label) {
  try {
    const data = await page.evaluate(async () => {
      const request = indexedDB.open('project-board');
      const db = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const names = ['tabs', 'widgetInstances', 'settings', 'documents'];
        const tx = db.transaction(names);
        const rows = await Promise.all(names.map((name) => new Promise((resolve, reject) => {
          const read = tx.objectStore(name).getAll();
          read.onsuccess = () => resolve(read.result);
          read.onerror = () => reject(read.error);
        })));
        return { tabs: rows[0].length, instances: rows[1].length, settings: rows[2].length, documents: rows[3].length, domWindows: document.querySelectorAll('.widget-window').length };
      } finally { db.close(); }
    });
    console.log(label, JSON.stringify(data));
    return data;
  } catch (error) {
    console.log(label, 'ОШИБКА СНЯТИЯ:', String(error).slice(0, 150));
    return null;
  }
}

async function openApp(profile) {
  const browser = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: false, viewport: { width: 1400, height: 900 } });
  const page = browser.pages()[0] ?? (await browser.newPage());
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  return { browser, page, errors };
}

async function createChecklist(page, title) {
  const fromEmpty = (await page.getByRole('button', { name: 'Добавить виджет на вкладку', exact: true }).count()) > 0;
  await page.getByRole('button', { name: fromEmpty ? 'Добавить виджет на вкладку' : 'Виджеты', exact: true }).click();
  const catalog = page.getByRole('dialog', { name: 'Каталог виджетов' });
  await catalog.getByRole('button', { name: 'Чек-лист', exact: true }).click();
  await catalog.getByLabel('Название нового документа').fill(title);
  await catalog.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.getByRole('group', { name: `Чек-лист · ${title}`, exact: true }).waitFor({ timeout: 15_000 });
  await page.keyboard.press('Escape');
}

const profile = join(tmpdir(), `pbt138-lite-${Date.now()}`);
mkdirSync(profile, { recursive: true });

// Шаг 1: seed N документов, снимки после каждого.
{
  const s = await openApp(profile);
  for (let i = 1; i <= DOCS; i += 1) {
    await createChecklist(s.page, `lite-${i}`);
    await s.page.waitForTimeout(600); // debounce запас
  }
  await snapshot(s.page, 'шаг1 seed в памяти/БД:      ');
  await s.browser.close();
}
// Шаг 2: reopen после graceful close.
{
  const s = await openApp(profile);
  await snapshot(s.page, 'шаг2 после close, reopen:   ');
  await s.browser.close();
}
// Шаг 3: reopen + активная запись пунктов + kill.
{
  const s = await openApp(profile);
  await snapshot(s.page, 'шаг3 старт рабочей сессии:  ');
  const pane = s.page.getByRole('group', { name: `Чек-лист · lite-${DOCS}`, exact: true });
  const input = pane.getByPlaceholder('Новая задача…');
  let writing = true;
  const writer = (async () => {
    for (let item = 1; item <= 200 && writing; item += 1) {
      await input.fill(`пункт ${item}`);
      await input.press('Enter');
      await s.page.waitForTimeout(120);
    }
  })().catch(() => undefined);
  await s.page.waitForTimeout(1200);
  spawnSync('kill', ['-9', ...chromePids(profile).map(String)]);
  writing = false;
  await writer;
  await s.browser.close().catch(() => undefined);
}
// Шаг 4: reopen после kill.
{
  const s = await openApp(profile);
  await s.page.waitForTimeout(3000);
  await snapshot(s.page, 'шаг4 после kill, reopen:    ');
  if (s.errors.length) console.log('console errors шага4:', s.errors.slice(0, 3));
  await s.browser.close();
}

rmSync(profile, { recursive: true, force: true });
