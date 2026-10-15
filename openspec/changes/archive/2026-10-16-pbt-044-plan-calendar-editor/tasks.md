# Tasks — PBT-044 Plan calendar editor

- [x] 1. Команда `updateCalendar` в ядре (валидация ISO/дублей/пересечений/пустого) + unit-регрессии
- [x] 2. `PlanCalendarSection.tsx` (неделя, праздники день/диапазон, исключения) + секция в диалоге, кнопка «Настройки плана»
- [x] 3. E2E `plan-calendar.spec.ts`: праздник 14.10 → длительность 4, исключение → 5, пустой календарь отклонён, диапазон раскладывается, независимость планов, второй виджет
- [x] 4. Полные проверки (lint, typecheck, unit, build + e2e, openspec validate), tasks.md/DoD отмечены
