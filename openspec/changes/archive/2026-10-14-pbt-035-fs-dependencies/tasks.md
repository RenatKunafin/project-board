# Tasks — PBT-035

## 1. Типы команд и коды ошибок

- [x] 1.1 `plan-commands.ts`: варианты `createDependency` / `updateDependency` / `deleteDependency` в `PlanCommand`, типы `DependencyCreateInput` / `DependencyUpdatePatch`, коды `invalid-lag`, `circular-dependency`, `duplicate-dependency`, `unknown-dependency` (design D1)

## 2. Команды зависимостей (`plan-dependencies.ts`)

- [x] 2.1 `createDependency`: валидация задач (`unknown-task`), лага (`invalid-lag`), самоссылки и косвенного цикла (`circular-dependency`, BFS от `toTaskId`), идемпотентность точного дубля / `duplicate-dependency` при другом лаге; unit: создание в конец, соседи целы
- [x] 2.2 `updateDependency`: смена лага, тот же лаг — noop; unit: `unknown-dependency`, `invalid-lag`
- [x] 2.3 `deleteDependency`: фильтр, порядок стабилен; unit: `unknown-dependency`

## 3. Диагностика временных нарушений

- [x] 3.1 `dependencyViolations`: `expectedStart = addWorkingDays(from.end, lagDays)`; нарушение ⇔ `to.start < expectedStart`; рёбра с отсутствующими задачами пропускаются; unit: план без нарушений → пустой список
- [x] 3.2 Границы лага (DoD-1): лаг 0 → следующий рабочий день после пт = пн; лаг 1 → вт (ещё один рабочий день); лаг 2 → ср
- [x] 3.3 Ветвление и праздники (DoD-2): два предшественника — нарушение только по «позднему» ребру; праздник в окне задержки сдвигает ожидание
- [x] 3.4 Календарь и даты (DoD-4/5): нарушение выдаёт IDs и объяснение, даты задач не изменены; одинаковые даты при другом календаре — другой результат

## 4. Диспетчер и экспорт

- [x] 4.1 `applyPlanCommand`: case'ы зависимостей; unit: каждая команда через единый путь, отклонение не меняет план
- [x] 4.2 Экспорт из `packages/gantt/src/index.ts`; ESLint-границы (без React и UI-библиотек)

## 5. Проверки и завершение

- [x] 5.1 Прогнать `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:browser`, `openspec validate pbt-035-fs-dependencies --strict`; результаты приложить к PR
- [x] 5.2 Отметить DoD-чекбоксы карточки PBT-035; реестр: статус `In review`, ссылка на PR
