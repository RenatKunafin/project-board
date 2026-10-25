## 1. SDK и модуль чек-листа

- [x] 1.1 `widget-sdk`: `WidgetTypeDefinition` + `icon?: string`, `documentSupport?: { moduleId, documentType, schemaVersion, createContent(title) }`; `AutosavingDocumentService.listDocuments(filter)` (дельта document-management); проверить: typecheck + lint
- [ ] 1.2 `checklist`: `ChecklistContent.title?` (операции сохраняют остальные поля — unit-тесты обновить), иконка и `documentSupport` в `createChecklistModule`; проверить: `npm test`

## 2. Каталог и диалог в приложении

- [ ] 2.1 Кнопка «Добавить виджет» + overlay каталога (иконка/название из реестра); клик по бездокументному типу — добавление на активную вкладку; проверить: `npm run dev`
- [ ] 2.2 Диалог для документного типа: «Создать новый» (название) / «Открыть существующий» (`listByModule`+`documentType`, заголовок из content.title); отмена без последствий; создать → `documentService.create` + экземпляр на активной вкладке; проверить: `npm run dev`
- [ ] 2.3 E2E: новый чек-лист из пустой вкладки; второе представление существующего; отмена не создаёт документы; скриншот каталога (макет widget-adding); проверить: `npm run test:browser`

## 3. Завершение

- [ ] 3.1 Полный цикл: lint → typecheck → test → build → test:browser; `openspec validate pbt-019-widget-catalog --strict --no-interactive`
- [ ] 3.2 Открыть PR в `develop` (шаблон PBT); обновить карточку PBT-019 (DoD) и реестр (In review, PR)
