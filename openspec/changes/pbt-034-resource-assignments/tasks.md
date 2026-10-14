# Tasks — PBT-034

## 1. Типы команд и код ошибки

- [x] 1.1 `plan-commands.ts`: варианты `assignResource` / `unassignResource` / `assignWorkType` / `unassignWorkType` / `createUnavailability` / `updateUnavailability` / `deleteUnavailability` в `PlanCommand`, типы `UnavailabilityCreateInput` / `UnavailabilityUpdatePatch`, код `unknown-unavailability` (design D1–D2)

## 2. Операции назначений (`plan-assignments.ts`)

- [x] 2.1 `assignResource` / `unassignResource`: добавление в конец `assigneeIds` / удаление (опустевший массив убирается); идемпотентность: повторное назначение и снятие отсутствующего — noop без изменения плана; unit: несколько ресурсов на задаче (D1 ADR PBT-003)
- [x] 2.2 `assignWorkType` / `unassignWorkType`: та же семантика для `workTypeIds`; unit: идемпотентность, порядок остальных задач
- [x] 2.3 Отклонения: `unknown-task` / `unknown-resource` / `unknown-work-type` целиком; unit: назначение не меняет даты и длительность задачи (DoD-4), ресурс другого плана → `unknown-resource` (DoD-3)

## 3. Операции недоступностей

- [x] 3.1 `createUnavailability`: id, конец массива, `unknown-resource`, `inverted-interval` при `end < start`; unit: отпуск создан с ресурсом и границами (DoD-2)
- [x] 3.2 `updateUnavailability`: patch resourceId/start/end, интервал валидируется по итоговому состоянию; unit: смена границ, смена ресурса, неизвестный период → `unknown-unavailability`
- [x] 3.3 `deleteUnavailability`: фильтр, порядок стабилен; unit: остальные недоступности целы

## 4. Ссылочная целостность (DoD-5)

- [x] 4.1 Сквозной unit: назначения + отпуск → `deleteResource` → задачи с чистыми назначениями, отпуск удалён, `parsePlanContent` валиден
- [x] 4.2 Сквозной unit: назначения → `deleteTask` → зависимости вычищены, недоступности ресурсов не тронуты, план валиден

## 5. Диспетчер и экспорт

- [x] 5.1 `applyPlanCommand`: case'ы назначений и недоступностей; unit: каждая команда через единый путь, отклонение не меняет план
- [x] 5.2 Экспорт из `packages/gantt/src/index.ts`; ESLint-границы (без React и UI-библиотек)

## 6. Проверки и завершение

- [x] 6.1 Прогнать `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:browser`, `openspec validate pbt-034-resource-assignments --strict`; результаты приложить к PR
- [x] 6.2 Отметить DoD-чекбоксы карточки PBT-034; реестр: статус `In review`, ссылка на PR
