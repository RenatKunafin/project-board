## 1. Очередь автосохранения в сервисе

- [x] 1.1 `createDocumentService({ store, saveDelayMs })`: очередь per-document (pending последней редакции, debounce-таймер, lastSavedRevision, inFlight), состояния сохранения `saved/saving/error/conflict` + `subscribeSaveState/getSaveState`; сохранить обратную совместимость (без store — прежнее поведение, тесты PBT-007 зелёные); проверить: `npm test`
- [x] 1.2 Реализовать flush: одна запись последней редакции, retry до 3 попыток (250/500/1000 мс), `error` после исчерпания, повтор по следующей операции; конфликт `DocumentConflictError` → перечитывание из store, уведомление, `conflict`, отбрасывание несохранённого pending; проверить: `npm test`
- [x] 1.3 Unit-тесты на FakeStore: быстрые операции → одна запись последней редакции; создание → expectedStoredRevision 0; порядок сохранений; сбой → error без потери, восстановление хранилища → следующая операция сохраняет; конфликт → перечитывание + уведомление; DoD-5: два «представления» (подписчика) не создают конкурирующих очередей; проверить: `npm test`

## 2. Восстановление и приложение

- [x] 2.1 `DocumentStore.listAll()` (реализация + тест интеграции) и `service.restoreAll()`; проверить: `npm test`
- [x] 2.2 Приложение: bootstrap в `main.tsx` (store `project-board`, restoreAll, создать чек-лист только при отсутствии), индикатор состояния сохранения в `App`; проверить: `npm run dev` — индикатор «Сохранено» после операции, перезагрузка восстанавливает список
- [x] 2.3 E2E: перезагрузка страницы восстанавливает пункты чек-листа; конфликт двух страниц: страница B перечитывает правку страницы A при конфликте записи; скриншоты в change; проверить: `npm run test:browser`

## 3. Проверки и завершение

- [x] 3.1 Полный цикл: lint → typecheck → test → build → test:browser; `openspec validate pbt-010-document-autosave --strict --no-interactive`
- [x] 3.2 Открыть PR в `develop` (шаблон PBT); обновить карточку PBT-010 (DoD) и реестр (In review, PR)
