# Tasks — PBT-032

## 1. Типы команд и код ошибки

- [x] 1.1 `plan-commands.ts`: варианты `createGroup` / `updateGroup` / `deleteGroup` в `PlanCommand`, типы `GroupCreateInput` / `GroupUpdatePatch`, код `circular-group` в `PlanCommandErrorCode` (design D1)

## 2. Операции групп (`plan-hierarchy.ts`)

- [x] 2.1 `createGroup`: генерация id, добавление в конец `groups`, валидация `parentId` (`unknown-group`); unit: подгруппа третьего уровня, соседние сущности не изменены
- [x] 2.2 `updateGroup`: патч title/parentId (отсутствующее свойство — не менять, `parentId: undefined` — вынос на корень); unit: переименование не трогает дочерние, перенос задачи и подгруппы между группами
- [x] 2.3 Проверка циклов: `parentId === groupId` и перенос в собственного потомка → `circular-group` целиком без изменения документа; unit: 3-уровневое дерево, перенос корня в потомка, перенос в саму себя
- [x] 2.4 `deleteGroup` (вариант A — утверждается владельцем): прямые потомки к родителю (корневая — в корень), задачи и зависимости сохраняются; unit: группа с задачей, подгруппа с задачами, пустая группа

## 3. Сводные границы

- [x] 3.1 `childGroups` / `childTasks` / `groupSummaryBounds`: min начала и max окончания по вложенным задачам всех глубин; `undefined` для пустой группы (B1/B2)
- [x] 3.2 Unit: крайние даты с учётом подгрупп; обновление сводных после `setTaskDates` и после переноса задачи между группами (B3); сводная не хранится в документе

## 4. Диспетчер и экспорт

- [x] 4.1 `applyPlanCommand`: case'ы групп, делегирование `plan-hierarchy`; unit: каждая команда через единый путь, отклонение не меняет план
- [x] 4.2 Экспорт из `packages/gantt/src/index.ts`; ESLint-границы (без React и UI-библиотек)

## 5. Проверки и завершение

- [x] 5.1 Прогнать `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:browser`, `openspec validate pbt-032-task-hierarchy --strict`; результаты приложить к PR
- [x] 5.2 Отметить DoD-чекбоксы карточки PBT-032; реестр: статус `In review`, ссылка на PR
