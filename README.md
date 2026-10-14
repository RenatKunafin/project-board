# Project Board

PWA-дашборд для управления проектами: платформа виджетов (вкладки, каталог, тайлинг/каскад) и модули чек-листа и Гантта.

**Текущая стадия:** платформа дашборда завершена: вкладки, каталог виджетов, рамка окон (сворачивание/закрытие/активность), тайлинг и каскад с переключением режимов на вкладке, восстановление всего пространства после перезапуска, каталог документов с переименованием, удалением и повторным открытием (dropdown-панели), версии БД и миграции документов с защитой от перезаписи документов будущих версий, жизненный цикл скрытых виджетов (вкладки не размонтируются, видимость и размеры передаются виджетам, ошибки рендера изолированы); чек-лист с общими документами; локальное хранение и автосохранение (IndexedDB). Ядро Гантта завершено: документ плана v1, операции над задачами и ручными датами, иерархия групп со сводными сроками, справочники ресурсов и типов работ с параллельностью, назначения задач и периоды недоступности ([ADR PBT-017](.docs/adr/PBT-017.md): SVAR — проектный вид, React Calendar Timeline — ресурсный). Далее — FS-зависимости, проверки конфликтов и продуктовые представления Гантта. Прогресс и статусы — [реестр задач](.context/tasks/README.md).

## Запуск

Требуется Node.js ≥ 22 (в разработке используется v22.12.0, npm 11.2.0).

```bash
npm install        # установка зависимостей по lockfile (или npm ci)
npm run dev        # основное приложение: http://localhost:5173
npm run dev:load-demo  # нагрузочный стенд Гантта: http://localhost:5176 (не в прод-сборке, до PBT-058)
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
apps/load-demo          # Нагрузочный стенд Гантта (PBT-016), не входит в прод-сборку
packages/dashboard      # Универсальная платформа дашборда
packages/widget-sdk     # Публичный контракт платформы и модулей
packages/gantt          # Модуль Гантта (зависит от widget-sdk)
packages/checklist      # Модуль чек-листа (зависит от widget-sdk)
```

Направления зависимостей — [ADR PBT-002](.docs/adr/PBT-002.md): модули используют `widget-sdk`; платформа не импортирует предметные модули; точка регистрации типов виджетов — `apps/project-board/src/widgets.ts`.

## Инструментарий

Node.js 22.12.0 · npm 11.2.0 · Vite 6.4.4 · React 18.3.1 · TypeScript 5.9.3 · Dexie 4.4.6 (IndexedDB) · React Grid Layout 1.4.4 и react-rnd 10.5.3 (раскладки, [ADR PBT-017](.docs/adr/PBT-017.md)) · SVAR React Gantt 2.8.0 и React Calendar Timeline 0.30.0-beta.19 (выбраны, [ADR PBT-017](.docs/adr/PBT-017.md); подключаются задачами представлений)

Проверка артефактов OpenSpec:

```bash
openspec validate --all --strict
```

Техническая самопроверка локального хранилища: `/#storage-selftest` в запущенном приложении.

## Документация

Локальная (`.context/`, не в git): [решения по проекту](.context/project-decisions.md), [бэклог и статусы](.context/tasks/README.md), [процесс работы](.context/openspec-workflow.md), [настройка OpenSpec](.context/openspec-setup.md), [макеты](.context/layout/).

В репозитории: [ADR](.docs/adr/) (PBT-002 — границы платформы, PBT-003 — семантика редактирования плана, PBT-017 — компоненты Гантта), [отчёты исследований](.docs/research/) (PBT-011–PBT-016), [действующие спецификации](openspec/specs/).

Для AI-агентов — [AGENTS.md](AGENTS.md): порядок погружения, процесс, конвенции.
