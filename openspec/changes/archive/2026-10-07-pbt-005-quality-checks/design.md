## Context

Каркас PBT-004 готов: npm workspaces, 4 пакета, команды dev/build/preview/typecheck. Проверки границ ADR-3 выполнялись вручную grep'ом. Решения стека — [ADR PBT-002](../../.docs/adr/PBT-002.md); CI-окружение — GitHub (remote `origin` на GitHub, базовая ветка `develop`). Node 22, npm 11.

## Goals / Non-Goals

**Goals:**

- Единый набор локальных команд: `lint`, `typecheck`, `build`, `test` (unit), `test:browser` (UI).
- CI на GitHub Actions, проверяющий каждый PR в `develop`: lint + typecheck + unit + build + OpenSpec validation.
- Автоматический запрет запрещённых импортов ADR-3 на уровне ESLint.
- Единый шаблон описания PR.

**Non-Goals:**

- Написание продуктовых тестов (идут с возможностями: PBT-007+, доменные правила — PBT-030+).
- Запуск browser-checks в CI (тяжёлая установка браузеров; ручное UI-подтверждение в PR по процессу).
- Автомердж, защитные rules-мержи ветки, деплой (PBT-059), prettier-форматирование (не согласовано).

## Decisions

- **ESLint 9, flat config (`eslint.config.js`).** Один конфиг на монорепо: typescript-eslint (recommended) для `**/*.ts(x)`, `eslint-plugin-react-hooks` (recommended-latest) для `apps/**`. Альтернатива — per-package конфиги: дублирование без выгоды при малом числе пакетов.
- **Границы зависимостей — `no-restricted-imports` по overrides.** Для `packages/dashboard/**` запрещены `@project-board/gantt`, `@project-board/checklist` (и их подпути); для `packages/widget-sdk/**` — все `@project-board/*` кроме самого SDK. Альтернативы (dependency-cruiser, eslint-plugin-boundaries) — отдельные инструменты ради одной задачи; отложены до появления потребности в графах.
- **Unit-раннер — Vitest.** Нативно к Vite-конфигам и TS; запуск `npm run test -ws` (пакеты с тестами); пока тестов нет — команда возвращает успех с предупреждением Vitest «no test files found» (флаг `--passWithNoTests`), чтобы CI был зелёным до первых тестов.
- **Browser-checks — Playwright** (`@playwright/test`), команда `test:browser`; конфиг `playwright.config.ts` с `webServer` на `npm run preview`. В CI не включается; браузеры ставятся локально `npx playwright install chromium`. Первая UI-проверка появится с задачами PBT-018+; до тех пор скрипт есть, контента нет.
- **CI: один workflow `ci.yml`** — `pull_request` в `develop` и `push` в `develop`; шаги: `npm ci` → `lint` → `typecheck` → `unit` → `build` → `openspec validate --all --strict --no-interactive` (OpenSpec CLI ставится `npm i -g @fission-ai/openspec@1.11.0`, версия — из `.context/openspec-setup.md`). Раннер `ubuntu-latest`, `node-version: 22`.
- **Шаблон PR** — `.github/pull_request_template.md` с секциями: PBT-ID и change, Scope, Non-goals, DoD (чек-лист из карточки), Команды проверок (вывод), Визуальное подтверждение UI (скриншот/запись; для не-UI задач — N/A).

## Risks / Trade-offs

- [`--passWithNoTests` может замаскировать переименование каталога тестов] → приемлемо для каркаса; первые доменные тесты (PBT-007+) закрепят структуру `src/**/*.test.ts`, и флаг можно будет снять.
- [Playwright без CI-прогонов требует дисциплины локального запуска] → компенсируется обязательным «визуальным подтверждением UI» в шаблоне PR; перенос в CI — отдельное решение при росте UI-проверок.
- [ESLint-границы не ловят динамические импорты] → запрещены и они (паттерны `no-restricted-imports` покрывают import/require/dynamic), но глубокий анализ графов остаётся за ревью.

## Open Questions

- Нет: выбор инструментов сделан по критерию «минимум зависимостей при полной проверке DoD»; альтернативы зафиксированы для возврата при росте.
