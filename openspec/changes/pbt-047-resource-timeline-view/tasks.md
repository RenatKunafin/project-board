# Tasks — PBT-047 Resource timeline view

- [x] 1. Зависимости: `react-calendar-timeline@0.30.0-beta.19`, `dayjs@1.11.23`, `interactjs@1.10.27` — точные пины в `packages/gantt/package.json`; чистка кэша Vite
- [x] 2. `resource-timeline-adapter.ts`: planToTimelineGroups/planToTimelineItems (D1/D2, A1-границы, read-only флаги, конфликтные className, itemProps-стили токенами) + 14 unit-тестов
- [x] 3. `ResourceTimelineWidget.tsx`: дорожки, подсветка календаря (D3), конфликты (D4), read-only (D5), пустые состояния, remount по ревизии (D7)
- [x] 4. `resource-timeline.css` на токенах (+3 токена `--color-rt-*` в index.css); widgetType `plan-resources` в `createGanttModule`; удалён остаток `console.info('[pbt046dbg]…')` из `PlanGanttWidget.tsx`
- [x] 5. E2E `tests/e2e/resource-timeline.spec.ts`: 3 теста — дорожки/укладка/отпуск/конфликт-vs-допустимое, календарь плана (выходные/праздник/исключение), оба вида одного документа с редактированием через форму проектного вида
- [x] 6. Полные проверки: lint ✓, typecheck ✓, test 358 ✓, build ✓, test:browser 77 ✓ (+4 предсуществующих красных SVAR-спек — см. design Risks, не регресс PBT-047), openspec validate --all --strict 23 ✓
