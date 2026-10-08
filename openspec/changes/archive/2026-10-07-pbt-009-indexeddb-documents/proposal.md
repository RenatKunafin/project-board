## Why

Документы сейчас живут только в памяти и исчезают при перезагрузке. Согласованное хранилище — IndexedDB через Dexie ([ADR PBT-002](../../.docs/adr/PBT-002.md) ADR-5, решения 15.1–15.3): локальная БД браузера без установки СУБД. Этот change добавляет **адаптер-хранилище** документов с транзакционной проверкой редакции; подключение очереди автосохранения к `DocumentService` — PBT-010, поэтому контракт сервиса не меняется.

## What Changes

- `packages/dashboard`: зависимость `dexie`; `createIndexedDbDocumentStore()` — реализация контракта `DocumentStore` (save с `expectedStoredRevision` / get / listByModule / listByType / delete / close), схема БД версии 1 — единственное хранилище `documents` (keyPath `id`, индексы `moduleId`, `documentType`).
- Атомарность: чтение текущей записи и запись выполняются в одной транзакции `rw` — конкурентные записи с одной исходной редакцией не затирают друг друга (вторая отклоняется `DocumentConflictError`).
- Контракт ошибок: `PersistenceError` с кодом причины (`open-failed`, `write-failed`, `schema-version-unsupported`) для всех отказов адаптера.
- Прямой доступ к IndexedDB изолирован: ESLint-запрет импорта `dexie` и `indexeddb`-API вне `packages/dashboard`.
- Тесты: интеграционные на `fake-indexeddb` (сохранение/чтение, повторное открытие БД, выборки по модулю/типу, конкурентная запись, удаление, неподдерживаемая версия схемы) + браузерный сценарий повторного открытия через техническую самопроверку хранилища в приложении.
- Хранилища `settings/tabs/widgetInstances` не создаются — появятся со своими задачами; эволюция схемы БД — PBT-026.

## Capabilities

### New Capabilities

- `local-persistence`: локальное сохранение документов — чтение после повторного открытия, выборки по модулю и типу, атомарная запись с проверкой редакции, определённый контракт ошибок.

### Modified Capabilities

<!-- документ-management не меняется: контракт DocumentService остаётся прежним,
     store подключается к сервису в PBT-010 -->

## Impact

- `packages/dashboard/src` (адаптер, тесты), `package.json` (dexie, fake-indexeddb), `eslint.config.js` (запрет dexie вне dashboard), `apps/project-board` (техническая самопроверка по hash-маршруту), e2e.
- Вход для PBT-010 (автосохранение), PBT-026 (версии БД и миграции), PBT-028 (данные живут в PWA).
- Контракт `DocumentService` и UI оболочки для пользователя не меняются.
