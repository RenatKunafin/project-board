# Tasks — PBT-072

1. [ ] SDK: `description?: string` в `WidgetTypeDefinition`; тексты описаний в модулях gantt (План, Ресурсы) и checklist (Чек-лист).
2. [ ] `index.css`: топ-бар (44px, chrome, лого+название+save-state), панель вкладок (активная полоса primary, hover-проявление кнопок), сегмент-контрол раскладки, карточки панелей, пустое состояние.
3. [ ] `App.tsx`: топ-бар вместо потокового заголовка, перенос `save-state`, callback пустого состояния на каталог виджетов.
4. [ ] `WidgetCatalogPanel`: карточки с иконкой-плиткой и описанием (поиск — и по описанию).
5. [ ] `DocumentCatalogPanel`/`DocumentPickerPanel`: иконки-плитки, подстрока «открыт в N окнах», hover-проявление действий, dashed-кнопка нового.
6. [ ] `EmptyWorkspace`: круг с иконкой, заголовок, кнопка «Добавить виджет».
7. [ ] e2e ×4 (D7); полный набор: `lint` → `typecheck` → `test` → `build` → чистая среда → `test:browser` → `openspec validate --all --strict`.
8. [ ] Скриншоты до/после; проверка 1024×778 и широкого экрана; реестр `In review` + PR.
