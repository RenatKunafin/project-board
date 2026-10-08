## 1. SDK: контракт документов

- [x] 1.1 В `packages/widget-sdk/src/documents.ts` определить `DocumentContent`, `ManagedDocument`, `DocumentCreateInput`, `DocumentConflictError`, `DocumentChangeHandler`, `Unsubscribe`; экспортировать из индекса; проверить: typecheck + lint пакета
- [x] 1.2 Unit-тест SDK: `DocumentConflictError` — instanceof Error, хранит актуальную редакцию; проверить: `npm test`

## 2. Платформа: сервис в памяти

- [x] 2.1 Реализовать `packages/dashboard/src/document-service.ts`: `createDocumentService()` с create/get/update(expectedRevision)/subscribe/unsubscribe и getViewSettings/setViewSettings по ключу экземпляра; проверить typecheck + lint
- [x] 2.2 Unit-тесты сервиса по сценариям спецификации: создание, последовательные обновления (ред. 1→2→3), устаревшая редакция → конфликт без изменений, два подписчика, отписка, независимость документов, viewSettings не трогают документ; проверить: `npm test` — все зелёные

## 3. Проверки и завершение

- [x] 3.1 Полный цикл: lint → typecheck → test → build → test:browser; убедиться, что оболочка не изменилась (сервис ещё не подключён в app); прогнать `openspec validate pbt-007-document-state --strict --no-interactive`
- [x] 3.2 Открыть PR в `develop` (шаблон PBT); обновить карточку PBT-007 (DoD) и реестр (In review, ссылка PR)
