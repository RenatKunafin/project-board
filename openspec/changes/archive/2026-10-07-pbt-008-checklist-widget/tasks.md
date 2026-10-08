## 1. SDK: контракт сервиса и контекст экземпляра

- [x] 1.1 Перенести интерфейс `DocumentService` и сопутствующие типы из `packages/dashboard/src/document-service.ts` в `packages/widget-sdk/src/documents.ts`; dashboard импортирует контракт из SDK; проверить: typecheck + lint всех пакетов
- [x] 1.2 Расширить `WidgetProps` опциональными `documentId` и `documentService`; unit-тест реестра: определение типа с компонентом принимает расширенные пропсы; проверить: `npm test`

## 2. Модуль checklist

- [x] 2.1 Реализовать `packages/checklist/src/model.ts`: типы `ChecklistItem`, `ChecklistContent`; иммутабельные операции `addItem` (пустой/пробельный текст возвращает исходный content, id — uuid), `renameItem`, `setItemDone`, `removeItem`; unit-тесты операций по сценариям спецификации (добавление, пустой текст, переименование, отметка, удаление); проверить: `npm test`
- [x] 2.2 Реализовать компонент `ChecklistWidget` (WidgetProps): без documentId/documentService — состояние «документ не привязан»; пустой список — пустое состояние с подсказкой; список пунктов с чекбоксами, inline-переименование по двойному клику, удаление; обновление через `documentService.update(documentId, expectedRevision, nextContent)`; подписка на документ для перерисовки
- [x] 2.3 Определить тип `checklist` (`defineWidgetType`, startSettings, sizeConstraints), экспортировать модульный вход `createChecklistModule()`; проверить: typecheck + lint пакета

## 3. Приложение: два экземпляра одного списка

- [x] 3.1 Удалить демо-виджет PBT-006 (компонент, e2e-проверки, упоминания); подключить модуль `checklist` в `widgets.ts`; в `main.tsx` создать `documentService` и один документ чек-листа; оболочка: каталог (1 тип), два экземпляра одного документа, unknown-блок
- [x] 3.2 Обновить e2e: интерактивное добавление пункта в первом экземпляре и его появление во втором; отметка и удаление; скриншот в change; проверить: `npm run test:browser` — зелёный

## 4. Проверки и завершение

- [x] 4.1 Полный цикл: lint → typecheck → test → build → test:browser; `openspec validate pbt-008-checklist-widget --strict --no-interactive`
- [x] 4.2 Открыть PR в `develop` (шаблон PBT); обновить карточку PBT-008 (DoD) и реестр (In review, PR)
