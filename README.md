# Project Board

Локальный PWA-дашборд для планирования проектов: вкладки и окна виджетов, сетка и каскад, чек-листы, проектный Гантт и ресурсные дорожки. Документы хранятся в IndexedDB, доступны нескольким окнам и сохраняются автоматически. Поддерживаются импорт/экспорт плана, OnlineGantt, PlantUML, установка и работа без сети.

## Запуск

Нужен Node.js22 и npm с поддержкой workspaces. Из корня чистого checkout:

```bash
npm ci
npm run dev
```

Приложение: http://localhost:5173. Для production-сборки:

```bash
npm run build
npm run preview
```

## Проверки

```bash
npm run verify:repository
npm run lint
npm run typecheck
npm test
npm run build
npm run test:browser
openspec validate --all --strict
```

Для browser-проверок установить Chromium: `npx playwright install chromium`. OpenSpec CLI: `npm install -g @fission-ai/openspec@1.11.0`. Перед browser/benchmark остановить dev и старый preview: тесты используют production-сборку на4173.

Дополнительные команды:

- `npm run test:pwa-updates` — обновление между двумя сборками PWA.
- `npm run test:planning` — сквозные сценарии планирования; окружение — [PBT-057](docs/research/PBT-057.md).
- `npm run bench:release` — headed Chrome и согласованные бюджеты; методика — [PBT-058](docs/research/PBT-058.md).
- `npm run verify:widget-example` — учебный модуль в отдельном чистом checkout текущего коммита.
- `npm run generate:pwa-assets` / `npm run verify:pwa-install` — [иконки и проверка установки](docs/pwa.md).

## Структура

| Путь | Назначение |
| --- | --- |
| apps/project-board | Приложение и регистрация модулей |
| packages/dashboard | Платформа: окна, раскладки, документы и хранение |
| packages/widget-sdk | Публичный контракт виджетов |
| packages/checklist, packages/gantt | Предметные модули |
| examples/counter-widget | Учебный модуль вне продуктовой комплектации |
| tests | Unit-фикстуры, browser, PWA, сквозные проверки и benchmark |
| docs | Руководства, ADR и исследования |
| openspec/specs, openspec/changes | Действующие требования и история изменений |
| .agents | Общие правила и скиллы агентов |

## Документация

[Новый виджет](docs/widget-development.md) · [SDK](packages/widget-sdk/src/index.ts) · [Документы SDK](packages/widget-sdk/src/documents.ts) · [PWA](docs/pwa.md) · [Формат плана](packages/gantt/NATIVE-PLAN-FORMAT.md) · [Каталог документации](docs/README.md).

Для агентов: [AGENTS.md](AGENTS.md), [общие инструкции и подключения](docs/agents.md). В документации нет журнала стадий; историю изменений можно смотреть в git/PR и архиве OpenSpec. Локальная `.context/` владельца не нужна для запуска приложения или прохождения руководства.
