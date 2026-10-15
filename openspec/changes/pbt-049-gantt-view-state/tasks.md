# Tasks — PBT-049 Gantt view state

- [ ] 1. SDK: `WidgetProps.updateSettings(patch)`; dashboard: `WorkspaceStore.loadViewSettings/saveViewSetting` (ключи `view:*`), App — `initialViewStates` + `viewStatesRef` через PaneHandlers, прокидывание в WidgetPane
- [ ] 2. План-виджет: тулбар-фильтры (текст/ресурс), чистая фильтрация дерева задач/групп для SVAR, полный план для проблем/жестов, пустое состояние; collapsedGroups → settings; сброс фильтров в «Показать»
- [ ] 3. Ресурсный виджет: фильтры (текст/ресурс → дорожки/элементы), zoom-кнопки + контролируемая видимая область → settings (дебаунс), пустое состояние
- [ ] 4. E2E `gantt-view-state.spec.ts`: два экземпляра с разными фильтрами/масштабом/раскрытием; reload восстанавливает; фильтр не меняет ревизию, скрытые в проверках; пустое состояние; DoD-5 (второй вид без дубля)
- [ ] 5. Полные проверки (lint, typecheck, unit, build + e2e, openspec validate), tasks.md/DoD отмечены
