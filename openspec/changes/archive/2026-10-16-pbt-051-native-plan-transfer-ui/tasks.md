# Tasks — PBT-051 Native plan transfer UI

## Реализация

1. [x] SDK: `WidgetProps.switchDocument?: (documentId: string) => void` (design D4).
2. [x] Платформа: `WidgetPane` передаёт `switchDocument` через `PaneHandlers.replacePaneDocument` (D4).
3. [x] Виджет: кнопки «Экспорт»/«Импорт…» в тулбаре, скрытый file-input (D1, D3).
4. [x] Экспорт: `serializePlanFile` + скачивание `planFileName(new Date())` (D2).
5. [x] Импорт: `file.text()` → `deserializePlanFile` → `documentService.create` → `switchDocument`; inline-диагностика при отказе; сброс `input.value` (D3, D5).
6. [x] CSS: токены, без хексов; inline-область результата импорта.

## E2E (`tests/e2e/plan-transfer.spec.ts`)

7. [x] Перенос между двумя изолированными контекстами: экспорт → download → импорт в чистом контексте → план с названием и задачами, каталог содержит документ (DoD-1).
8. [x] Битый файл: диагностика по месту, документ не создаётся (DoD-2).
9. [x] Двойной импорт одного файла: два независимых документа, окно на последнем, существующие планы не перезаписаны (DoD-3).
10. [x] Отмена выбора файла: данные не меняются (DoD-4; через отсутствие `setInputFiles` после открытия chooser).

## Проверки и завершение

11. [x] `npm run lint` · `npm run typecheck` · `npm test` — зелёные.
12. [x] `npm run build` → чистая среда → `npm run test:browser` — без новых красных.
13. [x] `openspec validate pbt-051-native-plan-transfer-ui --strict` — зелёное.
14. [x] Отметить DoD в карточке PBT-051; статус в реестре — по циклу; скриншоты тулбара в `change/screenshots/`.
