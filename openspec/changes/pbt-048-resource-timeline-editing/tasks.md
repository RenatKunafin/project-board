# Tasks — PBT-048 Resource timeline editing

- [ ] 1. Адаптер: `canMove: true` / `canResize: 'both'` у задач, недоступности — без жестов; Timeline `canChangeGroup: false`, `useResizeHandle: true`
- [ ] 2. Хук `use-task-form.ts` (commitPlan/submitTaskForm/deleteCurrentTask/applyDependencyCommand) — вынос из PlanGanttWidget без изменения поведения
- [ ] 3. ResourceTimelineWidget: onItemDrag → факт, mouseup-capture → снап/классификация/команды ядра, одна запись, подавление ремоунта своей записи; dblclick → форма задачи
- [ ] 4. E2E `resource-timeline-editing.spec.ts`: drag (A2), resize края через праздник (A3), вертикаль не переназначает (D5), форма по dblclick, одно назначение — одна запись, конфликт пересчитывается, попеременно с проектным видом
- [ ] 5. Полные проверки (lint, typecheck, unit, build + e2e, openspec validate), tasks.md/DoD отмечены
