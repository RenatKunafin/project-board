# Tasks — PBT-053 Предпросмотр и импорт `.gantt`

## 1. Роутинг импорта и диалог предпросмотра

- [x] 1.1 Расширить импорт в `PlanGanttWidget.tsx`: `accept` + `.gantt`, роутинг по расширению (design D1), состояние `onlineganttPreview` (D2), фатальные issues — inline-панель `importResult` (ослабление типа до структурно совместимого); проверка: unit при наличии чистой логики, ручной прогон dev-сервера
- [x] 1.2 Создать `OnlineGanttImportDialog.tsx` (D3): название с предзаполнением из имени файла, сводка `report.summary`, предупреждения, список задач без исполнителя с пометкой ручного решения, примечания текстом, Esc/отмена, скролл тела; стили по образцу диалогов, только токены (D6)
- [x] 1.3 Применение (D4): trim названия + дефолт, `documentService.create` с `payload.content`, `switchDocument`, inline-успех, сброс предпросмотра; отмена/Esc без изменений

## 2. E2E

- [x] 2.1 `tests/e2e/onlinegantt-import.spec.ts` (D5): полный импорт эталона (сводка 47/2/9/21/16, предупреждения, apply → план в окне с группой «Отпуск», каталог; виджет «Ресурсы» на тот же документ); отмена предпросмотра; битый файл буфером → inline-диагностика без диалога; повторный импорт — два независимых документа
- [x] 2.2 Скриншоты предпросмотра и результата в `change/screenshots/` (DoD UI-артефакт)

## 3. Проверки и PR

- [x] 3.1 Полный набор: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `test:browser` на чистой среде (`pkill -f "vite preview"`, порт 4173 свободен), `openspec validate pbt-053-onlinegantt-import-ui --strict` и `--all --strict`; результаты в PR
- [x] 3.2 Реестр: `In progress` → PR → `In review` со ссылкой; после одобрения — архивация change с sync specs заключительным коммитом перед merge, `Done` после merge
