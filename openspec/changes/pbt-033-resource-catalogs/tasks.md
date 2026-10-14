# Tasks — PBT-033

## 1. Типы команд и код ошибки

- [ ] 1.1 `plan-commands.ts`: варианты `createResource` / `updateResource` / `deleteResource` / `createWorkType` / `updateWorkType` / `deleteWorkType` в `PlanCommand`, типы `ResourceCreateInput` / `ResourceUpdatePatch` / `WorkTypeCreateInput` / `WorkTypeUpdatePatch`, код `invalid-title` (design D1)

## 2. Операции ресурсов (`plan-catalogs.ts`)

- [ ] 2.1 `createResource`: trim названия, `invalid-title` на пустое, добавление в конец; unit: id уникален, соседние сущности не изменены
- [ ] 2.2 `updateResource`: переименование по id, ссылки задач не трогаются, даты не изменяются; unit: порядок стабилен, неизвестный ресурс → `unknown-resource`
- [ ] 2.3 `deleteResource` (вариант A — утверждён владельцем): фильтрация из `assigneeIds` всех задач (опустевший массив убирается), каскадное удаление недоступностей ресурса; unit: задачи и зависимости целы, план проходит `parsePlanContent`

## 3. Операции типов работ

- [ ] 3.1 `createWorkType`: обязательный `allowsParallel`, сохраняется в документе; unit: «Разработка» (false) и «ПСИ» (true) создаются и читаются из документа
- [ ] 3.2 `updateWorkType`: патч title/allowsParallel, отсутствующее свойство — не менять; unit: смена параллельности только через справочник
- [ ] 3.3 `deleteWorkType`: фильтрация из `workTypeIds` всех задач; unit: план проходит `parsePlanContent`, задачи целы

## 4. Независимость и диспетчер

- [ ] 4.1 Независимость планов: unit — два плана с ресурсом-тёзкой «QA», переименование в первом не изменяет второй (DoD-2)
- [ ] 4.2 `applyPlanCommand`: case'ы справочников; unit: каждая команда через единый путь, отклонение не меняет план
- [ ] 4.3 Экспорт из `packages/gantt/src/index.ts`; ESLint-границы (без React и UI-библиотек)

## 5. Проверки и завершение

- [ ] 5.1 Прогнать `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:browser`, `openspec validate pbt-033-resource-catalogs --strict`; результаты приложить к PR
- [ ] 5.2 Отметить DoD-чекбоксы карточки PBT-033; реестр: статус `In review`, ссылка на PR
