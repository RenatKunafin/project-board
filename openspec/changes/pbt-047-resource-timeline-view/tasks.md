# Tasks — PBT-047 Resource timeline view

- [ ] 1. Зависимости: `react-calendar-timeline@0.30.0-beta.19`, `dayjs`, `interactjs` — точные пины в `packages/gantt/package.json`; чистка кэша Vite
- [ ] 2. `resource-timeline-adapter.ts`: planToTimelineGroups/planToTimelineItems (D1/D2, A1-границы, read-only флаги, конфликтные className) + unit-тесты
- [ ] 3. `ResourceTimelineWidget.tsx`: дорожки, подсветка календаря (D3), конфликты (D4), read-only (D5), пустые состояния, remount по ревизии (D7)
- [ ] 4. `resource-timeline.css` на токенах; регистрация widgetType `plan-resources` в `createGanttModule`; удаление остатка `console.info('[pbt046dbg]…')` из `PlanGanttWidget.tsx`
- [ ] 5. E2E `tests/e2e/resource-timeline.spec.ts`: контрольный план (QA/QA2, Разработка, ПСИ, отпуск) — дорожки, укладка, отпуск у своего ресурса, конфликт vs допустимое пересечение, оба вида одного документа одновременно
- [ ] 6. Полные проверки (lint, typecheck, unit, build + e2e, openspec validate), tasks.md/DoD отмечены
