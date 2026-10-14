# Tasks — PBT-037

## 1. Адаптер (`svar-adapter.ts`)

- [ ] 1.1 Локальные контракты `GanttTask` / `GanttLink`; `planToGanttTasks`: группы → `summary` с `parent`, задачи → `end + 1` (включительное → исключительное), календарная `duration`, порядок массивов; `planToGanttLinks`: `type: 'e2s'`, лаг из документа
- [ ] 1.2 `nonWorkingDayKind`: weekend/holiday/undefined с учётом рабочих исключений
- [ ] 1.3 Unit: включительность (+1 на примере пн–пт), три уровня вложенности групп, `e2s` с лагом, пустой план; golden на `small-plan.json` (перенос фикстуры PBT-012 в тесты пакета)

## 2. Виджет (`PlanGanttWidget.tsx`)

- [ ] 2.1 Подписка на документ по паттерну чек-листа; три состояния: без документа / диагностика `PlanIssue` / рендер SVAR (`Gantt` + `Willow`, `inclusiveEnd: true`)
- [ ] 2.2 `highlightTime` по `nonWorkingDayKind` (unit `day`); блокировка `drag-task` в `init` с защитой от двойного init (StrictMode); форма `Editor` не подключается
- [ ] 2.3 `visible: false` — SVAR не монтируется, подписка жива; CSS `height: 100%` для resize; классы `gantt__weekend`/`gantt__holiday` на var()-токенах (`gantt.css`)
- [ ] 2.4 Рабочая длительность на поверхности (ядро PBT-013, по образцу спайка); замена заглушки в `createGanttModule`, удаление `PlanPlaceholderWidget`; зависимость `@svar-ui/react-gantt@2.8.0` точным пином

## 3. Проверки

- [ ] 3.1 `npm run lint`, `npm run typecheck`, `npm test` зелёные; ESLint-границы: SVAR не выходит за `packages/gantt`
- [ ] 3.2 E2E `plan-gantt.spec.ts`: каталог → план → контрольный контент через `window.__projectBoard` (small-plan) → автосохранение (пауза) → reload → строки/полосы восстановлены; второй экземпляр общего документа; пустой план; скриншот в `screenshots/`
- [ ] 3.3 `npm run test:browser`, `openspec validate pbt-037-project-gantt-view --strict`; DoD-чекбоксы карточки; реестр: `In review` + PR
