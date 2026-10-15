# Tasks — PBT-040 Group editor

- [x] 1. Модуль формы: `group-editor.ts` (валидация, селект родителей) + unit-тесты
- [x] 2. `GroupEditorDialog.tsx` (create/edit/delete, клавиатура, фокус) + интеграция в `PlanGanttWidget`: «+ Группа», dblclick по строке группы, перехватчик `open-task`, раскрытие в адаптере
- [x] 3. Попутная чистка: удалён `console.info('[pbt039dbg] …')`
- [x] 4. E2E `plan-groups.spec.ts`: структура из плоского плана + reload, перенос подгруппы (сводная/даты), сообщение о цикле, раскрытие B4 (два экземпляра), удаление группы с потомками
- [x] 5. Полные проверки (lint, typecheck, unit, build + e2e, openspec validate), tasks.md/DoD отмечены
