## 1. Модель и фабрика

- [x] 1.1 `packages/gantt/src/plan-document.ts`: типы `PlanContent` и разделов (readonly, ISO-даты, включительное окончание), `createPlanContent(title?)`; зависимость react не подключается к модели
- [x] 1.2 Unit-тесты фабрики: разделы по умолчанию (календарь пн–пт, пустые коллекции), планы не разделяют коллекции

## 2. Валидатор

- [x] 2.1 `parsePlanContent(value): PlanValidationResult` с диагностикой `PlanIssue { code, path, message }`: структура, форматы дат, weekday 1–7, лаг ≥ 0, дубли id, ссылки между разделами, циклы групп, `end ≥ start`, непустой рабочий календарь
- [x] 2.2 Unit-тесты валидатора: корректный документ проходит; каждый класс повреждений даёт свой код и не подменяется рабочим планом

## 3. Модуль и заглушка

- [x] 3.1 `createGanttModule()`: тип `plan`, `documentSupport {gantt/plan/1, createContent}`, заглушка `PlanPlaceholderWidget` (название из контента, состояние ошибки со списком диагностики, пометка «представление — PBT-037»)
- [x] 3.2 Экспорт из `packages/gantt/src/index.ts`; react-зависимость не потребовалась (как в checklist — резолв через workspaces)

## 4. Подключение и сквозная проверка

- [x] 4.1 `apps/project-board/src/widgets.ts`: подключить `createGanttModule()`; каталог предлагает «План»; App.tsx: диалог выбора документа обобщён по типу, рендер панелей — по реестру (design D7)
- [x] 4.2 E2E: создать план через каталог → автосохранение → перезагрузка → документ открылся из каталога → второй экземпляр того же плана; unit: два плана с ресурсами-тёзками независимы
- [x] 4.3 Прогнать `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:browser`, `openspec validate pbt-030-plan-document --strict`; DoD-чекбоксы карточки; реестр (статус, PR#22)
