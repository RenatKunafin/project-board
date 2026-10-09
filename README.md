# Project Board

PWA-дашборд для управления проектами: платформа виджетов (вкладки, каталог, тайлинг/каскад) и модули чек-листа и Гантта.

**Текущая стадия:** платформа работает — вкладки, каталог виджетов, чек-лист с общими документами, локальное хранение и автосохранение (IndexedDB). Гантт — на этапе выбора компонента: ведётся спайк SVAR ([отчёт](.docs/research/PBT-014.md)), итоговое решение — задача PBT-017. Прогресс и статусы — [реестр задач](.context/tasks/README.md).

## Запуск

Требуется Node.js ≥ 22 (в разработке используется v22.12.0, npm 11.2.0).

```bash
npm install        # установка зависимостей по lockfile (или npm ci)
npm run dev        # основное приложение: http://localhost:5173
npm run dev:spike  # исследовательский стенд Гантта: http://localhost:5174 (не в прод-сборке)
npm run build      # production-сборка в apps/project-board/dist
npm run preview    # отдача собранной страницы: http://localhost:4173
npm run typecheck  # tsc --noEmit по всем пакетам
npm run lint       # ESLint: код + границы импортов (ADR PBT-002)
npm test           # unit-тесты (Vitest)
npm run test:browser  # UI-проверки (Playwright; локально: npx playwright install chromium)
```

CI (GitHub Actions) на каждый PR в `develop`: lint → typecheck → unit → build → `openspec validate --all --strict`.

## Структура

```text
apps/project-board      # Сборка PWA: Vite + React + TS, оболочка приложения
apps/gantt-spike        # Спайк SVAR (PBT-014), не входит в прод-сборку
packages/dashboard      # Универсальная платформа дашборда
packages/widget-sdk     # Публичный контракт платформы и модулей
packages/gantt          # Модуль Гантта (зависит от widget-sdk)
packages/checklist      # Модуль чек-листа (зависит от widget-sdk)
```

Направления зависимостей — [ADR PBT-002](.docs/adr/PBT-002.md): модули используют `widget-sdk`; платформа не импортирует предметные модули; точка регистрации типов виджетов — `apps/project-board/src/widgets.ts`.

## Инструментарий

Node.js 22.12.0 · npm 11.2.0 · Vite 6.4.4 · React 18.3.1 · TypeScript 5.9.3 · Dexie 4.4.6 (IndexedDB) · SVAR React Gantt 2.8.0 (спайк)

Проверка артефактов OpenSpec:

```bash
openspec validate --all --strict
```

Техническая самопроверка локального хранилища: `/#storage-selftest` в запущенном приложении.

## Документация

Локальная (`.context/`, не в git): [решения по проекту](.context/project-decisions.md), [бэклог и статусы](.context/tasks/README.md), [процесс работы](.context/openspec-workflow.md), [настройка OpenSpec](.context/openspec-setup.md), [макеты](.context/layout/).

В репозитории: [ADR](.docs/adr/) (PBT-002 — границы платформы, PBT-003 — семантика редактирования плана), [отчёты исследований](.docs/research/) (PBT-011, PBT-012, PBT-014), [действующие спецификации](openspec/specs/).

Для AI-агентов — [AGENTS.md](AGENTS.md): порядок погружения, процесс, конвенции.
