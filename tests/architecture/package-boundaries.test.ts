import { afterAll, describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createConfig } from '../../eslint.config.js';

const rule = 'project-board/package-boundaries';
const eslint = new ESLint();
const widget = 'packages/gantt/src/boundary-fixture.ts';

async function lint(instance: ESLint, filePath: string, code: string) {
  const [result] = await instance.lintText(code, { filePath });
  expect(result.messages.filter((message) => message.fatal)).toEqual([]);
  return result.messages.filter((message) => message.ruleId === rule);
}

describe('границы пакетов через действующую конфигурацию ESLint', () => {
  it.each(['widget-sdk', 'dashboard', 'gantt', 'checklist'])('правило включено в %s', async (pkg) => {
    const config = await eslint.calculateConfigForFile(`packages/${pkg}/src/index.ts`);
    expect(config.rules[rule]).toEqual([2]);
  });

  it.each([
    ['SDK → платформа', 'packages/widget-sdk/src/fixture.ts', "import '@project-board/dashboard';"],
    ['SDK → модуль', 'packages/widget-sdk/src/fixture.ts', "export * from '@project-board/gantt';"],
    ['платформа → модуль', 'packages/dashboard/src/fixture.ts', "import '@project-board/gantt';"],
    ['модуль → платформа', widget, "import '@project-board/dashboard';"],
    ['модуль → сосед', widget, "import '@project-board/checklist';"],
    ['глубокий workspace', widget, "import '@project-board/dashboard/src/WidgetWindow';"],
    ['относительный', widget, "import '../../dashboard/src/WidgetWindow';"],
    ['нормализованный', widget, "import '../../checklist/../dashboard/src/WidgetWindow';"],
    ['workspace через локальный node_modules', widget, "import '../node_modules/@project-board/dashboard/src/WidgetWindow';"],
    ['из вложенной папки', 'packages/gantt/src/ui/forms/fixture.ts', "import '../../../../dashboard/src/WidgetWindow';"],
    ['к приложению', widget, "import '../../../apps/project-board/src/App';"],
    ['к корневому helper', widget, "import '../../../scripts/verify-repository.mjs';"],
    ['внутренности SDK', widget, "import '@project-board/widget-sdk/src/documents';"],
    ['относительный SDK', widget, "import '../../widget-sdk/src/documents';"],
    ['неизвестный workspace', widget, "import '@project-board/future-module';"],
    ['type-only import', widget, "import type { WidgetProps } from '@project-board/dashboard'; export type { WidgetProps };"],
    ['type-only export', widget, "export type { WidgetProps } from '@project-board/dashboard';"],
    ['import-type', widget, "export type Props = import('@project-board/dashboard').WidgetProps;"],
    ['динамический', widget, "void import('@project-board/dashboard');"],
    ['шаблон без вычислений', widget, 'void import(`@project-board/dashboard`);'],
    ['require', widget, "require('@project-board/dashboard');"],
    ['import-equals', widget, "import platform = require('@project-board/dashboard'); export { platform };"],
    ['учебный → платформа', 'examples/counter-widget/src/fixture.ts', "import '@project-board/dashboard';"],
    ['Dexie из модуля', widget, "import 'dexie';"],
    ['Dexie из SDK', 'packages/widget-sdk/src/fixture.ts', "import 'dexie';"],
    ['Dexie из приложения', 'apps/project-board/src/fixture.ts', "import 'dexie';"],
    ['подпуть Dexie', widget, "void import('dexie/dist/dexie');"],
    ['Dexie через node_modules', 'apps/project-board/src/fixture.ts', "import '../../../node_modules/dexie/dist/dexie';"],
    ['реэкспорт Dexie', widget, "export * from 'dexie';"],
    ['require Dexie', widget, "require('dexie');"],
    ['UI SDK', 'packages/widget-sdk/src/fixture.ts', "import '@svar-ui/react-gantt';"],
    ['UI подпуть SDK', 'packages/widget-sdk/src/fixture.ts', "import 'react-dom/client';"],
    ['UI через node_modules SDK', 'packages/widget-sdk/src/fixture.ts', "import '../../../node_modules/react-dom/client';"],
    ['абсолютный путь', widget, `import ${JSON.stringify(join(process.cwd(), 'packages/dashboard/src/WidgetWindow'))};`],
  ])('отклоняет %s', async (_label, filePath, code) => {
    const messages = await lint(eslint, filePath, code);
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain('ADR PBT-002');
  });

  it.each([
    ['SDK модуля', widget, "import '@project-board/widget-sdk';"],
    ['SDK платформы', 'packages/dashboard/src/fixture.ts', "import '@project-board/widget-sdk';"],
    ['собственные исходники', widget, "import './plan-document';"],
    ['внутренняя нормализация', 'packages/gantt/src/ui/fixture.ts', "import '../ui/../plan-document';"],
    ['собственное имя', widget, "import '@project-board/gantt';"],
    ['внешняя библиотека', widget, "import '@svar-ui/react-gantt';"],
    ['похожее имя', widget, "import 'dexie-tools';"],
    ['типы React в SDK', 'packages/widget-sdk/src/fixture.ts', "import type { ComponentType } from 'react'; export type { ComponentType };"],
    ['Vitest в SDK', 'packages/widget-sdk/src/fixture.test.ts', "import 'vitest';"],
    ['SDK учебного виджета', 'examples/counter-widget/src/fixture.ts', "import '@project-board/widget-sdk';"],
    ['composition root', 'apps/project-board/src/fixture.ts', "import '@project-board/gantt';"],
    ['интеграционный тест', 'tests/fixture.ts', "import '../packages/gantt/src/plan-document';"],
    ['адаптер БД', 'packages/dashboard/src/fixture.ts', "import 'dexie'; void import('dexie/dist/dexie');"],
    ['затенённый require', widget, "function load(require: (s: string) => void) { require('@project-board/dashboard'); } export { load };"],
    ['вычисляемый путь вне проверки', widget, "export function load(path: string) { return import(path); }"],
  ])('разрешает %s', async (_label, filePath, code) => {
    expect(await lint(eslint, filePath, code)).toEqual([]);
  });
});

describe('новый пакет без изменения списка модулей', () => {
  const root = mkdtempSync(join(tmpdir(), 'pbt-091-boundaries-'));
  for (const [directory, name] of [
    ['packages/dashboard', '@project-board/dashboard'],
    ['packages/widget-sdk', '@project-board/widget-sdk'],
    ['packages/new-widget', '@custom/new-widget'],
    ['examples/sample', '@custom/sample'],
  ]) {
    const path = join(root, directory, 'package.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ name }));
  }
  const instance = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: createConfig(root) });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('защищает новый модуль и разрешает публичный SDK', async () => {
    const file = join(root, 'packages/new-widget/src/index.ts');
    expect(await lint(instance, file, "import '@project-board/dashboard';")).toHaveLength(1);
    expect(await lint(instance, file, "import '@project-board/widget-sdk';")).toEqual([]);
  });

  it('находит модуль по package.json при несовпадении имени и папки', async () => {
    const file = join(root, 'packages/dashboard/src/index.ts');
    expect(await lint(instance, file, "import '@custom/new-widget';")).toHaveLength(1);
    expect(await lint(instance, file, "import '@custom/new-widget/src/private';")).toHaveLength(1);
  });

  it('защищает новый учебный модуль', async () => {
    const file = join(root, 'examples/sample/src/index.ts');
    expect(await lint(instance, file, "import '@custom/new-widget';")).toHaveLength(1);
    expect(await lint(instance, file, "import '@project-board/widget-sdk';")).toEqual([]);
  });
});
