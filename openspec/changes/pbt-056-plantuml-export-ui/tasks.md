# Tasks — PBT-056 Экспорт PlantUML из интерфейса

## 1. Диалог и точка входа

- [x] 1.1 `plantumlFileName` + диалог `PlantUmlExportDialog.tsx` + стили (design D2/D5): моноширинный текст со скроллом, ограничения отчёта, инструкция Confluence (DoD-4), «Скопировать» (clipboard с деградацией), «Скачать .puml», Esc/«Закрыть»
- [x] 1.2 Кнопка 📊 в тулбаре `PlanGanttWidget.tsx` (D1): состояние `plantumlPreview` из полного документа (без фильтров), скачивание Blob по образцу PBT-051 (D3)

## 2. E2E

- [x] 2.1 `tests/e2e/plantuml-export.spec.ts` (D4): предпросмотр (тэги, title, requires, ограничения при лаге), скачивание (шаблон имени, содержимое = тексту), экспорт при активном фильтре — полный состав и неизменность фильтра, отмена без изменений
- [x] 2.2 Скриншот предпросмотра в `change/screenshots/`

## 3. Проверки и PR

- [x] 3.1 Полный набор на чистой среде: lint, typecheck, test, build, `test:browser`, `openspec validate pbt-056-plantuml-export-ui --strict` и `--all --strict`; результаты в PR
- [ ] 3.2 Реестр: `In progress` → PR → `In review`; после одобрения — архивация с sync specs (plantuml-export +1) перед merge, `Done` после merge
