# Tasks — PBT-049 Gantt view state

- [x] 1. SDK: `WidgetProps.updateSettings(patch)`; dashboard: `WorkspaceStore.loadViewSettings/saveViewSetting` (ключи `view:*` в таблице settings — без смены схемы), App — `initialViewStates` + `viewStatesRef` через PaneHandlers, прокидывание в WidgetPane
- [x] 2. План-виджет: тулбар-фильтры (текст/ресурс), чистая `filterPlanForView` (дерево задач/групп; 7 unit-тестов), полный план для проблем/жестов/счётчика, пустое состояние; collapsedGroups → settings; сброс фильтров в «Показать»; фикс readOnce (getTask скрытой задачи — undefined)
- [x] 3. Ресурсный виджет: фильтры (текст/ресурс → дорожки/элементы), zoom-кнопки + контролируемая видимая область → settings (дебаунс 500 мс), пустое состояние (раньше «нет ресурсов»)
- [x] 4. E2E `gantt-view-state.spec.ts` (3): проектный — фильтры/свёрнутая группа экземпляров независимы + reload + ревизия; пустое состояние + скрытые в проверках; ресурсный — зум/фильтры экземпляров + reload + пустое состояние + DoD-5 (второй вид через каталог)
- [x] 5. Полные проверки: lint ✓, typecheck ✓, test 365 ✓, build ✓, test:browser 84 ✓ (+3, свои зелёные; 4 предсуществующих красных SVAR — вне серии задач), openspec validate --all --strict 25 ✓
