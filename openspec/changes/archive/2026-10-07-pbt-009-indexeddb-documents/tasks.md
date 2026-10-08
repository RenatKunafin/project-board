## 1. Адаптер хранилища

- [x] 1.1 Добавить `dexie` в `packages/dashboard`, `fake-indexeddb` в корневые devDependencies; реализовать `document-store.ts`: тип `PersistenceErrorCode`, класс `PersistenceError`, интерфейс `DocumentStore`, `createIndexedDbDocumentStore(name)` (схема v1: `documents: 'id, moduleId, documentType'`, атомарная транзакция save, get/listByModule/listByType/delete/close); проверить: typecheck + lint
- [x] 1.2 Добавить ESLint-запрет `dexie` вне `packages/dashboard`; проверить: контрольный импорт в `packages/checklist` роняет lint, после отката проходит

## 2. Интеграционные тесты

- [x] 2.1 Настроить `fake-indexeddb` для Vitest; интеграционные тесты: сохранение/чтение, повторное открытие БД (close → reopen), выборки по модулю и типу, удаление (включая отсутствующий), конкурентные записи с одной исходной редакцией, запись поверх другой редакции; проверить: `npm test`
- [x] 2.2 Тест ошибки версии: БД, созданная более высокой версией схемы, открывается ошибкой `PersistenceError('schema-version-unsupported')`; проверить: `npm test`

## 3. Браузерный сценарий и завершение

- [x] 3.1 Техническая самопроверка хранилища в приложении по hash-маршруту `#storage-selftest` (save → close → reopen → get → конкурентная запись → результат в DOM); e2e-тест сценария и повторного открытия; скриншот в change; проверить: `npm run test:browser`
- [x] 3.2 Полный цикл: lint → typecheck → test → build → test:browser; `openspec validate pbt-009-indexeddb-documents --strict --no-interactive`; обновить README/`.context/openspec-setup.md` (Dexie версия); открыть PR в `develop`, обновить карточку PBT-009 и реестр
