# Project Board

PWA-дашборд для управления проектами: платформа виджетов (вкладки, тайлинг/каскад) и модули Гантта и чек-листа. Проект на ранней стадии: работает каркас монорепо с пустой оболочкой.

## Запуск

Требуется Node.js ≥ 22 (в разработке используется v22.12.0, npm 11.2.0).

```bash
npm install        # установка зависимостей по lockfile (или npm ci)
npm run dev        # dev-сервер: http://localhost:5173
npm run build      # production-сборка в apps/project-board/dist
npm run preview    # отдача собранной страницы: http://localhost:4173
npm run typecheck  # tsc --noEmit по всем пакетам
npm run lint       # ESLint: код + границы импортов (ADR-002)
npm test           # unit-тесты (Vitest)
npm run test:browser  # UI-проверки (Playwright; локально: npx playwright install chromium)
```

CI (GitHub Actions) на каждый PR в `develop`: lint → typecheck → unit → build → `openspec validate --all --strict`.

## Структура

```text
apps/project-board      # Сборка PWA: Vite + React + TS, оболочка приложения
packages/dashboard      # Универсальная платформа дашборда
packages/widget-sdk     # Публичный контракт платформы и модулей
packages/gantt          # Модуль Гантта (зависит от widget-sdk)
packages/checklist      # Модуль чек-листа (зависит от widget-sdk)
```

Направления зависимостей — [ADR PBT-002](.docs/adr/PBT-002.md): модули используют `widget-sdk`; платформа не импортирует предметные модули; точка регистрации типов виджетов — `apps/project-board/src/widgets.ts`.

## Инструментарий

Node.js 22.12.0 · npm 11.2.0 · Vite 6.4.4 · React 18.3.1 · TypeScript 5.9.3 · Dexie 4.4.6 (IndexedDB)

Проверка артефактов OpenSpec:

```bash
openspec validate --all --strict --no-interactive
```

Техническая самопроверка локального хранилища: `/#storage-selftest` в запущенном приложении.

## Документация

- [Решения по проекту](.context/project-decisions.md) — согласованные решения и открытые вопросы
- [Бэклог](.context/tasks/README.md) — задачи PBT-001–PBT-065 и статусы
- [Процесс работы](.context/openspec-workflow.md) — «одна задача PBT = один OpenSpec change = один PR»
- [Настройка OpenSpec](.context/openspec-setup.md) — версии и установка с нуля
- [ADR](.docs/adr/) — архитектурные решения

Для AI-агентов — [AGENTS.md](AGENTS.md).
