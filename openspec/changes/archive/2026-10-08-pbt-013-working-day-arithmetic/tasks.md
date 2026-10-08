## 1. Ядро арифметики

- [x] 1.1 Реализовать `packages/gantt/src/working-calendar.ts`: `WorkingCalendarError`, `createWorkingCalendar({ workingDays, holidays, workingExceptions })` → иммутабельный календарь с `isWorkingDay / nextWorkingDay / addWorkingDays / workingDaysBetween`; валидация формата дат и непустого календаря; проверить: typecheck + lint
- [x] 1.2 Unit-тесты сценариев спецификации: праздник в среде, рабочее исключение в субботу, пт→пн, пропуск праздников, лаг 0/5, неделя с праздником = 4, однодневный/перевёрнутый интервалы, граница года, високосный день, DST-интервал, календарь без рабочих дней; проверить: `npm test`

## 2. Ожидания фикстур PBT-012

- [x] 2.1 Тест на фикстурах: загрузить `small-plan.json`, прогнать функции календаря по E1–E8 (длительности, лаг, конфликтные пересечения — рабочие дни пересечений); проверить: `npm test` — все зелёные

## 3. Завершение

- [x] 3.1 Полный цикл: lint → typecheck → test → build → test:browser; `openspec validate pbt-013-working-day-arithmetic --strict --no-interactive`
- [x] 3.2 Открыть PR в `develop` (шаблон PBT); обновить карточку PBT-013 (DoD) и реестр (In review, PR)
