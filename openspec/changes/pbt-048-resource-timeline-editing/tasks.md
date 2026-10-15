# Tasks — PBT-048 Resource timeline editing

- [x] 1. Адаптер: `canMove: true` / `canResize: 'both'` у задач, недоступности — без жестов; Timeline `canChangeGroup: false`, `useResizeHandle: true`
- [x] 2. Хук `use-task-form.ts` (commitPlan/submitTaskForm/deleteCurrentTask/applyDependencyCommand) — вынос из PlanGanttWidget без изменения поведения
- [x] 3. ResourceTimelineWidget: onItemDrag → факт, mouseup-capture → снап/классификация/команды ядра, одна запись, подавление ремоунта своей записи; dblclick → форма задачи. Находка: сырой `time` resize беты масштабно врёт — дата края по пиксельной дельте указателя (design D2)
- [x] 4. E2E `resource-timeline-editing.spec.ts` (4): drag A2 с праздником + конфликт пересчитан; двухресурсная — одна задача/обе полосы; resize-край на выходной (A3) + вертикаль без переназначения + холостой жест без записи; форма dblclick + попеременно с проектным видом
- [x] 5. Полные проверки: lint ✓, typecheck ✓, test 358 ✓, build ✓, test:browser 81 ✓ (+4, свои зелёные; 4 предсуществующих красных SVAR — вне задачи), openspec validate --all --strict 24 ✓
