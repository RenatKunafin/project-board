## 1. SDK

- [x] 1.1 `widget-sdk`: `DocumentMigration` (from/to/migrate), `WidgetDocumentSupport.migrations?`, `DocumentFutureVersionError`, тип поддержки миграций `DocumentMigrationsSupport`; unit-тесты контракта (чистота шагов, версии, ошибка несёт обе версии)

## 2. Сервис и хранилище

- [x] 2.1 `document-store`: `DocumentStoreLike.saveAll(entries)` — одна транзакция адаптера; unit: пакетная фиксация, сбой записи → хранилище целиком в исходном состоянии
- [x] 2.2 `document-service`: инъекция `migrations` в фабрику; `restoreAll` — классификация (actual/outdated/future/unknown), построение цепочек без разрывов, применение в памяти (schemaVersion поднимается, revision/updatedAt сохраняются), фиксация `saveAll`; `listRecoveryIssues()`; guard `DocumentFutureVersionError` в `update`/`rename`/`delete`
- [x] 2.3 Интеграционные тесты на `fake-indexeddb` по DoD: старая фикстура (реальные структуры v0→v1→v2 тестового модуля) → восстановление → повторное открытие с сохранением id/данных; однократность (функции не вызываются повторно); сбой шага — исходный документ нетронут, остальные мигрируют; будущая версия — чтение/отображение ок, update/rename/delete отклонены, хранилище неизменно, откат приложения сохраняет данные; сбой `saveAll` — всё в исходных версиях; разрыв цепочки — проблема с версиями

## 3. Приложение и каталог

- [x] 3.1 `main.tsx`: сбор `DocumentMigrationsSupport` из `widgetTypes` → фабрика сервиса; приложения checkлист/gantt отдают актуальные версии 1 с пустыми списками миграций
- [x] 3.2 Каталог документов: строка будущей версии с отметкой «Версия N — новее поддерживаемой», без кнопок записи, открытие работает; документ не скрывается фильтрами ошибочно

## 4. Проверки

- [x] 4.1 Прогнать `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:browser` (регресс каталога/пространства), `openspec validate --all --strict`; DoD-чекбоксы карточки; реестр (статус `In review`, ссылка на PR)
