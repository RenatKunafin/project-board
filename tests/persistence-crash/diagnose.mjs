#!/usr/bin/env node
/**
 * PBT-138, фаза 1: стенд воспроизведения потери данных при kill -9 Chrome.
 * Чистый профиль (tmp), production preview приложения, серии жестких убийств
 * браузера с последующей проверкой выживших документов и вскрытием хранилища.
 *
 * Использование: node tests/persistence-crash/diagnose.mjs [--series A|B|C] [--iters N] [--base URL]
 * Требует: собранного приложения (npm run build) и запущенного preview на 4173.
 */
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, readdirSync, statSync, existsSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BASE = process.env.CRASH_BASE ?? 'http://localhost:4173';
const OUT_DIR = resolve('test-results/persistence-crash');
const JOURNAL = join(OUT_DIR, `diagnose-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
mkdirSync(OUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const SERIES = flag('series', 'A');
const ITERS = Number(flag('iters', SERIES === 'A' ? 7 : SERIES === 'B' ? 7 : SERIES === 'C' ? 6 : 5));
const D_DOCS = Number(flag('ddocs', 20));
const D_ITEMS = Number(flag('ditems', 30));

function log(entry) {
  appendFileSync(JOURNAL, `${JSON.stringify(entry)}\n`);
  console.log(JSON.stringify(entry));
}

function profileDir() {
  const dir = join(tmpdir(), `pbt138-${SERIES}-${Date.now()}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Все PID Chrome, запущенные с данным профилем. */
function chromePids(dir) {
  const result = spawnSync('pgrep', ['-f', `user-data-dir=${dir}`], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout.split('\n').map((line) => Number(line.trim())).filter((pid) => Number.isFinite(pid) && pid > 0);
}

function killChrome(dir) {
  const pids = chromePids(dir);
  if (pids.length === 0) return { killed: [] };
  spawnSync('kill', ['-9', ...pids.map(String)]);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (chromePids(dir).length === 0) break;
    spawnSync('sleep', ['0.25']);
  }
  return { killed: pids };
}

/** Снимок каталогов IndexedDB профиля. */
function idbSnapshot(dir) {
  const roots = ['Default', 'Profile 1'];
  const out = [];
  for (const root of roots) {
    const idb = join(dir, root, 'IndexedDB');
    if (!existsSync(idb)) continue;
    for (const entry of readdirSync(idb)) {
      const full = join(idb, entry);
      const files = readdirSync(full).map((file) => {
        const path = join(full, file);
        return { file, size: statSync(path).size };
      });
      out.push({ origin: entry, files });
    }
  }
  return out;
}

async function openApp(profile, attemptName) {
  const browser = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1400, height: 900 },
  });
  const page = browser.pages()[0] ?? (await browser.newPage());
  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300)); });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  return { browser, page, consoleErrors };
}

