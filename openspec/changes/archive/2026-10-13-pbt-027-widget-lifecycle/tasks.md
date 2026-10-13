## 1. SDK

- [x] 1.1 `widget-sdk`: `WidgetProps.visible: boolean`, `WidgetProps.onResize?: (size: WidgetSize) => void`, тип `WidgetSize`; unit-тесты контракта (прокидывание пропсов)

## 2. Сервис

- [x] 2.1 `document-service`: `activeSubscriptionCount()` (сумма обработчиков подписок); unit: циклы монтирования/отмонтирования ChecklistWidget ×20 в jsdom не изменяют счётчик

## 3. Рамка окна и пространство

- [x] 3.1 `WidgetWindow`: локальный boundary ошибки вокруг содержимого — состояние ошибки на токенах, «Повторить» (перемонтирование), кнопки рамки живы; unit: падающий компонент → состояние ошибки, соседний виджет жив, «Повторить» монтирует заново
- [x] 3.2 `WidgetPane`/`WidgetWindow`: `ResizeObserver` + rAF-троттлинг → `onResize` (нулевые размеры не доставляются); unit: изменение размера доставляет одно значение на кадр
- [x] 3.3 `App`: рендер всех вкладок, скрытые — `hidden`-контейнеры; `TabSurface` (React.memo) с измеримой границей; `visible` окнам (активная вкладка И не свёрнуто); unit: счётчик перерисовок скрытой вкладки не растёт от действий активной
- [x] 3.4 `main.tsx`: диагностический экспорт `window.__projectBoard.activeSubscriptionCount()` (design D4)
- [x] 3.5 `checklist`/демо-виджеты: правки под обязательный `visible`; checklist — ранний возврат useMemo при `visible: false` (подписка сохраняется)

## 4. Сквозная проверка

- [x] 4.1 E2E: цикл ×20 «открыть окно с документом → свернуть/развернуть → скрыть вкладкой → закрыть»: `activeSubscriptionCount` до/после равен; черновик переживает переключение вкладок; скрытая вкладка отражает изменение документа при возврате
- [x] 4.2 Прогнать `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:browser` (регресс), `openspec validate --all --strict`; DoD-чекбоксы карточки; реестр (`In review`, PR)
