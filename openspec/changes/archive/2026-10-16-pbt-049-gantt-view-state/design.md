# Design — PBT-049 Gantt view state

## Context

ADR-6.4 PBT-002 предусматривал «чтение/запись состояния экземпляра», но SDK v0 дал только стартовые настройки типа (`settings={lookup.startSettings}`). Схема БД v2 (PBT-024) не хранит состояние представлений; таблица `settings` — generic-KV (`key, value`).

## Goals / Non-Goals

- Goals: независимые фильтры/масштаб/раскрытие групп у каждого экземпляра; восстановление после reload; фильтр — производный рендер без записей документа.
- Non-Goals: см. proposal.

## Decisions

### D1. SDK: `updateSettings` в WidgetProps

`updateSettings?: (patch: WidgetTypeSettings) => void` — платформа мержит patch в состояние экземпляра. Реализация ADR-6.4, новое решение не требуется. Виджет хранит рабочее состояние сам (React-state, инициал из `settings`); платформа не ре-рендерит виджет при записи (viewStates в стабильном ref — memo TabSurface не дёргается).

### D2. Платформа: хранение в таблице settings (без смены схемы)

`WorkspaceStore.loadViewSettings(): Promise<Record<string, WidgetTypeSettings>>` — ключи `view:<instanceId>`; `saveViewSetting(instanceId, value)` — `settings.put`. Выбор KV-таблицы вместо поля в `widgetInstances` — без миграции схемы v3 (добавление записи в существующее хранилище настроек); состояние представления — платформенная настройка экземпляра. Загрузка — в bootstrap до рендера (`initialViewStates` в App), запись — немедленная (Dexie-put дешёвая; масштаб/фильтры меняются реже кадров).

App: `viewStatesRef` (Record instanceId → settings) + `updateViewState(instanceId, patch)` через `PaneHandlers` (стабильный ref, прецедент handlers). `WidgetPane`: `settings = {...lookup.startSettings, ...handlers.current.viewStateOf(instanceId)}`, `updateSettings = (patch) => handlers.current.updateViewState(...)`.

### D3. Фильтры (минимальный набор: текст задачи + ресурс)

- Проектный вид: тулбар — текстовый input (`data-gantt-filter-query`) и select ресурса (`data-gantt-filter-resource`, опция «Все ресурсы»). Фильтрация — чистая `filterPlanForView(plan, {query, resourceId})`: задачи по подстроке названия (lowercase) и назначению; дерево групп — подмножество с видимыми потомками (группа без видимых задач/подгрупп скрыта, включая подгруппы). Результат идёт в `planToGanttTasks` (SVAR рисует отфильтрованное дерево); счётчик «Задач: N» и список проблем — по полному плану (DoD-3: скрытые участвуют в проверках).
- Ресурсный вид: те же контролы (`data-rt-filter-query/resource`); фильтр ресурса — показывает дорожку выбранного ресурса (остальные скрыты); текст — скрывает элементы без подстроки; при активном текст-фильтре дорожки без видимых элементов скрыты. Пустой результат — подсказка «Ничего не найдено по фильтру» (`data-rt-filter-empty`) вместо пустого чарта; проектный — «Ничего не найдено по фильтру» над чартом (`data-gantt-filter-empty`).
- Изменение фильтров — React-state виджета + `updateSettings` (мгновенно, запись дешёвая). Фильтры не трогают expected-базы жестов и applyGesture (полный документ).
- «Показать» (PBT-046): сброс обоих фильтров перед переходом (задача может быть скрыта).

### D4. Масштаб — ресурсный вид (контролируемая видимая область)

`visibleTimeStart/End` контролируемые + `onTimeChange → updateScrollCanvas` (стандартный паттерн RCT; бета не проверялась в контролируемом режиме — Risks). Кнопки тулбара «+»/«−» (`data-rt-zoom-in/out`): span ×0.6/×1.6 вокруг центра видимой области, кламп `minZoom/maxZoom`. Текущая видимая область → `updateSettings({zoomStart, zoomEnd})` с дебаунсом 500 мс (колесо/перетаскивание частые); восстановление — инициал state из settings. Свой зум проектного вида — Non-Goal (D7 PBT-039, зум SVAR не исследован).

### D5. Раскрытие групп → settings

`collapsedGroups` (B4) инициализируется из `settings.collapsedGroups` (массив id); перехватчик `open-task` и `showTask` синхронизируют `updateSettings({collapsedGroups: [...set]})` вместе с React-state. Проектный вид; в ресурсном групп нет.

### D6. DoD-5 — дополнительное представление

Пикер каталога (PBT-025) уже даёт выбор типа при открытии существующего документа (e2e PBT-047: план+ресурсы один documentId). В spec фиксируется как Requirement: открытие существующего плана в другом виде не дублирует документ.

## Risks / Trade-offs

- Контролируемый видимый диапазон RCT в бете не проверялся (спайк использовал default): при нестабильности — откат zoom-кнопок на `visibleTimeStart/End`-состояние без контролируемого скролла (только кнопки, колесо — внутренний RCT), фиксируется при следующем рендере.
- `onBoundsChange` не вызывается при первом монтировании (проверено PBT-047-слоем) — компенсируется инициализацией.
- Запись настроек при каждом сворачивании группы — Dexie-put дешёвая, пакета не требуется.

## Migration Plan

Схема БД не меняется (KV-таблица settings существует с v2). Старые установки получают пустые view-настройки — дефолтные представления.

## Open Questions

Нет — серия автономна (директива владельца).