/** Сколько документов серии видно на восстановленной вкладке. */
async function visibleDocuments(page, prefix) {
  await page.waitForTimeout(1500);
  const groups = page.getByRole('group', { name: new RegExp(`^Чек-лист · ${prefix}-`) });
  return groups.count();
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

async function main() {
  log({ event: 'start', series: SERIES, iters: ITERS, base: BASE });
  const profile = profileDir();

  // Серия D: тяжёлая БД — много документов с пунктами, затем kill во время записи.
  if (SERIES === 'D') {
    const seed = await openApp(profile, 'D-seed');
    for (let doc = 1; doc <= D_DOCS; doc += 1) {
      const title = `D-${String(doc).padStart(2, '0')}`;
      await createChecklist(seed.page, title);
      const pane = seed.page.getByRole('group', { name: `Чек-лист · ${title}`, exact: true });
      const input = pane.getByPlaceholder('Новая задача…');
      for (let item = 1; item <= D_ITEMS; item += 1) {
        await input.fill(`пункт ${doc}.${item}`);
        await input.press('Enter');
      }
      log({ event: 'seed-doc', series: 'D', title, items: D_ITEMS });
    }
    await seed.browser.close().catch(() => undefined);
    log({ event: 'seed-done', series: 'D', docs: D_DOCS, idb: idbSnapshot(profile) });
  }

  const expectedDocs = SERIES === 'D' ? D_DOCS : 0;

  for (let index = 1; index <= ITERS; index += 1) {
    const title = SERIES === 'D' ? `D-${String(D_DOCS).padStart(2, '0')}` : `${SERIES}-${String(index).padStart(2, '0')}`;
    const before = idbSnapshot(profile);

    // Открыть приложение (первый раз — чистый профиль), создать документ серии.
    const session = await openApp(profile, title);
    const survivedBeforeCreate = await visibleDocuments(session.page, SERIES === 'D' ? 'D' : SERIES);
    let created = 0;
    if (SERIES !== 'D') {
      await createChecklist(session.page, title);
      created = (await visibleDocuments(session.page, SERIES)) - survivedBeforeCreate;
    }

    // Задержка до kill по сценарию серии.
    if (SERIES === 'A') await session.page.waitForTimeout(5000); // покой: всё сохранено
    if (SERIES === 'C') await session.page.waitForTimeout(350); // на грани debounce (250 мс)

    const afterBeforeKill = idbSnapshot(profile);
    let kill;
    if (SERIES === 'B') {
      // Kill во время активной записи пунктов чек-листа.
      const pane = session.page.getByRole('group', { name: `Чек-лист · ${title}`, exact: true });
      const input = pane.getByPlaceholder('Новая задача…');
      let writing = true;
      const writer = (async () => {
        for (let item = 1; item <= 200 && writing; item += 1) {
          await input.fill(`пункт ${item}`);
          await input.press('Enter');
          await session.page.waitForTimeout(150);
        }
      })().catch(() => undefined);
      await session.page.waitForTimeout(1500);
      kill = killChrome(profile);
      writing = false;
      await writer;
    } else {
      kill = killChrome(profile);
    }
    await session.browser.close().catch(() => undefined);
    const afterKill = idbSnapshot(profile);

    // Перезапуск: что выжило?
    const restart = await openApp(profile, `${title}-restart`);
    const survived = await visibleDocuments(restart.page, SERIES === 'D' ? 'D' : SERIES);
    const expected = SERIES === 'D' ? expectedDocs : index;
    // Глубокая проверка серии D: фактическое содержимое БД против DOM.
    let deep = null;
    if (SERIES === 'D') {
      await restart.page.waitForTimeout(6000);
      deep = await restart.page.evaluate(async () => {
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
          return {
            tabs: rows[0].length,
            widgetInstances: rows[1].length,
            settings: rows[2].length,
            documents: rows[3].map((row) => row.title),
            domWindows: document.querySelectorAll('.widget-window').length,
          };
        } finally { db.close(); }
      });
    }
    const internals = await restart.page
      .goto('chrome://indexeddb-internals')
      .then(async () => restart.page.evaluate(() => document.body.innerText.slice(0, 2000)))
      .catch((error) => `internals недоступны: ${String(error).slice(0, 120)}`);
    const afterRestart = idbSnapshot(profile);

    log({
      event: 'iteration',
      series: SERIES,
      index,
      title,
      created,
      survivedBeforeCreate,
      survivedAfterRestart: survived,
      expected,
      verdict:
        survived === index ? 'survived' : survived === 0 ? 'total-loss' : 'partial-loss',
      killedPids: kill.killed.length,
      idbBefore: before.length,
      idbBeforeKill: afterBeforeKill.length,
      idbAfterKill: afterKill.length,
      idbAfterRestart: afterRestart,
      consoleErrors: restart.consoleErrors,
      deep,
      internalsPreview: String(internals).slice(0, 600),
    });
    await restart.browser.close().catch(() => undefined);
  }

  rmSync(profile, { recursive: true, force: true });
  log({ event: 'done', series: SERIES });
}

await main();
