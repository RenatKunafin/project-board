#!/usr/bin/env node
/** PBT-138: контрольные эксперименты — чем kill отличается от graceful close. */
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.CRASH_BASE ?? 'http://localhost:4173';

function chromePids(dir) {
  const result = spawnSync('pgrep', ['-f', `user-data-dir=${dir}`], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout.split('\n').map((s) => Number(s.trim())).filter((n) => n > 0);
}

async function snapshot(page, label) {
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
      return { tabs: rows[0].length, instances: rows[1].length, settings: rows[2].length, documents: rows[3].length };
    } finally { db.close(); }
  });
  console.log(label, JSON.stringify(data));
  return data;
}

async function openApp(profile) {
  const browser = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: false, viewport: { width: 1400, height: 900 } });
  const page = browser.pages()[0] ?? (await browser.newPage());
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  return { browser, page };
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

const profile = join(tmpdir(), `pbt138-ctrl-${Date.now()}`);
mkdirSync(profile, { recursive: true });

// Э1: graceful close после создания — пишет ли close() workspace.
{
  const s = await openApp(profile);
  await createChecklist(s.page, 'ctrl-1');
  await s.page.waitForTimeout(5000); // все debounce-записи завершены до close
  await s.browser.close();
  const r = await openApp(profile);
  await snapshot(r.page, 'Э1 graceful-close, reopen:');
  await r.browser.close();
}

// Э2: kill -9 в покое (5 c после создания).
{
  const s = await openApp(profile);
  await createChecklist(s.page, 'ctrl-2');
  await s.page.waitForTimeout(5000);
  spawnSync('kill', ['-9', ...chromePids(profile).map(String)]);
  await s.browser.close().catch(() => undefined);
  const r = await openApp(profile);
  await snapshot(r.page, 'Э2 kill-в-покое, reopen:');
  await r.browser.close();
}

// Э3: graceful close БЕЗ ожидания (сразу после создания, debounce 250 мс не истёк).
{
  const s = await openApp(profile);
  await createChecklist(s.page, 'ctrl-3');
  await s.browser.close(); // немедленно
  const r = await openApp(profile);
  await snapshot(r.page, 'Э3 close-без-ожидания, reopen:');
  await r.browser.close();
}

rmSync(profile, { recursive: true, force: true });
