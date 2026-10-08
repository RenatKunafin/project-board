## 1. SDK: контракт регистрации

- [x] 1.1 В `packages/widget-sdk/src` определить типы `WidgetTypeSettings`, `WidgetProps`, `WidgetSizeConstraints`, `WidgetTypeDefinition`, фабрику `defineWidgetType` и класс `WidgetRegistryError`; проверить: `npm run typecheck -w packages/widget-sdk` и `npm run lint` успешны
- [x] 1.2 Добавить unit-тесты контракта: фабрика возвращает определение без изменений; ошибка экспортируется и ловится по `instanceof`; проверить: `npm test` находит новые тесты

## 2. Платформа: реестр и состояния UI

- [x] 2.1 В `packages/dashboard/src` реализовать `createWidgetRegistry` с валидацией (пустой id, дубликат id → `WidgetRegistryError`) и доступом `list()/get()` (неизвестный id → маркер `{ kind: 'unknown', id }`); unit-тесты: успешная регистрация, дубликат, неизвестный тип (сценарии спецификации); проверить: `npm test` — все зелёные
- [x] 2.2 Добавить компонент состояния «неизвестный тип виджета» (показывает id и пояснение); проверить typecheck/lint пакета

## 3. Приложение: подключение и демонстрация

- [x] 3.1 Реализовать демонстрационный виджет в `apps/project-board/src/widgets/demo-widget.tsx` (заголовок из настроек, `widgetInstanceId`, настройки); подключить его в `widgets.ts` через `defineWidgetType`; построить реестр в `main.tsx` и передать в `App`
- [x] 3.2 Оболочка `App` отображает: каталог зарегистрированных типов, экземпляр демо-виджета и блок состояния «неизвестный тип» (запрос `checklist`); проверить: `npm run dev` показывает все три блока, `npm run test:browser` расширенного smoke — зелёный

## 4. Проверки и завершение

- [x] 4.1 Прогнать полный цикл: `npm run lint` → `typecheck` → `test` → `build` → `test:browser`; приложить вывод к PR; открыть PR в `develop` (шаблон PBT) до архивации
- [x] 4.2 Обновить карточку PBT-006 (DoD) и реестр (статус In review, ссылка PR); скриншот оболочки приложить к PR
